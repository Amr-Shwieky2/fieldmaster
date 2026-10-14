# Scalability

What one organization of FieldMaster's size costs the system, how that was
measured, and what to change when it grows. Added with the flexible
organization model (2026-10-14).

## The target

One organization with **500 workers, 50 sites (10 projects) and 6 months of
history**, served from **one office computer** running the whole stack
(Docker Compose: Postgres/PostGIS, Redis, MinIO; the API and the admin web as
Node processes). The rule: every interactive request answers in **under one
second at the 95th percentile** with 10 requests in flight at once; the
background jobs (payroll calculation, PDF reports) report how long they take.

## How it is measured

`apps/api/scripts/load-test/` (autocannon plus a few hand-rolled loops):

```bash
# 1. Load data into its own database (the script refuses a name without "load", and wipes it first).
docker exec fieldmaster-postgres psql -U fieldmaster -c "CREATE DATABASE fieldmaster_load"
DATABASE_URL=postgresql://fieldmaster:fieldmaster_dev_password@localhost:5433/fieldmaster_load?schema=public \
  pnpm --filter @fieldmaster/api exec prisma migrate deploy
DATABASE_URL=…/fieldmaster_load?schema=public pnpm --filter @fieldmaster/api load:generate

# 2. The built API against it, without the per-client rate limit.
pnpm --filter @fieldmaster/api build
cd apps/api && NODE_ENV=production APP_ENV=development DEV_LOGIN_ENABLED=true \
  RATE_LIMIT_PER_MINUTE=1000000 PORT=3010 DATABASE_URL=…/fieldmaster_load?schema=public node dist/src/main.js

# 3. The test (prints a table; exits 1 when an interactive p95 is over 1 s).
API_URL=http://localhost:3010/api/v1 pnpm --filter @fieldmaster/api load:run
```

Regenerate the data before every run: the clock-in phase leaves 400 open
entries. `LOAD_GET_CONNECTIONS` (default 10) and `LOAD_GET_SECONDS` (default
8) tune the read phase.

**The data** (`load:generate`, bulk SQL, about 10 s): 1 organization, 500
workers (half daily, half hourly), 10 projects, 50 sites, 6,700 shifts
(Sunday to Thursday for about 6 months, plus today's 50), 67,000
assignments, 66,500 time entries (approved when older than 7 days, waiting
for approval otherwise), 133,000 clock events, 66,500 daily summaries,
64,000 approvals and 300 notifications.

**What it does:**
1. Login: the real OTP flow (code request, then verification) for 150
   workers, 20 at a time.
2. Clock-in: 400 workers fetch their shift list and clock in, 20 at a time.
3. Reads as the Owner, 10 connections for 8 s each: the attendance list,
   the operations snapshot (400 workers on shift), workers, shifts, pending
   approvals, members, the live payroll dashboard, notifications.
4. Jobs: the previous month's payroll calculation (500 workers) and three
   workers' ledger PDFs (Chromium), each from request to ready.

## Results

The final run (2026-10-14, the machine below). Interactive rows: 10
connections for 8 s each (the login and clock-in rows: 20 workers at a time).

| What | p50 | p95 | p99 | Throughput |
|---|---|---|---|---|
| login: code request | 255 ms | 334 ms | 343 ms | 150 workers |
| login: verification | 213 ms | 269 ms | 275 ms | 150 workers |
| worker's shift list | 4 ms | 6 ms | 8 ms | 400 workers |
| clock-in | 68 ms | 83 ms | 92 ms | 400 workers |
| attendance list (all, first page) | 32 ms | 41 ms | 45 ms | 307 req/s |
| attendance list (a month, filtered) | 30 ms | 44 ms | 49 ms | 320 req/s |
| operations snapshot (400 workers on shift) | 160 ms | 211 ms | 232 ms | 63 req/s |
| workers (page of 50) | 18 ms | 27 ms | 31 ms | 523 req/s |
| workers (whole list, 500) | 211 ms | 269 ms | 289 ms | 52 req/s |
| shifts (the 200 latest) | 250 ms | 356 ms | 410 ms | 37 req/s |
| pending approvals (page of 50) | 14 ms | 19 ms | 23 ms | 684 req/s |
| pending approvals (whole list, 2,500) | 491 ms | 742 ms | 821 ms | 20 req/s |
| members (page of 50) | 15 ms | 22 ms | 25 ms | 608 req/s |
| members (whole list, 501) | 147 ms | 208 ms | 219 ms | 72 req/s |
| payroll dashboard (the live month, mid-month) | 302 ms | 377 ms | 402 ms | 32 req/s |
| payroll dashboard (a whole month live, 11,000 entries) | 470 ms | 621 ms | 644 ms | 20 req/s |
| notifications | 8 ms | 12 ms | 13 ms | 1,169 req/s |
| **Jobs** | | | | |
| payroll calculation (500 workers, a month) | 1.4 s from request to done | | | |
| ledger PDF (one worker, a month; Chromium) | 351 ms | 906 ms (max of 3) | | |

No errors in any row.

The first run, before the fixes of this step's scalability pass, had two
interactive pages over the limit and a third close to it:

| What | Before (p50 / p95) | After (p50 / p95) | What changed |
|---|---|---|---|
| pending approvals (whole list) | 4,994 / 5,783 ms | 491 / 742 ms | flat rows plus one query each for the shifts, summaries, corrections and names; the worker's name instead of their whole user record; a page of 50 answers in 19 ms |
| payroll dashboard (the live month) | 3,121 / 3,977 ms | 302 / 377 ms | no stored snapshot loaded for a month that is not finalized; the engine groups by worker once; a month's entries read flat, without the times only a stored calculation keeps; only totals for the previous month |
| members (whole list) | 185 / 839 ms (p99 1,366) | 147 / 208 ms | the guard's single joined query; a page of 50 answers in 22 ms |
| attendance list (first page) | 78 / 110 ms | 32 / 41 ms | indexes on organization + business date |
| operations snapshot | 198 / 254 ms | 160 / 211 ms | no correlated subquery (no JIT); shift index |

## What keeps it fast

- **Pagination everywhere it grows.** Every list that grows with the
  organization takes `?page=` / `?pageSize=` and answers
  `{ items, total, page, pageSize }` (see `api.md`). Without them a list
  answers as it always did, for older clients — that is why the whole-list
  rows of the table are still there, and why they are the slow ones.
- **Indexes for the organization and scope filters** (migration
  `20261015090200_scale_indexes`, checked with `EXPLAIN ANALYZE` on the load
  data): a month of approved entries went from a sequential scan of every
  entry (17 ms) to an index range (1.4 ms), the first page of the attendance
  list from 10 ms to 0.2 ms, a restricted member's list from 8 ms to 0.4 ms.
- **Month filters are date ranges** (`>= first day AND < next month's first
  day`), which the indexes serve; a `LIKE '2026-10-%'` cannot use a b-tree
  index under the database's `en_US` collation.
- **A constant number of queries.** `query-counts.e2e-spec.ts` counts the
  SQL statements of the heavy pages and jobs for 4 and for 40 workers and
  fails if they grow (a query per row would). Logged by the last run:

  | Page or job | 4 workers | 40 workers |
  |---|---|---|
  | attendance list (Owner / restricted member) | 10 / 11 | 10 / 11 |
  | pending approvals | 7 | 7 |
  | operations snapshot (Owner / restricted member) | 10 / 11 | 10 / 11 |
  | workers, members, member access | 4, 4, 3 | 4, 4, 3 |
  | shifts, time entries, forgotten stamps, notifications | 3 each | 3 each |
  | roles, emergency call-outs | 6, 6 | 6, 6 |
  | payroll dashboard | 21 | 21 |
  | payroll calculation (job) | 39 | 38 |
  | operational attendance report (job) | 46 | 46 |

  (The jobs write their progress at most once a second, so a slower run can
  write it once more.)
- **Jobs batch per worker.** The payroll calculation groups a month by
  worker once, prices each worker's entries with the rules of each business
  date, writes the items 200 rows per statement (`INSERT … ON CONFLICT`)
  and links the month's adjustments with one `UPDATE`. Reports load each
  section with one query per section, never per worker or per day. The
  engine (`calculatePayrollMonth`) also groups by worker once: it used to
  scan every entry for every worker (23 ms → 1 ms for a month of 500).
- **Flat rows for a month.** A payroll month's entries are read without
  nesting the shift, project and site in each of them; the month's few
  hundred shifts are read once (a month of 11,000 entries: 206 ms → 63 ms
  to load). The live dashboard also leaves out each entry's clock times and
  last change, which only a stored calculation keeps (63 → 34 ms), computes
  only the totals of the previous month, and reads only the stored totals
  when that month is finalized.
- **No JIT on the live page.** The operations snapshot asked for "shifts
  with an open entry" through a correlated subquery whose cost estimate set
  off Postgres's JIT compiler on every call (5–40 ms); it now asks by the
  open entries' shift ids.
- **One query for the caller's permissions.** The guard reads the
  membership, its role record and its scope in one joined query per request.

## What one office computer holds

The numbers above were taken on an Apple M4 Pro (12 cores, 24 GB, 8 GB for
Docker) with Postgres on its default settings — the API, Postgres and the
load generator all on the same machine, competing for it. On that machine:

- the interactive reads answer in tens of milliseconds at the median with
  10 requests in flight, and the heaviest pages (the operations snapshot
  with 400 people on shift, the live payroll dashboard) stay under one
  second at the 95th percentile;
- 400 workers clock in within seconds of each other with a p95 around
  100 ms;
- a month's payroll for 500 workers is calculated in about 1.5 s;
- the Owner dashboard of a whole month, calculated live, answers in about
  100 ms for one viewer.

A smaller office machine (4 cores, 8–16 GB) should still serve one
organization of 500 workers comfortably: the busiest real moment is the
morning clock-in, and the reads come from a handful of managers, not 10
continuous connections. Re-run the load test on the actual machine before
going live.

## When it grows

In this order, as the need shows up:

1. **Postgres on its own machine (or a managed instance).** Under load, the
   API and Postgres share the CPU; separating them is the cheapest big win.
   Then tune it for a transactional workload: `shared_buffers` about a
   quarter of its memory, and `jit = off` (Postgres's JIT pays off for long
   analytic queries, not for many short ones).
2. **More API instances behind a load balancer.** The API keeps no session
   state in memory (sessions are in the database, the guard re-reads the
   membership on every request), with two exceptions to handle first:
   - real-time: WebSocket rooms and the SSE stream are fed by an in-process
     event emitter (`technical-decisions.md`, "Real-time notifications"),
     so with several instances an event only reaches the clients of the
     instance that raised it — add the Socket.IO Redis adapter and a Redis
     pub/sub bridge for SSE;
   - the per-client rate limit (`@nestjs/throttler`) counts per instance —
     give it Redis storage, and set Express's `trust proxy` behind the
     balancer.
   Size each instance's database pool (`connection_limit` in
   `DATABASE_URL`; Prisma's default is 2 × CPUs + 1) so that all of them
   together stay under Postgres's `max_connections`.
3. **Workers apart from the API.** Payroll calculations and reports are
   BullMQ jobs; run them in separate processes (the same image, without the
   HTTP server) so a report's Chromium never slows down a clock-in.
4. **History.** `time_entries` and `clock_events` grow by about 130,000 and
   270,000 rows a year per 500 workers; the indexes keep the lists fast for
   years. At tens of millions of rows, partition them by year.
5. **Read replicas for reports** once report generation competes with the
   day's traffic.

## Known heavy spots

- **The live payroll dashboard** computes its months live (the current
  one in full, the previous one's totals). It is the heaviest page: about
  100 ms alone, and 621 ms at p95 with 10 in flight for a whole month of
  500 workers. A finalized month costs almost nothing to read.
- **Whole lists without a page** (older clients, and the admin web's
  pending count): 2,500 waiting entries are a 5 MB answer; it stays under a
  second, but a page (`?pageSize=`) is 30 times cheaper. Moving the admin
  dashboard's pending count to `?pageSize=1` (the `total`) is a one-line
  change left for later, because the dashboard's existing test mocks the
  whole-list call.
- **Login code requests** take about 300 ms by design: the code is hashed
  slowly so a leaked table of codes is useless.
