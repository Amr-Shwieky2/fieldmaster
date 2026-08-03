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

Owner holds every permission (`OWNER_PERMISSIONS = Object.values(Permission)`).
A Field Manager or Worker who is also time-trackable (`isTimeTrackable`)
gets `CLOCK_IN_OUT`/`VIEW_OWN_ATTENDANCE` through their role's own set —
there's no separate "time-trackable" permission layer, since role already
determines what else that clock-in unlocks.

## Temporary Supervisor

Not a role — a time-boxed capability. `TemporarySupervisorAssignment` has
`activatedAt`/`expiresAt`/`revokedAt`; whether someone currently holds it is
checked live against those columns at the point of action (opening a
temporary check-in point), not baked into a JWT claim. A Temporary
Supervisor's underlying `OrgRole` is still `WORKER`, so outside their
assignment window they have exactly a Worker's permissions — no elevated
access lingers.

## Defense in depth for financial data (spec section 6.2 / 23.5)

A Field Manager must never see rates, earnings, deductions, or cost
figures. This is enforced independently at every layer, not once:

1. **Guard** — `PermissionsGuard` rejects any route requiring a
   `FINANCIAL_PERMISSIONS` member outright (`GET /payroll-periods` → `403`
   for a Field Manager token, verified in `auth-and-rbac.e2e-spec.ts`).
2. **Service** — services that serve both roles (e.g. worker list) never
   fetch compensation columns when the caller isn't authorized, rather
   than fetching-then-filtering.
3. **DTO/response mapper** — `worker-response.mapper.ts` strips
   `compensation` from the serialized response unless the viewer is an
   Owner or the worker themself, even if a service accidentally included it.
4. **Notification content** — `ClockEventsService.notifyClockOut()` builds
   two different message bodies from the same event: the Owner's includes
   an estimated cost (computed via the same `calculateShiftCompensation`
   payroll uses), the Field Manager's never does.
5. **PDF reports** — `ReportsService` generates financial sections only
   when the requester is an Owner or the report's subject worker; a Field
   Manager's generated PDF has the same evidentiary content (timestamps,
   GPS, approvals, summaries) minus every monetary figure.
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
