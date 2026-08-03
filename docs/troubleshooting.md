# Troubleshooting

Real problems hit while building and verifying this repository, and how
they were actually resolved — not a generic FAQ.

## `prisma migrate dev` fails: "non-interactive environment... not supported"

`prisma migrate dev` is designed to prompt interactively (e.g. when it
detects drift) and refuses to run at all in a non-interactive shell,
including `--create-only`. This blocks the normal Prisma workflow in CI
and in agentic/scripted environments alike. The workaround used throughout
this project's migration history:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/diff.sql

mkdir -p "prisma/migrations/$(date -u +%Y%m%d%H%M%S)_<description>"
cp /tmp/diff.sql "prisma/migrations/<the new folder>/migration.sql"

npx prisma migrate deploy   # applies it like any other migration
npx prisma generate
```

Review the generated SQL before applying — `migrate diff` is a mechanical
diff, not a judgment call about backward compatibility, multi-step column
renames, etc.

## Tests fail with `relation "..." does not exist` after adding a migration

Migrations must be applied to **both** the dev database (`fieldmaster`) and
the test database (`fieldmaster_test`) independently — `pnpm db:migrate`
only touches whatever `$DATABASE_URL` in `apps/api/.env` points at (the dev
DB). Run `prisma migrate deploy` again with `DATABASE_URL` pointed at
`fieldmaster_test` (see `docs/testing.md`) before running `test:e2e`.

## `db:seed` fails with a `CHECK` constraint violation on `shifts`

The Postgres `shifts_end_after_start` constraint is what actually catches
this — it isn't a bug in the constraint. `prisma/seed.ts` computes several
shift times relative to `new Date()` (whatever moment the script happens to
run); one such computation (the seeded `DAY_TURAN` shift) used to derive
its start from the *current* wall-clock hour while hardcoding only the end
hour, so running the seed script after 18:00 local time produced an end
time earlier than the start time on the same calendar day. Fixed by giving
both the start and end of that shift explicit, hardcoded hours
(`setHours(8, ...)` / `setHours(18, ...)`) instead of leaving one of them
implicit. If you hit a similar failure with a *different* seeded shift
after modifying `seed.ts`, look for the same pattern: a `Date` derived from
`new Date()` without an explicit `setHours(...)` call on both ends of an
interval.

## Docker container boots but `PrismaClientInitializationError` at runtime

Prisma's query-engine binary is compiled against a specific OpenSSL
version, auto-detected wherever `prisma generate` runs. If `apt-get install
openssl` only happens in the final runtime stage of a multi-stage
Dockerfile, `prisma generate` (which runs in an earlier `build` stage)
guesses the wrong engine target and the app crashes on first query at
runtime. Fix: install `openssl`/`ca-certificates` in a shared `base` stage
that both `build` and `runtime` inherit from — see `apps/api/Dockerfile`
and its comment at the top of the `base` stage.

## `docker compose up` fails or is extremely slow on Apple Silicon

The official `postgis/postgis` image only publishes `linux/amd64`
manifests, which either fails outright or runs under slow QEMU emulation on
an arm64 (M-series) Mac. `docker-compose.yml` uses
`ghcr.io/baosystems/postgis` instead — a maintained multi-arch build of the
same PostGIS version.

## Postgres port 5432 already in use

If your machine already runs a native (non-Docker) Postgres on
`127.0.0.1:5432`, `docker-compose.yml` maps the container to host port
**5433** instead, to avoid silently connecting to the wrong database.
Update `DATABASE_URL` in `apps/api/.env` to match if you change this back.

## `EADDRINUSE: address already in use :::3000` when starting the API

Usually a previous `node dist/src/main.js` or `pnpm dev` process is still
running (e.g. from an earlier terminal session that was never stopped).
Find and stop it before starting a new one:

```bash
lsof -i :3000 -sTCP:LISTEN
kill <pid>
```

## Vitest component tests: `Cannot read properties of undefined (reading 'clear')` on `window.localStorage`

Node 22+ ships an experimental global `localStorage` that throws/warns
without a `--localstorage-file` flag — and in this project's
Vitest+jsdom+Node combination, it was found to shadow jsdom's own `Storage`
implementation on `window`, rather than jsdom's own polyfill taking
precedence. `apps/admin-web/vitest.setup.ts` replaces
`globalThis.localStorage`/`window.localStorage` with a small in-memory
`Storage` polyfill before any test runs, sufficient for the app's own
`sessionStore` (`getItem`/`setItem`/`removeItem`/`clear`). If a new test
file hits this same error, confirm `vitest.config.ts` still references
`setupFiles: ["./vitest.setup.ts"]`.

## Vitest component tests: `ReferenceError: React is not defined`

The admin-web `tsconfig.json` sets `"jsx": "preserve"` (the setting
Next.js's own compiler expects), but Vitest transforms `.tsx` through
esbuild directly, which needs an explicit JSX mode. `vitest.config.ts` sets
`esbuild: { jsx: "automatic" }` so JSX compiles with the modern automatic
runtime (no `import React` needed in test files) independently of the
app's own Next.js build pipeline.

## Offline-sync signature verification always fails, even with correct keys

This was a real bug caught during this feature's own test suite, not a
hypothetical. If you add a new field to the offline-event payload and
signatures start failing, check whether the server-side reconstruction of
the signable payload defaults that field with `?? null`/`?? false` while
the client simply omits it when absent. `canonicalizeOfflineEvent()` drops
`undefined` keys but keeps explicit `null`/`false` ones, so the two sides
must construct the payload object identically — see the detailed
walkthrough in `docs/offline-sync.md`.

## iOS Simulator unavailable ("requires Xcode, but the active developer directory is a Command Line Tools instance")

`xcrun simctl`/`xcodebuild` need full Xcode.app installed and selected via
`xcode-select --switch /Applications/Xcode.app`, which needs both Xcode
itself already installed and admin/sudo access — neither is something an
agent can do unattended in most environments. Mobile verification in this
project instead uses `tsc --noEmit` + ESLint (both clean), a real Metro/
webpack bundle build for the Expo web target (proves every dependency
resolves), and — where a session's tooling allows it — an interactive pass
through the web target as an iOS-Simulator stand-in. See
`technical-decisions.md` for exactly what that does and doesn't prove.

## `pnpm test` fails at the root with "No test files found" for admin-web

Fixed as of this session — `apps/admin-web` now has real test files
(`docs/testing.md`). If you see this again after deleting or moving those
files, either restore a `*.test.ts(x)` file under `src/`, or change the
`test` script if the app is genuinely meant to ship without any tests
(not recommended).
