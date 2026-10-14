# Authorization Matrix

Source of truth: `apps/api/src/common/auth/permissions.ts`. Every
protected route declares its required `Permission`(s) via
`@RequirePermissions(...)`; `PermissionsGuard` checks the caller's role
against `ROLE_PERMISSIONS` before the handler runs. Financial permissions
are additionally tracked in a separate `FINANCIAL_PERMISSIONS` set, checked
redundantly at the service and DTO-serialization layers (see "Defense in
depth" below) — the permission catalog alone is not the only thing standing
between a Field Manager and a compensation figure.

## Permission catalog

| Permission | Owner | Field Manager | Worker |
|---|---|---|---|
| `MANAGE_ORG_USERS` | ✅ | | |
| `MANAGE_WORKERS` | ✅ | ✅ | |
| `APPROVE_ONBOARDING` | ✅ | ✅ | |
| `VIEW_COMPENSATION` **(financial)** | ✅ | | |
| `MANAGE_COMPENSATION` **(financial)** | ✅ | | |
| `VIEW_BANK_INFO` **(financial)** | ✅ | | |
| `MANAGE_SITES` | ✅ | ✅ | |
| `MANAGE_SHIFTS` | ✅ | ✅ | |
| `MANAGE_TURAN` | ✅ | ✅ | |
| `APPROVE_ATTENDANCE` | ✅ | ✅ | |
| `CORRECT_TIME_ENTRIES` | ✅ | ✅ | |
| `APPLY_FULL_DAY_CREDIT` | ✅ | ✅ | |
| `MANAGE_TEMP_SUPERVISORS` | ✅ | ✅ | |
| `VIEW_PAYROLL` **(financial)** | ✅ | | |
| `MANAGE_PAYROLL` **(financial)** | ✅ | | |
| `FINALIZE_PAYROLL` **(financial)** | ✅ | | |
| `VIEW_AUDIT_LOG` | ✅ | | |
| `VIEW_FINANCIAL_DASHBOARD` **(financial)** | ✅ | | |
| `CLOCK_IN_OUT` | ✅ | ✅ | ✅ |
| `VIEW_OWN_ATTENDANCE` | ✅ | ✅ | ✅ |
| `VIEW_OPERATIONS` (Step 6) | ✅ | ✅ | |
| `VIEW_ORG_SETTINGS` (Step 6) | ✅ | ✅ | |
| `MANAGE_ORG_SETTINGS` (Step 6) | ✅ | | |

Owner holds every permission (`OWNER_PERMISSIONS = Object.values(Permission)`).

Since Step 6 the guard takes the role and the time-tracking flag from the
membership on every request, not from the token. A role change on the users
page applies to the very next request; turning time tracking off removes the
worker profile from the request context (no clock-in).
A Field Manager or Worker who is also time-trackable (`isTimeTrackable`)
gets `CLOCK_IN_OUT`/`VIEW_OWN_ATTENDANCE` through their role's own set —
there's no separate "time-trackable" permission layer, since role already
determines what else that clock-in unlocks.

## Attendance screens (Step 5)

Workers read their own attendance through `GET /time-entries`; every admin
attendance route below answers them 403.

| Route | Permission | Owner | Field Manager | Worker |
|---|---|---|---|---|
| `GET /attendance/entries` | `APPROVE_ATTENDANCE` | ✅ | ✅ (same response) | 403 |
| `GET /time-entries/:id/evidence` | `APPROVE_ATTENDANCE` | ✅ | ✅ (same response) | 403 |
| `GET /time-entries/:id/estimated-cost` | `VIEW_COMPENSATION` **(financial)** | ✅ | 403 | 403 |
| `GET /workers/:id/estimated-earnings` | `VIEW_COMPENSATION` **(financial)** | ✅ | 403 | 403 |
| `GET /emergency-callouts`, `GET /emergency-callouts/:id` | `APPROVE_ATTENDANCE` | ✅ with `estimatedCostAgorot` | ✅ no cost key | 403 |
| `GET /forgotten-stamp-infractions` | `APPROVE_ATTENDANCE` | ✅ with `deductionAgorot` | ✅ no deduction key | 403 |
| `POST /forgotten-stamp-infractions/:id/reverse` | `MANAGE_PAYROLL` **(financial)** | ✅ | 403 | 403 |
| `POST /manual-corrections` | `CORRECT_TIME_ENTRIES` | ✅ | ✅ | 403 |

Every route is scoped to the caller's organization: an id from another
organization is a 404, never someone else's data (`attendance-screens.e2e-spec.ts`).

## Temporary Supervisor

Not a role — a time-boxed capability. `TemporarySupervisorAssignment` has
`activatedAt` / `expiresAt` / `revokedAt` and (Step 6)
`canOpenCheckInPoints`.

**Live check.** On every call, the assignment must be the caller's and
ACTIVE right now: not revoked, inside its window, and its shift neither
closed nor cancelled. Nothing is baked into a JWT claim. A Temporary
Supervisor's underlying `OrgRole` is still `WORKER`, so outside the window
they have exactly a Worker's permissions; no elevated access lingers.

**Assigning:**
- `POST /shifts/:id/temporary-supervisors` (Owner / Field Manager,
  `MANAGE_TEMP_SUPERVISORS`).
- Only an active, time-trackable worker assigned to that shift.
- No overlapping assignment for the same worker and shift.
- The shift must be open.

**Revoking:** `DELETE /shifts/temporary-supervisors/:assignmentId`.

**Routes:**

| Route | Who | Not allowed |
|---|---|---|
| `GET /temporary-supervisors/me` | the caller's ACTIVE assignments | (empty list) |
| `GET /temporary-supervisors/:assignmentId/shift` | the supervisor, while ACTIVE | another member's assignment: 404; own but inactive: 403 `TEMPORARY_SUPERVISOR_INACTIVE` |
| `POST /temporary-supervisors/:assignmentId/report-issue` | the supervisor, while ACTIVE | same |
| `POST /shifts/temporary-check-in-points` (open) | managers; the shift's ACTIVE supervisor with `canOpenCheckInPoints` | 403 `FORBIDDEN` / `TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS` |
| `DELETE /shifts/temporary-check-in-points/:pointId` (close) | same as opening | same |

**What the supervised-shift view contains:**
- the shift's own data (title, times, site, project name);
- its workers' operational attendance only: presence, times, location
  outcome, flags.

It has no money, no phone numbers, and nothing about other shifts or
projects. The financial leak scanner signs in as a Temporary Supervisor as
its third role.

## Live operations, settings, users (Step 6)

| Route | Permission | Owner | Field Manager | Worker |
|---|---|---|---|---|
| `GET /operations/live` | `VIEW_OPERATIONS` | ✅ (no money) | ✅ (no money) | 403 |
| `GET /organizations/me/settings` | `VIEW_ORG_SETTINGS` | ✅ with the penalty amount | ✅ read-only, no money key | 403 |
| `PATCH /organizations/me/settings/workday`, `/onboarding`, `/notifications` | `MANAGE_ORG_SETTINGS` | ✅ (audited) | 403 | 403 |
| `GET /memberships`, `GET /memberships/:id/devices` | `MANAGE_ORG_USERS` | ✅ | 403 | 403 |
| `PATCH /memberships/:id/role`, `PATCH /memberships/:id/time-tracking`, `POST /memberships/:id/suspend` / `reactivate` / `archive` | `MANAGE_ORG_USERS` | ✅ (reason required, audited) | 403 | 403 |
| `POST /memberships/:id/sessions/:sessionId/revoke`, `POST /memberships/:id/devices/:deviceId/revoke-key` | `MANAGE_ORG_USERS` | ✅ (reason required, audited) | 403 | 403 |

- **Owners:** an organization keeps at least one active Owner. Demoting,
  suspending or archiving the last one is 409 `LAST_ACTIVE_OWNER`. The
  existing maximum of two active Owners also applies to role changes and
  reactivation (`MAX_OWNERS_REACHED` plus the database trigger).
- **Suspending or archiving a member** ends their sessions at once:
  - refresh-token families revoked;
  - REST calls refused by the guard's live status check;
  - WebSocket and SSE connections closed.
- **Ending a session** refuses its access token at once too: tokens carry
  the session id (`sid`), and the guard checks it.
- **Organization scoping:** every route answers 404 for another
  organization's member. The older `POST /devices/:userId/:deviceId/revoke-key`
  now checks that the user is a member of the caller's organization too
  (before, it did not).

## Payroll and the financial dashboard (Step 7)

| Route | Permission | Owner | Field Manager | Worker |
|---|---|---|---|---|
| `GET /payroll-periods` (one row per month, its latest version) | `VIEW_PAYROLL` **(financial)** | ✅ | 403 | 403 |
| `GET /payroll-periods/:yearMonth` (latest version), `/versions`, `/versions/:version`, `/versions/:version/workers/:workerProfileId`, `/calculation` | `VIEW_PAYROLL` **(financial)** | ✅ | 403 | 403 |
| `GET /payroll-periods/:yearMonth/dashboard` | `VIEW_FINANCIAL_DASHBOARD` **(financial)** | ✅ | 403 | 403 |
| `POST /payroll-periods/:yearMonth/calculate` (202, background job) | `MANAGE_PAYROLL` **(financial)** | ✅ | 403 | 403 |
| `POST /payroll-periods/:yearMonth/adjustments` (manual +/-, reason) | `MANAGE_PAYROLL` **(financial)** | ✅ | 403 | 403 |
| `POST /payroll-periods/:yearMonth/finalize`, `/reopen` (reason) | `FINALIZE_PAYROLL` **(financial)** | ✅ | 403 | 403 |
| `GET /payroll-statements/me` | none: the caller's own worker profile | own (if time-trackable; 404 otherwise) | own (if time-trackable; 404 otherwise) | own only |
| `GET /payroll-periods/:yearMonth/my-payslip` | none: the caller's own worker profile | own | own | own only |

- **The Worker's own pay** (`/payroll-statements/me`, `my-payslip`) takes no
  worker id: every query is bound to the worker profile of the token. It
  comes only from FINALIZED versions (a month's latest finalized one);
  `/payroll-statements/me` adds a DRAFT estimate (`isEstimate: true`) for the
  open month(s). The leak scanner lists both as the only Worker-own-money
  exceptions and checks they never contain another worker's data.
- **The Field Manager's dashboard** is the same page without its financial
  section: it never calls `/dashboard` (and the API answers 403).
- **A finalized month** refuses every edit with 409
  `PAYROLL_PERIOD_FINALIZED`: corrections, full-day credit, approval, sending
  an entry back for correction (Step 7), manual adjustments (Step 7),
  reversing a forgotten-stamp deduction (Step 7), and a new calculation. The
  Owner reopens it with a reason to get a new working version.

## Onboarding (Step 8)

| Route | Permission | Owner | Field Manager | Worker |
|---|---|---|---|---|
| `POST /onboarding-invitations`, `GET /onboarding-invitations`, `DELETE /onboarding-invitations/:id` | `APPROVE_ONBOARDING` | ✅ (audited) | ✅ (audited) | 403 |
| `GET /workers/pending-approval` | `APPROVE_ONBOARDING` | ✅ names and phones | ✅ names and phones | 403 |
| `GET /workers/:id/onboarding-review` (ID number and bank details decrypted) | `VIEW_BANK_INFO` **(financial)** | ✅ (every view audited) | 403 | 403 |
| `GET /file-assets/:id/view-url` (60 s signed URL of an ID document or photo) | `VIEW_BANK_INFO` **(financial)** | ✅ (every view audited) | 403 | 403 |
| `POST /workers/:id/approve` (needs a compensation profile) | `APPROVE_ONBOARDING` + `MANAGE_COMPENSATION` **(financial)** | ✅ | 403 | 403 |
| `POST /workers/:id/reject` (reason, not blank) | `APPROVE_ONBOARDING` | ✅ | ✅ | 403 |
| `GET /onboarding/invitations/:token`, `POST …/:token/uploads`, `POST …/:token/redeem` | none (`@Public`): a usable link | ✅ | ✅ | ✅ |

- **The public routes** need no session. Their only key is the link: one
  guard checks it in constant time, and every unusable link (unknown,
  malformed, used, expired, revoked) is the same 404. They are rate limited
  per IP address and route.
- **ID numbers and bank details** are only ever decrypted for the Owner's
  review. They are not in any other response, log line, audit row or
  notification, for any role, and not in the Owner's other responses
  either. The leak scanner searches every GET response for the seeded
  values; the onboarding tests capture the logs, audit rows and
  notifications.
- **The files themselves** are reachable only through the Owner's view URL.
  Nothing returns a storage key.

## Reports (Step 8)

The routes carry no permission decorator: `report-access.ts` decides per
report type and role, and a refusal is a 403 on the request.

| Report | Owner | Field Manager | Worker |
|---|---|---|---|
| سجل حضور العامل (ledger) | financial copy | operational copy (separate template, no money) | their own ledger only, financial (their own pay) |
| الحضور التشغيلي, مخالفات الموقع | operational (no money for anyone) | operational | 403 |
| الساعات الإضافية, استدعاءات الطوارئ, نسيان التسجيل | financial copy | operational copy (forgotten stamps: counts, no amounts) | 403 |
| الرواتب (from one stored payroll version) | financial | 403 | 403 |

- **Two templates, not hidden sections:** each type with both copies has
  its own loader and template per copy. The operational data has no money
  fields at all, so there is nothing to hide (a unit test checks that the
  two copies use different functions and that operational PDFs and CSVs
  contain no ₪ and no amounts).
- **Who sees a generated report:**
  - in the list, the details, the download and the verify: an Owner, the
    worker it is about, and whoever requested it;
  - a requester who is neither an Owner nor its subject never sees a
    financial copy (for example, one they requested as an Owner before
    becoming a Field Manager);
  - for anyone else every `/reports/:id*` route is a 404, so nothing tells
    the report exists.
- **Every request, download and verification is audited**, and so is the
  generation (`REPORT_REQUESTED`, `REPORT_GENERATED`, `REPORT_DOWNLOADED`,
  `REPORT_VERIFIED`).

## The mobile worker app (Step 9)

| Route | Who | Not allowed |
|---|---|---|
| `PUT /devices/me` | any signed-in member (their own device) | — |
| `POST /attachments`, `POST /attachments/:id/transcription` | members with a worker profile; transcription of their own voice note only | no worker profile: 403; someone else's file: 404 |
| `GET /emergency-callouts/eligibility` | `CLOCK_IN_OUT`, the caller only | — |
| `GET /time-entries/:id` (own detail), `GET /time-entries/:id/my-pay` | the entry's own worker | another worker's entry: 404 |
| `GET /payroll-statements/me/current` | the caller's own worker profile (no id in the route) | no worker profile: 404 |
| `GET/PATCH /notifications/preferences`, `POST /notifications/read-all` | the caller's own membership | — |

- **Own pay only:** `my-pay` and `me/current` are Worker-own-money routes.
  The leak scanner lists them as the only exceptions besides `my-payslip`
  and `/payroll-statements/me`, and checks that another worker gets 404 or
  nothing of the Worker's.
- **Co-workers:** a worker's shift list and detail carry only their own
  assignment: no co-worker's name, phone number or profile id (they did
  before Step 9). The temporary supervisor's view is unchanged (names and
  presence, no phone numbers).
- **Push content:** a push carries an Arabic type label, a generic body and
  ids for the deep link. It never carries another person's name or any
  amount.

## Defense in depth for financial data (spec section 6.2 / 23.5)

A Field Manager must never see rates, earnings, deductions, or cost
figures. This is enforced independently at every layer, not once:

1. **Guard** — `PermissionsGuard` rejects any route requiring a
   `FINANCIAL_PERMISSIONS` member outright (`GET /payroll-periods` → `403`
   for a Field Manager token, verified in `auth-and-rbac.e2e-spec.ts`).
2. **Service** — services that serve both roles (e.g. worker list) never
   fetch compensation columns when the caller isn't authorized, rather
   than fetching-then-filtering. The same applies to every other money
   column: a project's `budgetAgorot` (project endpoints and the project
   nested in `GET /shifts`, via `PROJECT_FIELDS_WITHOUT_BUDGET` in
   `sites/project-fields.ts`) and a forgotten-stamp infraction's
   `deductionAgorot` are only selected for an Owner. The attendance
   screens' estimates are separate Owner-only responses
   (`GET /time-entries/:id/estimated-cost`,
   `GET /workers/:id/estimated-earnings`). The attendance list and evidence
   carry no money for anyone, and only an Owner's emergency call-out DTO is
   built with a cost.
3. **DTO/response mapper** — `worker-response.mapper.ts` strips
   `compensation` from the serialized response unless the viewer is an
   Owner or the worker themself, even if a service accidentally included it.
4. **Notification content** — `ClockEventsService.notifyClockOut()` builds
   two different message bodies from the same event: the Owner's includes
   an estimated cost (computed via the same `calculateShiftCompensation`
   payroll uses), the Field Manager's never does.
5. **PDF and CSV reports** (Step 8) — the financial copy of a report is
   generated only for an Owner or the report's subject worker. A Field
   Manager's copy comes from a separate loader and template without money
   fields: the same evidence (timestamps, GPS, approvals, summaries) and
   no monetary figure, in the PDF and in the CSV.
6. **Frontend** — `apps/admin-web`'s `OwnerOnly` wrapper and role-aware nav
   hide financial routes/widgets client-side, but this is UX polish, not
   the security boundary — verified by
   `owner-only.test.tsx` asserting the financial content is never in the
   rendered DOM for a non-Owner session, on top of the API's own `403`.

## Cross-organization isolation

Every service method scopes its query by the *authenticated* caller's
`organizationId` (resolved fresh from their membership on each request),
never a client-supplied organization ID. There is no code path where a
request for another organization's records can succeed by supplying a
different ID — it isn't filtered out after the fact, it's never queried.
Verified in `auth-and-rbac.e2e-spec.ts`.

## Worker-to-worker isolation

A Worker's `VIEW_OWN_ATTENDANCE`-gated endpoints scope results to their own
`workerProfileId`, resolved from their token, not a request parameter — a
Worker cannot enumerate another worker's time entries, offline-sync
history, or earnings by guessing an ID (`GET /shifts/:id` on an unassigned
shift 404s rather than 403ing, to avoid confirming the shift exists at all).
