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

## Work rules: organization settings, in versions

The numbers below were fixed constants until the flexible organization
model. They are now the organization's **work rules**
(`packages/shared-types/src/work-rules.ts`), with these defaults:

| Rule | Key | Default |
|---|---|---|
| Standard day | `standardDayMinutes` | 540 (9 h) |
| Overtime threshold | `overtimeThresholdMinutes` | 540 |
| Free forgotten stamps per month | `freeForgottenStampsPerMonth` | 2 |
| Penalty per further forgotten stamp **(money)** | `forgottenStampPenaltyAgorot` | 1,000 (10.00 ₪) |
| Emergency: minutes credited before the start click | `emergencyMinutesBefore` | 60 |
| Emergency: minutes credited after the end click | `emergencyMinutesAfter` | 15 |
| Clock-in opens this many minutes before the shift | `clockInEarlyWindowMinutes` | 60 |

How history is protected:

- **Versions, never edits.** A change is a new row of `work_rule_versions`
  with an effective date (Settings → قواعد العمل). A database trigger
  refuses any UPDATE or DELETE of a version. The effective date must be
  after today (`WORK_RULES_EFFECTIVE_DATE_PAST`), so a change never reaches
  a day that already happened. The first change also stores the starting
  values as version 1 (effective 2000-01-01, «القيم الأصلية»), so the
  history is whole. An organization that never changed a rule has no rows
  and uses the defaults.
- **Each calculation uses the version in force on the date it is about**
  (`pickWorkRules`: the latest effective date on or before it):
  - an entry's standard day, threshold and split (approval, payroll,
    estimates, reports): the entry's business date;
  - a forgotten stamp's free count and penalty: the infraction's day (the
    added clock-in's date, or the day of the correction); the penalty is
    stored on the adjustment when it is created, so a later change of the
    penalty never touches existing adjustments;
  - an emergency's minutes before and after: the day of the start click
    (the minutes before are stored on the call-out at the start);
  - the clock-in window: the shift's business date.
  A change in the middle of a month applies from its date only: earlier
  days of the same month keep the earlier version.
- **Finalized payroll keeps its snapshot.** A calculation stores the
  versions it used in its snapshot (`inputs.workRules`), and its inputs
  fingerprint includes the version ids, so a new version makes an open
  month "changed since calculation" while a finalized month is read from
  its stored calculation, never recalculated.
- **The settings page warns** which open months the change will recalculate
  and which finalized months keep their snapshot
  (`GET /organizations/me/work-rules/impact?effectiveFrom=`).
- **Money stays money:** the penalty and its limits are only shown to, and
  only changeable by, a member with `VIEW_FINANCIALS`.

The formulas below use the default numbers; read 540 as "the standard day
(or overtime threshold) in force on the entry's business date", 60 / 15 as
the emergency minutes in force, and so on.

## The nine-hour standard day

`STANDARD_DAY_MINUTES = 540` (9 hours) is the default standard day
(`DEFAULT_WORK_RULES` in `packages/shared-types`); each organization's
versions can change it from a future date. Daily pay counts a full day from
the standard day and overtime beyond the overtime threshold (equal by
default); hourly pay counts regular minutes up to the threshold.

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

(defaults: the free count and the penalty are the work rules in force on
the infraction's day)
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

## A month's payroll (Step 7)

`packages/shared-validation/src/payroll-month.ts` turns plain data into a
month's payroll. The background calculation, the Owner dashboard's live
figures, the worker's estimate and the seed all call it.

**Inputs, and only these** (`PayrollInputsService`):
- the month's **APPROVED** time entries (business date `YYYY-MM-*`, Asia/Jerusalem) with their approved regular / overtime minutes and full-day credit;
- for an emergency call-out, its -60 / +15 minutes (already inside its approved, compensated minutes: they are reported, not added again);
- each entry's compensation profile **in effect on its business date** (`pickEffectiveCompensationProfile`: started on or before it, not ended before it);
- the month's adjustments: forgotten-stamp penalties and their reversals, manual bonuses and deductions.

Entries waiting for approval (`PENDING_APPROVAL`, `CORRECTION_REQUESTED`)
are only **counted** ("بانتظار الموافقة — غير محسوبة"), never paid. An
approved entry with no profile on its date pays nothing and the calculation
**warns** with the worker's name and dates; it does not block.

**Per worker** (`calculateWorkerPayroll`; everyone with an approved entry or an adjustment):

```text
approvedShifts             = approved entries that had a profile
standardDaysCredited       = daily entries credited a full day
regularMinutes, overtimeMinutes          (from the calculators above)
emergencyRetroactiveMinutes, emergencyReturnMinutes   (60 / 15 per call-out)
grossBaseAgorot, overtimeAgorot          (sum of each entry's calculator result)
positiveAdjustmentsAgorot     = manual bonuses
forgottenStampPenaltiesAgorot = penalties (positive amount)
reversalsAgorot               = reversals of penalties (positive amount)
otherDeductionsAgorot         = manual deductions (positive amount)
netPayableAgorot = gross + overtime + positive + reversals - penalties - other
```

Only additions of integer agorot: every amount comes from the calculators'
single rounding step. Worked examples (tests, fixtures daily 45,000 /
hourly 5,000 / overtime 7,000 agorot):

| Case | Pay |
|---|---|
| Daily 9 h | 45,000 |
| Daily 6 h, no credit | round(45,000 × 360 / 540) = 30,000 |
| Daily 6 h, full-day credit | 45,000 |
| Daily 10 h 30 m | 45,000 + round(90 × 7,000 / 60) = 45,000 + 10,500 |
| Hourly 6 h | 5,000 × 6 = 30,000 |
| Hourly, Night Turan emergency 02:00-03:00 | paid 01:00-03:15 = 135 min → 5,000 × 135 / 60 = 11,250 |
| 4 forgotten stamps in a month | sequences 3 and 4 → -1,000 each = -2,000 |
| … one of them reversed | -2,000 + 1,000 = -1,000 (the penalty stays; the reversal offsets it) |

## Payroll period lifecycle and versions (Step 7)

A month's payroll is a chain of **versions** (one `payroll_periods` row
each). The latest is the working version:

```text
OPEN ──calculate──▶ CALCULATING ──job done──▶ REVIEW ──finalize──▶ FINALIZED
  ▲                      │ job failed: back to OPEN / REVIEW / REOPENED     │
  │                      ▼                                                  │ reopen (Owner, reason)
  └─────────── REVIEW ◀── recalculate                    next version: REOPENED
```

- **Calculate** is a BullMQ job: `POST .../calculate` answers 202 with a
  `payroll_calculation_runs` row (`QUEUED` → `RUNNING` → `SUCCEEDED` /
  `FAILED`, progress 0-100). The same Idempotency-Key always answers the same
  run. One QUEUED/RUNNING run per version (a partial unique index); another
  request is 409 `PAYROLL_CALCULATION_IN_PROGRESS`. A run with no news for 15
  minutes (its job was lost) is marked FAILED (`PAYROLL_CALCULATION_STALE`)
  by the next request, which takes over.
- **A calculation** stores one immutable **snapshot**: the inputs (every
  approved entry with its shift, project and site, the profiles, the
  adjustments, worker names, pending counts), the per-worker and per-entry
  results, the per-project / per-site labor cost, the warnings and the
  totals. The version's items mirror it. A failed job leaves the previous
  results as they were.
- **Finalize** (Owner, REVIEW only) freezes the version. Database triggers
  refuse any later change to it, its items or any snapshot. Every edit of a
  finalized month is 409 `PAYROLL_PERIOD_FINALIZED`: corrections, full-day
  credit, approval, sending an entry back for correction, manual
  adjustments, reversing a forgotten-stamp deduction, and a new calculation.
- **Reopen** (Owner, reason required) creates the next version (`REOPENED`,
  nothing calculated yet) linked to the finalized one, which stays exactly
  as it was and readable (`GET .../versions/:version`). The version history
  shows who created, calculated, reopened (and why) and finalized each one.
- **Reading a version never recalculates anything**: it is shown from its
  snapshot. Live data is only used to say what a WORKING version lacks:
  adjustments added after its calculation, and whether the approved entries,
  profiles or adjustments changed since (`changedSinceCalculation`, from the
  snapshot's inputs hash).

Before Step 7, reopen bumped the version on the same row and the next
calculation overwrote it; the migration restored those earlier versions as
their own rows (see `database-design.md`).

## The Owner dashboard (Step 7)

`GET /payroll-periods/:yearMonth/dashboard`, `VIEW_FINANCIAL_DASHBOARD`
(an Owner, or a custom role with the money group, never a member restricted
to some projects). A month whose latest version is FINALIZED is shown from
that version's snapshot (`source: FINALIZED`); any other month is
calculated live, with the same engine, from its approved attendance and
adjustments (`source: LIVE`). The previous month, only compared by its
totals, reads only the stored totals of a finalized version, or calculates
just the totals. It returns the
month's net payable and labor cost against the previous month, labor cost
per project, per site and per worker (net after adjustments), the five top
earners, overtime (agorot, minutes, spikes), forgotten-stamp deductions
(penalties, reversals, net), emergency call-outs (count, compensated
minutes, cost), the daily labor cost of every day of the month (up to
today), and the pending-approval exposure (always live: entries waiting for
approval, priced as approval would split them).

**Overtime spike** (a reporting rule; no pay depends on it): a business day
is a spike when its approved overtime minutes, all workers together, are at
least **twice the month's average overtime per working day** and at least
**60 minutes**. A working day is a day with at least one approved, paid
shift. Compared in integers (`dayMinutes × workingDays ≥ 2 × totalMinutes`),
so there is no rounding. Example: 240 overtime minutes over 4 working days →
average 60 → threshold 120: a day with 180 minutes is a spike, a day with 60
is not. Constants `OVERTIME_SPIKE_FACTOR` / `OVERTIME_SPIKE_MIN_MINUTES` in
`packages/shared-types`, function `findOvertimeSpikes`.

## The worker's own statements (Step 7)

`GET /payroll-statements/me` (the mobile screen is Step 9): the caller's
own months only, bound to the worker profile of the token.
- **Statements** come only from FINALIZED versions: each month's latest
  finalized version (a reopened month keeps showing it until the next
  version is finalized).
- **Estimates** (`status: DRAFT`, `isEstimate: true`): the current month,
  and the previous one until it is finalized, calculated from the caller's
  approved attendance and adjustments so far, with the count of their
  entries still waiting for approval.
- Each has base, overtime, gross (base + overtime), adjustments (bonuses
  minus manual deductions), forgotten-stamp deductions (penalties minus
  reversals) and net.

## CSV export (admin web)

The period page exports the version shown (`payroll-YYYY-MM-vN.csv`):
UTF-8 with a BOM, Western digits, shekels with 2 decimals and no thousands
separator (`450.00`, `-20.00`), minutes as integers, one row per worker plus
a totals row. Deductions are negative, so each row's money cells add up to
its net. Text cells starting with `=`, `+`, `-`, `@` (or a tab / carriage
return) are prefixed with `'` so a spreadsheet never runs them as formulas.
