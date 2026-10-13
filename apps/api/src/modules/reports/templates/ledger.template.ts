import { AttendanceFlag, ClockEventType } from "@fieldmaster/shared-types";
import { EM_DASH, formatDateTime, formatMinutes, formatMonth } from "@fieldmaster/i18n/node";
import { attemptReason, commonText, enumLabel, rd } from "../render/messages";
import { dataTable, EMPTY, fmt, markup, keyValueTable, rdHtml, section, userText, type CellValue, type SafeHtml } from "../render/html";
import { buildCsv, csv, unitHeader, type CsvCell } from "../render/csv";
import { operationalNotice, projectAndSite, projectText, shiftTitle, shiftTitleText, siteText, standardHeader, summaryBlock } from "./common";
import type { ReportDocumentMeta } from "../report.types";
import type {
  LedgerEntry,
  LedgerFinancialData,
  LedgerFinancialEntry,
  LedgerOperationalData,
  LedgerOperationalTotals,
  LedgerRejectedAttempt,
  LedgerUnlinkedAttempt,
} from "../data/ledger.data";

/**
 * The worker attendance ledger. `ledgerOperationalBody` / `ledgerOperationalCsv`
 * (a Field Manager's ledger) take `LedgerOperationalData`, which has no money
 * field; `ledgerFinancialBody` / `ledgerFinancialCsv` take
 * `LedgerFinancialData`. The evidence blocks both use only read the
 * money-free `LedgerEntry`.
 */

// ── Evidence blocks (no money) ─────────────────────────────────────────────

const ALERT_FLAGS: string[] = [AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT, AttendanceFlag.SUSPICIOUS_LOCATION];

function entryTitle(entry: LedgerEntry): SafeHtml {
  return markup`<div class="entry-title">
    <h3>${fmt.date(entry.businessDate)} — ${shiftTitle(entry.shift.title, entry.shift.shiftType)}</h3>
    <span class="tag">${enumLabel("TimeEntryStatus", entry.status)}</span>
    ${entry.flags.map((flag) => markup`<span class="tag${ALERT_FLAGS.includes(flag) ? " alert" : ""}">${enumLabel("AttendanceFlag", flag)}</span>`)}
  </div>`;
}

function fullDayCredit(entry: LedgerEntry): SafeHtml {
  if (!entry.fullDayCredit.applied) return markup`${rd("ledger.fullDayCreditNotApplied")}`;
  return markup`${rdHtml("ledger.fullDayCreditApplied", { reason: userText(entry.fullDayCredit.reason) })}
  ${rdHtml("ledger.byAt", {
    name: userText(entry.fullDayCredit.byName ?? rd("common.systemActor")),
    time: fmt.dateTime(entry.fullDayCredit.at),
  })}`;
}

function entryFacts(entry: LedgerEntry): SafeHtml {
  const pairs: [string, CellValue][] = [
    [rd("columns.projectSite"), projectAndSite(entry.shift.projectName, entry.shift.siteName)],
    [rd("columns.shiftType"), fmt.label("ShiftType", entry.shift.shiftType)],
    [rd("columns.checkInMethod"), fmt.label("CheckInMethod", entry.checkInMethod)],
    [rd("ledger.scheduled"), rd("ledger.scheduledValue", { start: formatDateTime(entry.shift.scheduledStart), end: formatDateTime(entry.shift.scheduledEnd) })],
    [rd("ledger.validatedClockIn"), entry.clockInAt ? fmt.dateTime(entry.clockInAt) : EM_DASH],
    [rd("ledger.validatedClockOut"), entry.clockOutAt ? fmt.dateTime(entry.clockOutAt) : rd("common.notEnded")],
    [rd("columns.duration"), fmt.minutes(entry.minutes.raw)],
    [rd("columns.unpaidBreak"), fmt.minutes(entry.minutes.unpaidBreak)],
    [rd("columns.worked"), fmt.minutes(entry.minutes.worked)],
    [rd("columns.regular"), fmt.minutes(entry.minutes.regular)],
    [rd("columns.overtime"), fmt.minutes(entry.minutes.overtime)],
    [rd("ledger.minutesBasis"), rd(`values.durationBasis.${entry.minutes.basis}`)],
    [commonText("creditAsFullDay"), fullDayCredit(entry)],
    [
      rd("ledger.approvedBy"),
      entry.approvedByName ? rdHtml("ledger.byAt", { name: userText(entry.approvedByName), time: fmt.dateTime(entry.approvedAt) }) : EM_DASH,
    ],
  ];
  if (entry.rejectedReason) pairs.push([rd("ledger.rejectedReason"), userText(entry.rejectedReason)]);
  return markup`${keyValueTable(pairs)}${entry.minutes.approvedSplitOutdated ? markup`<p class="note">${rd("ledger.splitOutdated")}</p>` : EMPTY}`;
}

function clockEvents(entry: LedgerEntry): SafeHtml {
  if (entry.clockEvents.length === 0) return markup`<p class="note">${rd("ledger.noClockEvents")}</p>`;
  return dataTable(
    [
      rd("columns.event"),
      rd("columns.deviceTime"),
      rd("columns.serverTime"),
      rd("columns.validatedTime"),
      rd("columns.deviation"),
      rd("columns.coordinates"),
      rd("columns.locationResult"),
      rd("columns.origin"),
    ],
    entry.clockEvents.map((event) => [
      markup`${enumLabel("ClockEventType", event.eventType)}${event.isManualCorrection ? markup`<br /><span class="muted">${rd("values.manualCorrection")}</span>` : EMPTY}`,
      fmt.dateTime(event.deviceTimestamp),
      fmt.dateTime(event.serverReceivedAt),
      event.validatedAt ? fmt.dateTime(event.validatedAt) : EM_DASH,
      fmt.seconds(event.deviceTimeDeviationSeconds),
      markup`${fmt.coordinates(event.latitude, event.longitude)}<br />${rdHtml("values.accuracy", { value: fmt.meters(event.accuracyMeters) })}`,
      markup`${enumLabel("LocationValidationStatus", event.locationValidationStatus)}${
        event.distanceFromSiteMeters !== null ? markup`<br />${rdHtml("values.distance", { value: fmt.meters(event.distanceFromSiteMeters) })}` : EMPTY
      }${event.temporaryPointName ? markup`<br />${rdHtml("values.atTemporaryPoint", { name: userText(event.temporaryPointName) })}` : EMPTY}${
        event.mockLocationSuspected ? markup`<br /><strong>${rd("values.mockSuspected")}</strong>` : EMPTY
      }`,
      markup`${enumLabel("EventOrigin", event.origin)}${event.offlineSyncStatus ? markup`<br />${enumLabel("OfflineSyncEventStatus", event.offlineSyncStatus)}` : EMPTY}`,
    ]),
  );
}

function limitCell(value: number | null, limit: number | null, key: "values.ofLimit" | "values.ofRequired"): SafeHtml {
  if (value === null) return markup`${EM_DASH}`;
  if (limit === null) return fmt.meters(value);
  return rdHtml(key, { value: fmt.meters(value), limit: fmt.meters(limit) });
}

function attemptCells(attempt: LedgerRejectedAttempt): CellValue[] {
  return [
    fmt.dateTime(attempt.serverReceivedAt),
    enumLabel("ClockEventType", attempt.eventType),
    markup`${attemptReason(attempt.code, {
      distanceMeters: attempt.distanceMeters,
      allowedRadiusMeters: attempt.allowedRadiusMeters,
      accuracyMeters: attempt.accuracyMeters,
      requiredMeters: attempt.requiredAccuracyMeters,
      deviationSeconds: attempt.deviationSeconds,
    })}${attempt.temporaryPointName ? markup`<br />${rdHtml("values.atTemporaryPoint", { name: userText(attempt.temporaryPointName) })}` : EMPTY}`,
    limitCell(attempt.distanceMeters, attempt.allowedRadiusMeters, "values.ofLimit"),
    limitCell(attempt.accuracyMeters, attempt.requiredAccuracyMeters, "values.ofRequired"),
    fmt.seconds(attempt.deviationSeconds),
    fmt.coordinates(attempt.latitude, attempt.longitude),
  ];
}

const ATTEMPT_COLUMNS = () => [
  rd("columns.serverTime"),
  rd("columns.event"),
  rd("columns.rejectionReason"),
  rd("columns.distanceAndLimit"),
  rd("columns.accuracyAndRequired"),
  rd("columns.deviation"),
  rd("columns.coordinates"),
];

function rejectedAttempts(attempts: readonly LedgerRejectedAttempt[]): SafeHtml {
  if (attempts.length === 0) return EMPTY;
  return markup`<h3>${rd("ledger.attemptsTitle")}</h3>
    ${dataTable(ATTEMPT_COLUMNS(), attempts.map(attemptCells))}`;
}

/** A correction's old or new value as text: a time, or minutes of unpaid break. */
function correctionValue(field: string, value: string | null): string {
  if (value === null || value === "") return rd("common.none");
  if (field === "unpaidBreakMinutes") return Number.isFinite(Number(value)) ? formatMinutes(Number(value)) : value;
  return formatDateTime(value);
}

function correctionField(field: string): string {
  return rd(`values.correctionField.${["clockInAt", "clockOutAt", "unpaidBreakMinutes"].includes(field) ? field : "other"}`);
}

function corrections(entry: LedgerEntry): SafeHtml {
  if (entry.corrections.length === 0) return EMPTY;
  return markup`<h3>${rd("ledger.correctionsTitle")}</h3>
    ${dataTable(
      [rd("columns.field"), rd("columns.change"), rd("columns.reason"), rd("columns.note"), rd("columns.by"), rd("columns.at"), commonText("forgottenStamp")],
      entry.corrections.map((correction) => [
        correctionField(correction.field),
        rd("values.change", { from: correctionValue(correction.field, correction.oldValue), to: correctionValue(correction.field, correction.newValue) }),
        enumLabel("CorrectionReason", correction.reason),
        userText(correction.note),
        userText(correction.editedByName),
        fmt.dateTime(correction.createdAt),
        correction.forgottenStamp ? rd("values.stampNumber", { number: correction.forgottenStamp.sequence }) : EM_DASH,
      ]),
    )}`;
}

function reversalCell(reversedAt: string | null, reason: string | null): SafeHtml {
  return reversedAt ? rdHtml("values.reversedAt", { time: fmt.dateTime(reversedAt), reason: userText(reason) }) : markup`${EM_DASH}`;
}

function stampsOperational(entry: LedgerEntry): SafeHtml {
  const stamps = entry.corrections.flatMap((correction) => (correction.forgottenStamp ? [correction.forgottenStamp] : []));
  if (stamps.length === 0) return EMPTY;
  return markup`<h3>${commonText("forgottenStamp")}</h3>
    ${dataTable(
      [rd("columns.sequence"), rd("columns.month"), rd("columns.reversal")],
      stamps.map((stamp) => [
        rd("values.stampNumber", { number: stamp.sequence }),
        formatMonth(stamp.businessMonth),
        reversalCell(stamp.reversedAt, stamp.reversalReason),
      ]),
    )}`;
}

function emergency(entry: LedgerEntry): SafeHtml {
  const callout = entry.emergency;
  if (!callout) return EMPTY;
  return markup`<h3>${commonText("emergencyCallout")}</h3>
    ${keyValueTable([
      [rd("columns.authorization"), fmt.label("EmergencyAuthorizationSource", callout.authorizationSource)],
      [rd("columns.authorizedBy"), userText(callout.authorizedByName)],
      [rd("emergency.actualStart"), fmt.dateTime(callout.actualStartClick)],
      [rd("emergency.actualEnd"), callout.actualEndClick ? fmt.dateTime(callout.actualEndClick) : rd("common.notEnded")],
      [rd("emergency.compensatedStart", { minutes: callout.retroactiveMinutes }), fmt.dateTime(callout.compensatedStart)],
      [rd("emergency.compensatedEnd", { minutes: callout.returnBufferMinutes ?? 0 }), callout.compensatedEnd ? fmt.dateTime(callout.compensatedEnd) : EM_DASH],
      [rd("emergency.actualWorked"), fmt.minutes(callout.actualWorkedMinutes)],
      [rd("emergency.retroactive"), fmt.shortMinutes(callout.retroactiveMinutes)],
      [rd("emergency.returnBuffer"), fmt.shortMinutes(callout.returnBufferMinutes)],
      [rd("emergency.totalCompensated"), fmt.minutes(callout.compensatedDurationMinutes)],
    ])}`;
}

function dailySummary(entry: LedgerEntry): SafeHtml {
  const summary = entry.dailySummary;
  if (!summary)
    return markup`<h3>${commonText("dailySummary")}</h3>
      <p class="note">${rd("ledger.noSummary")}</p>`;
  return markup`<h3>${commonText("dailySummary")}</h3>
    ${keyValueTable([
      [rd("columns.category"), fmt.label("TaskCategory", summary.taskCategory)],
      [rd("ledger.followUp"), fmt.yesNo(summary.followUpRequired)],
      [rd("ledger.summaryText"), markup`<span class="pre">${userText(summary.text)}</span>`],
      [rd("ledger.voiceNote"), fmt.yesNo(summary.hasVoiceNote)],
      [rd("ledger.materials"), userText(summary.materialsUsed)],
      [rd("ledger.problems"), userText(summary.problemsEncountered)],
    ])}`;
}

function approvals(entry: LedgerEntry): SafeHtml {
  if (entry.approvals.length === 0) return EMPTY;
  return markup`<h3>${rd("ledger.approvalsTitle")}</h3>
    ${dataTable(
      [rd("columns.action"), rd("columns.by"), rd("columns.at"), rd("columns.note")],
      entry.approvals.map((approval) => [
        enumLabel("ApprovalAction", approval.action),
        userText(approval.actedByName),
        fmt.dateTime(approval.createdAt),
        userText(approval.notes),
      ]),
    )}`;
}

/** One entry's evidence; `stamps` and `money` are the version-specific blocks. */
function entrySection(entry: LedgerEntry, stamps: SafeHtml, money: SafeHtml): SafeHtml {
  return markup`<section class="entry">
    ${entryTitle(entry)} ${entryFacts(entry)}
    <h3>${rd("ledger.clockEventsTitle")}</h3>
    ${clockEvents(entry)} ${rejectedAttempts(entry.rejectedAttempts)} ${corrections(entry)} ${stamps} ${emergency(entry)} ${dailySummary(entry)}
    ${approvals(entry)} ${money}
  </section>`;
}

function unlinkedAttempts(attempts: readonly LedgerUnlinkedAttempt[]): SafeHtml {
  if (attempts.length === 0) return EMPTY;
  return section(
    rd("ledger.unlinkedAttemptsTitle"),
    dataTable(
      [rd("columns.date"), rd("columns.shift"), rd("columns.site"), ...ATTEMPT_COLUMNS()],
      attempts.map((attempt) => [
        fmt.date(attempt.businessDate),
        shiftTitle(attempt.shiftTitle, attempt.shiftType),
        userText(siteText(attempt.siteName)),
        ...attemptCells(attempt),
      ]),
    ),
  );
}

function operationalTotals(totals: LedgerOperationalTotals): [string, CellValue][] {
  return [
    [rd("ledger.totals.entries"), fmt.number(totals.entries)],
    [rd("ledger.totals.approvedEntries"), fmt.number(totals.approvedEntries)],
    [rd("ledger.totals.worked"), fmt.minutes(totals.workedMinutes)],
    [rd("ledger.totals.approvedRegular"), fmt.minutes(totals.approvedRegularMinutes)],
    [rd("ledger.totals.approvedOvertime"), fmt.minutes(totals.approvedOvertimeMinutes)],
    [rd("ledger.totals.rejectedAttempts"), fmt.number(totals.rejectedAttempts)],
    [rd("ledger.totals.corrections"), fmt.number(totals.corrections)],
    [rd("ledger.totals.forgottenStamps"), fmt.number(totals.forgottenStamps)],
    [rd("ledger.totals.emergencies"), fmt.number(totals.emergencies)],
  ];
}

function entriesSection(entries: readonly SafeHtml[]): SafeHtml {
  return section(rd("ledger.entriesTitle"), entries.length > 0 ? entries : markup`<p class="empty">${rd("ledger.noEntries")}</p>`);
}

// ── Operational version (Field Manager) ────────────────────────────────────

export function ledgerOperationalBody(data: LedgerOperationalData, meta: ReportDocumentMeta): SafeHtml {
  return markup`${standardHeader(meta)} ${operationalNotice()} ${summaryBlock(rd("ledger.summaryTitle"), operationalTotals(data.totals))}
  ${entriesSection(data.entries.map((entry) => entrySection(entry, stampsOperational(entry), EMPTY)))} ${unlinkedAttempts(data.unlinkedAttempts)}`;
}

// ── Financial version (Owner, or the worker's own ledger) ──────────────────

function stampsFinancial(entry: LedgerFinancialEntry): SafeHtml {
  const stamps = entry.corrections.flatMap((correction) => (correction.forgottenStamp ? [correction.forgottenStamp] : []));
  if (stamps.length === 0) return EMPTY;
  return markup`<h3>${commonText("forgottenStamp")}</h3>
    ${dataTable(
      [rd("columns.sequence"), rd("columns.month"), rd("columns.reversal"), rd("columns.deduction"), rd("columns.reversalAmount")],
      stamps.map((stamp) => {
        const money = entry.forgottenStampMoney.find((row) => row.infractionId === stamp.infractionId);
        return [
          rd("values.stampNumber", { number: stamp.sequence }),
          formatMonth(stamp.businessMonth),
          reversalCell(stamp.reversedAt, stamp.reversalReason),
          money && money.deductionAgorot > 0 ? fmt.money(money.deductionAgorot) : rd("values.noDeduction"),
          money && money.reversalAgorot > 0 ? fmt.money(money.reversalAgorot) : EM_DASH,
        ];
      }),
    )}`;
}

function pay(entry: LedgerFinancialEntry): SafeHtml {
  const body =
    entry.pay === null
      ? markup`<p class="note">${rd(`values.payStatus.${entry.payStatus}`)}</p>`
      : keyValueTable([
          [rd("columns.compensationType"), fmt.label("CompensationType", entry.pay.compensationType)],
          [rd("ledger.standardDayCredited"), fmt.yesNo(entry.pay.standardDayCredited)],
          [rd("columns.regular"), fmt.minutes(entry.pay.regularMinutes)],
          [rd("columns.overtime"), fmt.minutes(entry.pay.overtimeMinutes)],
          [rd("columns.basePay"), fmt.money(entry.pay.baseAgorot)],
          [rd("columns.overtimePay"), fmt.money(entry.pay.overtimeAgorot)],
          [rd("columns.totalPay"), markup`<strong>${fmt.money(entry.pay.totalAgorot)}</strong>`],
        ]);
  return markup`<h3>${rd("ledger.payTitle")}</h3>
    ${body}`;
}

export function ledgerFinancialBody(data: LedgerFinancialData, meta: ReportDocumentMeta): SafeHtml {
  const totals = data.totals;
  return markup`${standardHeader(meta)}
    ${summaryBlock(rd("ledger.summaryTitle"), [
      [rd("ledger.totals.pay"), fmt.money(totals.payAgorot)],
      [rd("ledger.totals.stampDeductions"), fmt.money(-totals.forgottenStampDeductionsAgorot)],
      [rd("ledger.totals.stampReversals"), fmt.money(totals.reversalsAgorot)],
      [rd("ledger.totals.net"), markup`<strong>${fmt.money(totals.netAgorot)}</strong>`],
      ...operationalTotals(totals),
    ])}
    <p class="note">${rd("ledger.payNote")}</p>
    ${entriesSection(data.entries.map((entry) => entrySection(entry, stampsFinancial(entry), pay(entry))))} ${unlinkedAttempts(data.unlinkedAttempts)}`;
}

// ── CSV ────────────────────────────────────────────────────────────────────

function operationalCsvHeader(): string[] {
  return [
    rd("columns.date"),
    rd("columns.shift"),
    rd("columns.shiftType"),
    rd("columns.project"),
    rd("columns.site"),
    rd("columns.checkInMethod"),
    rd("columns.status"),
    rd("ledger.csv.clockInDevice"),
    rd("ledger.csv.clockInValidated"),
    rd("ledger.csv.clockOutDevice"),
    rd("ledger.csv.clockOutValidated"),
    rd("ledger.csv.clockInCoordinates"),
    unitHeader.meters(rd("ledger.csv.clockInAccuracy")),
    rd("ledger.csv.clockOutCoordinates"),
    unitHeader.meters(rd("ledger.csv.clockOutAccuracy")),
    rd("columns.locationResult"),
    unitHeader.meters(rd("columns.distance")),
    unitHeader.minutes(rd("columns.duration")),
    unitHeader.minutes(rd("columns.unpaidBreak")),
    unitHeader.minutes(rd("columns.regular")),
    unitHeader.minutes(rd("columns.overtime")),
    rd("ledger.minutesBasis"),
    commonText("creditAsFullDay"),
    rd("columns.flags"),
    rd("ledger.csv.rejectedAttempts"),
    rd("ledger.csv.corrections"),
    rd("ledger.csv.approvals"),
    rd("ledger.csv.forgottenStamps"),
    rd("columns.category"),
    commonText("dailySummary"),
    unitHeader.minutes(rd("emergency.actualWorked")),
    unitHeader.minutes(rd("emergency.retroactive")),
    unitHeader.minutes(rd("emergency.returnBuffer")),
    unitHeader.minutes(rd("emergency.totalCompensated")),
  ];
}

function operationalCsvCells(entry: LedgerEntry): CsvCell[] {
  const clockIn = entry.clockEvents.find((event) => event.eventType === ClockEventType.CLOCK_IN);
  const clockOut = entry.clockEvents.find((event) => event.eventType === ClockEventType.CLOCK_OUT);
  const separator = rd("values.listSeparator");
  return [
    csv.date(entry.businessDate),
    shiftTitleText(entry.shift.title, entry.shift.shiftType),
    csv.label("ShiftType", entry.shift.shiftType),
    projectText(entry.shift.projectName),
    siteText(entry.shift.siteName),
    csv.label("CheckInMethod", entry.checkInMethod),
    csv.label("TimeEntryStatus", entry.status),
    clockIn ? csv.dateTime(clockIn.deviceTimestamp) : null,
    csv.dateTime(entry.clockInAt),
    clockOut ? csv.dateTime(clockOut.deviceTimestamp) : null,
    csv.dateTime(entry.clockOutAt),
    clockIn ? csv.coordinates(clockIn.latitude, clockIn.longitude) : null,
    csv.round(clockIn?.accuracyMeters),
    clockOut ? csv.coordinates(clockOut.latitude, clockOut.longitude) : null,
    csv.round(clockOut?.accuracyMeters),
    clockIn ? csv.label("LocationValidationStatus", clockIn.locationValidationStatus) : null,
    csv.round(clockIn?.distanceFromSiteMeters),
    entry.minutes.raw,
    entry.minutes.unpaidBreak,
    entry.minutes.regular,
    entry.minutes.overtime,
    rd(`values.durationBasis.${entry.minutes.basis}`),
    csv.yesNo(entry.fullDayCredit.applied),
    entry.flags.map((flag) => enumLabel("AttendanceFlag", flag)).join(separator),
    entry.rejectedAttempts
      .map((attempt) =>
        attemptReason(attempt.code, {
          distanceMeters: attempt.distanceMeters,
          allowedRadiusMeters: attempt.allowedRadiusMeters,
          accuracyMeters: attempt.accuracyMeters,
          requiredMeters: attempt.requiredAccuracyMeters,
          deviationSeconds: attempt.deviationSeconds,
        }),
      )
      .join(separator),
    entry.corrections
      .map((correction) =>
        rd("values.correctionLine", {
          field: correctionField(correction.field),
          from: correctionValue(correction.field, correction.oldValue),
          to: correctionValue(correction.field, correction.newValue),
          reason: enumLabel("CorrectionReason", correction.reason),
        }),
      )
      .join(separator),
    entry.approvals
      .map((approval) =>
        rd("values.approvalLine", {
          action: enumLabel("ApprovalAction", approval.action),
          name: approval.actedByName ?? EM_DASH,
          time: formatDateTime(approval.createdAt),
        }),
      )
      .join(separator),
    entry.corrections
      .flatMap((correction) => (correction.forgottenStamp ? [rd("values.stampNumber", { number: correction.forgottenStamp.sequence })] : []))
      .join(separator),
    entry.dailySummary ? csv.label("TaskCategory", entry.dailySummary.taskCategory) : null,
    entry.dailySummary?.text ?? null,
    entry.emergency?.actualWorkedMinutes ?? null,
    entry.emergency?.retroactiveMinutes ?? null,
    entry.emergency?.returnBufferMinutes ?? null,
    entry.emergency?.compensatedDurationMinutes ?? null,
  ];
}

export function ledgerOperationalCsv(data: LedgerOperationalData): string {
  return buildCsv(operationalCsvHeader(), data.entries.map(operationalCsvCells));
}

export function ledgerFinancialCsv(data: LedgerFinancialData): string {
  const header = [
    ...operationalCsvHeader(),
    rd("columns.compensationType"),
    unitHeader.shekels(rd("columns.basePay")),
    unitHeader.shekels(rd("columns.overtimePay")),
    unitHeader.shekels(rd("columns.totalPay")),
    unitHeader.shekels(rd("columns.deduction")),
    unitHeader.shekels(rd("columns.reversalAmount")),
  ];
  const rows = data.entries.map((entry) => [
    ...operationalCsvCells(entry),
    entry.pay ? csv.label("CompensationType", entry.pay.compensationType) : rd(`values.payStatus.${entry.payStatus}`),
    csv.money(entry.pay?.baseAgorot),
    csv.money(entry.pay?.overtimeAgorot),
    csv.money(entry.pay?.totalAgorot),
    entry.forgottenStampMoney.length > 0 ? csv.money(entry.forgottenStampMoney.reduce((sum, stamp) => sum + stamp.deductionAgorot, 0)) : null,
    entry.forgottenStampMoney.length > 0 ? csv.money(entry.forgottenStampMoney.reduce((sum, stamp) => sum + stamp.reversalAgorot, 0)) : null,
  ]);
  const totals: CsvCell[] = [
    rd("common.totalRow"),
    ...new Array<CsvCell>(operationalCsvHeader().length - 1 + 3).fill(null),
    csv.money(data.totals.payAgorot),
    csv.money(data.totals.forgottenStampDeductionsAgorot),
    csv.money(data.totals.reversalsAgorot),
  ];
  return buildCsv(header, [...rows, totals]);
}
