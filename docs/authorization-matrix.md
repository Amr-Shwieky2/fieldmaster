# Authorization Matrix

Source of truth: the permission catalog in
`packages/shared-types/src/permissions.ts`, re-exported by
`apps/api/src/common/auth/permissions.ts`. Every protected route declares its
required `Permission`(s) via `@RequirePermissions(...)`; `PermissionsGuard`
checks them against the caller's **effective permissions**, which the JWT
guard works out from the membership on every request (flexible organization
model, see below). Financial permissions are additionally checked redundantly
at the service and DTO-serialization layers (see "Defense in depth" below) —
the permission catalog alone is not the only thing standing between a member
without money access and a compensation figure.

## Roles are permission sets (flexible organization model)

What a member sees and may do comes from their permissions, never from a
role name:

- **Built-in (system) roles** — المالك (Owner), مدير ميدان (Field Manager),
  عامل (Worker) — exist in every organization as rows of `roles` with a
  `system_key`. Their permissions are fixed in code
  (`SYSTEM_ROLE_PERMISSIONS`), exactly today's sets, and cannot be edited or
  archived (`SYSTEM_ROLE_IMMUTABLE`).
- **Custom roles** have a name and a checklist of permissions grouped in
  Arabic: الحضور، الجدولة، المواقع، العمال، الرواتب والمالية، التقارير،
  الإعدادات، سجل التدقيق. A permission that needs another one gets it too
  (`PERMISSION_REQUIRES`: approving needs seeing attendance, every money
  permission needs `VIEW_FINANCIALS`, …); a list that leaves one out is 400
  `INVALID_ROLE_PERMISSIONS`. Names are unique among active roles
  (`ROLE_NAME_TAKEN`); a role still assigned cannot be archived
  (`ROLE_IN_USE`).
- **A member has one role** (`organization_memberships.role_id`; the `role`
  column keeps the kind: OWNER, FIELD_MANAGER, WORKER or CUSTOM). Time
  tracking stays a separate flag (`isTimeTrackable`).
- **Money is one explicit group.** `VIEW_FINANCIALS` («رؤية المبالغ
  المالية») and the permissions that need it (compensation, bank details,
  payroll, the financial dashboard, financial reports). Every place that
  used to check "is Owner" for money now checks `VIEW_FINANCIALS`
  (`canViewFinancials`). The financial leak scanner runs for every role
  without it — the Field Manager, the Worker, the Temporary Supervisor and a
  custom role with everything but money — and finds no amount.
- **Optional project scope.** A member is either unrestricted or restricted
  to selected projects and/or sites (`member_scopes` rows plus
  `restricted_to_scope`). A restricted member:
  - sees only their projects' shifts, sites, workers, attendance, approvals,
    corrections, operations map, reports, notifications and real-time
    events (another project's record answers 404, like an unknown id);
  - loses every organization-wide permission whatever the role says
    (`ORG_WIDE_PERMISSION_LIST`: users, roles, settings changes, audit log,
    payroll, the financial dashboard, compensation changes, onboarding
    approval, bank details, the Turan rota);
  - cannot create a project (`SCOPE_RESTRICTED`) or a shift outside the scope.
- **Changes apply on the next request.** The guard reads the role record and
  the scope from the database on every call; tokens carry no permissions.
- **Safety rules:**
  - at least one active member always holds both «إدارة الأدوار»
    (`MANAGE_ROLES`) and «إدارة الإعدادات» (`MANAGE_ORG_SETTINGS`), counted
    under an advisory lock: changing a role, the role's permissions, the
    scope, suspending or archiving the last such member is 409 `LAST_ADMIN`
    (`LAST_ACTIVE_OWNER` when that member is an Owner) — so an Owner cannot
    lock themselves out either;
  - every change is audited old → new with its reason (`MEMBERSHIP_ROLE_CHANGED`
    with the role as `OWNER` or `CUSTOM:<name>`, `MEMBERSHIP_SCOPE_CHANGED`
    as `all` or `projects:…;sites:…`, `ROLE_CREATED` / `ROLE_UPDATED` /
    `ROLE_ARCHIVED`).
- **The Owner limit is a setting**: «الحد الأقصى للمالكين»
  (`organization_settings.max_owners`, empty = no limit; organizations that
  existed before keep 2). It is enforced by the service and by the database
  trigger `enforce_max_owners`, both under the same advisory lock, so two
  concurrent promotions cannot both pass (`MAX_OWNERS_REACHED`). Lowering it
  below the current number of active Owners is 409
  `OWNER_LIMIT_BELOW_CURRENT`.

### Built-in roles

| Permission | Group | Owner | Field Manager | Worker |
|---|---|---|---|---|
| `CLOCK_IN_OUT` | الحضور | ✅ | ✅ | ✅ |
| `VIEW_OWN_ATTENDANCE` | الحضور | ✅ | ✅ | ✅ |
| `VIEW_ATTENDANCE` (new: reading everyone's attendance) | الحضور | ✅ | ✅ | |
| `VIEW_OPERATIONS` | الحضور | ✅ | ✅ | |
| `APPROVE_ATTENDANCE` | الحضور | ✅ | ✅ | |
| `CORRECT_TIME_ENTRIES` | الحضور | ✅ | ✅ | |
| `APPLY_FULL_DAY_CREDIT` | الحضور | ✅ | ✅ | |
| `VIEW_SHIFTS` (new: the organization's shift list) | الجدولة | ✅ | ✅ | |
| `MANAGE_SHIFTS` | الجدولة | ✅ | ✅ | |
| `MANAGE_TURAN` | الجدولة | ✅ | ✅ | |
| `MANAGE_TEMP_SUPERVISORS` | الجدولة | ✅ | ✅ | |
| `MANAGE_SITES` | المواقع | ✅ | ✅ | |
| `MANAGE_WORKERS` | العمال | ✅ | ✅ | |
| `APPROVE_ONBOARDING` | العمال | ✅ | ✅ | |
| `VIEW_FINANCIALS` **(financial, new)** | الرواتب والمالية | ✅ | | |
| `VIEW_COMPENSATION` **(financial)** | الرواتب والمالية | ✅ | | |
| `MANAGE_COMPENSATION` **(financial)** | الرواتب والمالية | ✅ | | |
| `VIEW_BANK_INFO` **(financial)** | الرواتب والمالية | ✅ | | |
| `VIEW_PAYROLL` **(financial)** | الرواتب والمالية | ✅ | | |
| `MANAGE_PAYROLL` **(financial)** | الرواتب والمالية | ✅ | | |
| `FINALIZE_PAYROLL` **(financial)** | الرواتب والمالية | ✅ | | |
| `VIEW_FINANCIAL_DASHBOARD` **(financial)** | الرواتب والمالية | ✅ | | |
| `GENERATE_OPERATIONAL_REPORTS` (new) | التقارير | ✅ | ✅ | |
| `GENERATE_FINANCIAL_REPORTS` **(financial, new)** | التقارير | ✅ | | |
| `VIEW_ORG_SETTINGS` | الإعدادات | ✅ | ✅ | |
| `MANAGE_ORG_SETTINGS` | الإعدادات | ✅ | | |
| `MANAGE_ORG_USERS` | الإعدادات | ✅ | | |
| `MANAGE_ROLES` (new) | الإعدادات | ✅ | | |
| `VIEW_AUDIT_LOG` | سجل التدقيق | ✅ | | |

The new permissions only name what the built-in roles could already do
(`VIEW_ATTENDANCE` and `VIEW_SHIFTS` were "is a manager" checks,
`GENERATE_*_REPORTS` were role checks in the report rules), so every existing
member keeps exactly the access they had — the existing test suites pass
unchanged.

Since Step 6 the guard takes the role and the time-tracking flag from the
membership on every request, not from the token. A role change on the users
page applies to the very next request; turning time tracking off removes the
worker profile from the request context (no clock-in).

### Roles, scope and limits routes

| Route | Permission |
|---|---|
| `GET /roles/catalog`, `GET /roles`, `GET /roles/:id` | `MANAGE_ROLES` or `MANAGE_ORG_USERS` |
| `POST /roles`, `PATCH /roles/:id`, `POST /roles/:id/archive` | `MANAGE_ROLES` (reason required, audited) |
| `GET /memberships/access` | `MANAGE_ORG_USERS` |
| `PATCH /memberships/:id/role` (`role` or `roleId`), `PATCH /memberships/:id/scope` | `MANAGE_ORG_USERS` (reason required, audited) |
| `GET /organizations/me/owner-limit` | `VIEW_ORG_SETTINGS` |
| `PATCH /organizations/me/settings/owners` | `MANAGE_ORG_SETTINGS` (audited) |
| `GET /organizations/me/work-rules`, `GET /organizations/me/work-rules/impact` | `VIEW_ORG_SETTINGS` (the penalty only with `VIEW_FINANCIALS`) |
| `POST /organizations/me/work-rules` | `MANAGE_ORG_SETTINGS`; changing the penalty also needs `VIEW_FINANCIALS` (403) |
| `GET /auth/me` | any member: their permissions, scope and the non-money work rules |

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

- **Owners:** an organization keeps at least one active member who can
  manage roles and settings. Demoting, suspending or archiving the last one
  is 409 `LAST_ACTIVE_OWNER` (an Owner) or `LAST_ADMIN` (a custom role).
  The organization's Owner limit («الحد الأقصى للمالكين», no limit unless
  set) also applies to role changes and reactivation (`MAX_OWNERS_REACHED`
  plus the database trigger). Until the flexible organization model the
  limit was a fixed two.
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
report type and permission (`GENERATE_FINANCIAL_REPORTS` with
`VIEW_FINANCIALS` for a financial copy, `GENERATE_OPERATIONAL_REPORTS` for an
operational one), and a refusal is a 403 on the request. The columns below
are the built-in roles; a custom role gets the column its permissions match.
A member restricted to some projects gets reports of their projects only, and
the reports that cover the whole organization (emergency call-outs, payroll)
are 403 `SCOPE_RESTRICTED` for them.

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
  - in the list, the details, the download and the verify: an unrestricted
    member who may generate financial reports, the worker it is about, and
    whoever requested it;
  - a requester without the financial permission who is not its subject
    never sees a financial copy (for example, one they requested as an Owner
    before becoming a Field Manager);
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

A member without `VIEW_FINANCIALS` (a Field Manager, a Worker, a Temporary
Supervisor, any custom role without the money group) must never see rates,
earnings, deductions, budgets or cost figures. This is enforced
independently at every layer, not once:

1. **Guard** — `PermissionsGuard` rejects any route requiring a financial
   permission outright (`GET /payroll-periods` → `403` for a Field Manager
   token, verified in `auth-and-rbac.e2e-spec.ts`).
2. **Service** — services that serve both kinds of member (e.g. worker
   list) never fetch compensation columns when the caller isn't authorized,
   rather than fetching-then-filtering. The same applies to every other
   money column: a project's `budgetAgorot` (project endpoints and the
   project nested in `GET /shifts`, via `PROJECT_FIELDS_WITHOUT_BUDGET` in
   `sites/project-fields.ts`), a forgotten-stamp infraction's
   `deductionAgorot` and the penalty rule (settings, work rules and their
   limits) are only selected for a member with `VIEW_FINANCIALS`
   (`canViewFinancials`). The attendance screens' estimates are separate
   responses behind a financial permission
   (`GET /time-entries/:id/estimated-cost`,
   `GET /workers/:id/estimated-earnings`). The attendance list and evidence
   carry no money for anyone, and only a money viewer's emergency call-out
   DTO is built with a cost. Audit-log rows about money (deductions,
   adjustments, the penalty rule, any `*Agorot` field) are redacted for a
   viewer without it (`audit-redaction.ts`).
3. **DTO/response mapper** — `worker-response.mapper.ts` strips
   `compensation` from the serialized response unless the viewer may see
   compensation or is the worker themself, even if a service accidentally
   included it.
4. **Notification content** — `ClockEventsService.notifyClockOut()` builds
   two different message bodies from the same event: the copy for
   recipients with `VIEW_FINANCIALS` includes an estimated cost (computed via
   the same `calculateShiftCompensation` payroll uses), the other one never
   does, and the shift's manager always gets the copy without money.
5. **PDF and CSV reports** (Step 8) — the financial copy of a report is
   generated only for a member with the financial report permission or the
   report's subject worker. Everyone else's copy comes from a separate
   loader and template without money fields: the same evidence (timestamps,
   GPS, approvals, summaries) and no monetary figure, in the PDF and in the
   CSV.
6. **Frontend** — the admin web hides financial routes and widgets by the
   session's permissions, but this is UX polish, not the security boundary
   — the rendered-DOM tests assert the financial content is never there for
   a session without the permission, on top of the API's own `403`.
7. **The leak scanner** (`financial-leak-scanner.e2e-spec.ts`) calls every
   GET route as each role without `VIEW_FINANCIALS` — the built-in ones and
   custom roles created through the API, including one restricted to
   another project — and fails on any money key or amount in any response.

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
