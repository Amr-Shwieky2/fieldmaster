# Payroll Calculations

All formulas live in `packages/shared-validation/src/payroll.ts`,
`emergency.ts`, and `forgotten-stamp.ts` — pure functions, unit-tested
independently of the database (`packages/shared-validation/src/__tests__/`),
and the *only* place these numbers are computed; nothing re-derives payroll
math separately for, say, the PDF report or the owner notification (both
call the same `calculateShiftCompensation`/`calculateDailyCompensation`/
`calculateHourlyCompensation` functions).

**All monetary values are integers in agorot** (1 ILS = 100 agorot). No
calculation in this codebase uses floating-point arithmetic for money —
every formula does integer multiplication/division with exactly one
rounding step.

## The nine-hour standard day

`STANDARD_DAY_MINUTES = 540` (9 hours), defined once in
`packages/shared-types`.

### Daily compensation

```text
if approvedMinutes >= 540:
    base = dailyBaseRateAgorot
    overtimeMinutes = approvedMinutes - 540
    overtime = round(overtimeMinutes * overtimeHourlyRateAgorot / 60)
elif fullDayCredit:
    base = dailyBaseRateAgorot
    overtime = 0
else:
    base = round(dailyBaseRateAgorot * approvedMinutes / 540)   # proration
    overtime = 0
total = base + overtime
```

A single shift can never earn more than one standard day's base pay — extra
time beyond 540 minutes is always overtime, never a second base-day credit.

### Hourly compensation

```text
regularMinutes = min(approvedMinutes, 540)
overtimeMinutes = max(0, approvedMinutes - 540)
if fullDayCredit and approvedMinutes < 540:
    regularMinutes = 540   # credits a full 9 regular hours, not the actual (shorter) time
regular = round(baseHourlyRateAgorot * regularMinutes / 60)
overtime = round(overtimeHourlyRateAgorot * overtimeMinutes / 60)
total = regular + overtime
```

Manual full-day credit never creates overtime in either compensation type
— it only raises the *regular* minutes counted, up to the 540-minute cap.

## Manual full-day credit

Gated (checked server-side, not just hidden in the UI) on: the shift has
ended, approved minutes are under 540, and the payroll period isn't
finalized. A reason is mandatory and stored with an immutable audit trail
(old value, new value, applied-by, applied-at). Field Managers can apply
this — an operational judgment call — without ever seeing what it's worth
in money; the resulting compensation is computed later, at payroll
calculation time, from a compensation profile a Field Manager never sees
either.

## Overtime notification content

`ClockEventsService.notifyClockOut()` computes the same regular/overtime
split for both the Owner and Field Manager notification bodies, but only
the Owner's body appends an estimated cost line (computed via
`calculateShiftCompensation` against the worker's currently-effective
compensation profile). The Field Manager's message ends at "Approval is
required."

## Emergency call-out compensation (Night Turan)

`packages/shared-validation/src/emergency.ts`'s `computeEmergencyCompensation`:

```text
compensatedStart = actualStartClick - 60 minutes   # retroactive credit
compensatedEnd   = actualEndClick   + 15 minutes   # return-commute buffer
compensatedDurationMinutes = compensatedEnd - compensatedStart
```

The *actual* click timestamps are stored and never overwritten — the UI
displays actual vs. compensated separately so a worker can see exactly
where the extra 75 minutes of paid time came from, rather than a single
opaque total. Example from the seed data: an emergency call-out with an
actual 3-hour on-site duration (02:00–05:00) yields a compensated duration
of 4 hours 15 minutes (01:00–05:15).

## Forgotten-stamp two-strike rule

`packages/shared-validation/src/forgotten-stamp.ts`'s
`evaluateForgottenStampInfraction(monthlySequenceNumber)`:

```text
sequence 1, 2  -> deductionAgorot = 0
sequence 3+    -> deductionAgorot = 1000   (10.00 ILS, exactly, every time)
```

The sequence number is per worker, per calendar month, in `Asia/Jerusalem`
(`ForgottenStampService` computes `businessMonth` via `toBusinessDate()`
before counting). Only corrections classified as `FORGOTTEN_CLOCK_IN` or
`FORGOTTEN_CLOCK_OUT` count — `DEVICE_FAILURE`, `BROKEN_PHONE`,
`NO_CONNECTIVITY`, and `SYSTEM_ERROR` corrections never create an
infraction, tested explicitly (`does not count a DEVICE_FAILURE correction
as a forgotten-stamp infraction`, `attendance-flow.e2e-spec.ts`). Every
deducting infraction creates a `PayrollAdjustment`
(`type: FORGOTTEN_STAMP_PENALTY, source: SYSTEM, amountAgorot: -1000`),
linked to the infraction, independent of whether that month's payroll has
been calculated yet — see `technical-decisions.md` for why adjustments
exist independently of a `PayrollItem`. An Owner can reverse a deduction; the
reversal creates a *new*, offsetting adjustment — the original deducting
adjustment is never deleted or mutated, preserving history.

## Payroll period lifecycle

`OPEN → CALCULATING → REVIEW → FINALIZED`, with `REOPENED` available from
`FINALIZED` (Owner-only, requires a reason, bumps `version`).
`PayrollCalculationSnapshot` records a JSON snapshot of inputs and results
on every calculation. Finalized periods block further edits to included
shifts — both full-day-credit and manual-correction endpoints check the
period's status and reject with `409 PAYROLL_PERIOD_FINALIZED`, tested in
`payroll.e2e-spec.ts` (`calculate → finalize → block-edit → reopen`).
