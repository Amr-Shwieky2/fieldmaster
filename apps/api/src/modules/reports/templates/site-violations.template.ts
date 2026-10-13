import { EM_DASH } from "@fieldmaster/i18n/node";
import { ErrorCodes } from "../../../common/errors/app-exception";
import { attemptReason, commonText, enumLabel, rd } from "../render/messages";
import { dataTable, fmt, markup, rdHtml, section, userText, type CellValue, type SafeHtml } from "../render/html";
import { buildCsv, csv, unitHeader, type CsvCell } from "../render/csv";
import { operationalNotice, projectText, shiftTitle, shiftTitleText, siteText, standardHeader, summaryBlock } from "./common";
import type { ReportDocumentMeta } from "../report.types";
import type { SiteViolationsData, ViolationAttempt } from "../data/site-violations.data";

/** The site violations report (Owner and Field Manager alike; never any money). */

function reason(attempt: ViolationAttempt): string {
  return attemptReason(attempt.code, {
    distanceMeters: attempt.distanceMeters,
    allowedRadiusMeters: attempt.allowedRadiusMeters,
    accuracyMeters: attempt.accuracyMeters,
    requiredMeters: attempt.requiredAccuracyMeters,
    deviationSeconds: attempt.deviationSeconds,
  });
}

function limit(value: number | null, max: number | null, key: "values.ofLimit" | "values.ofRequired"): SafeHtml {
  if (value === null) return markup`${EM_DASH}`;
  if (max === null) return fmt.meters(value);
  return rdHtml(key, { value: fmt.meters(value), limit: fmt.meters(max) });
}

function place(row: { shiftTitle: string; shiftType: string; projectName: string | null; siteName: string | null }): SafeHtml {
  return markup`${shiftTitle(row.shiftTitle, row.shiftType)}<br /><span class="muted"
      >${userText(projectText(row.projectName))} / ${userText(siteText(row.siteName))}</span
    >`;
}

function attemptsTable(attempts: readonly ViolationAttempt[]): SafeHtml {
  return dataTable(
    [
      rd("columns.serverTime"),
      rd("columns.worker"),
      rd("columns.shiftAndPlace"),
      rd("columns.event"),
      rd("columns.rejectionReason"),
      rd("columns.distanceAndLimit"),
      rd("columns.accuracyAndRequired"),
      rd("columns.deviation"),
    ],
    attempts.map((attempt): CellValue[] => [
      fmt.dateTime(attempt.serverReceivedAt),
      userText(attempt.workerName),
      place(attempt),
      enumLabel("ClockEventType", attempt.eventType),
      markup`${reason(attempt)}${attempt.temporaryPointName ? markup`<br />${rdHtml("values.atTemporaryPoint", { name: userText(attempt.temporaryPointName) })}` : ""}`,
      limit(attempt.distanceMeters, attempt.allowedRadiusMeters, "values.ofLimit"),
      limit(attempt.accuracyMeters, attempt.requiredAccuracyMeters, "values.ofRequired"),
      fmt.seconds(attempt.deviationSeconds),
    ]),
    { empty: rd("violations.noAttempts") },
  );
}

export function siteViolationsBody(data: SiteViolationsData, meta: ReportDocumentMeta): SafeHtml {
  const { summary } = data;
  const suspicious = dataTable(
    [
      rd("columns.serverTime"),
      rd("columns.worker"),
      rd("columns.shiftAndPlace"),
      rd("columns.event"),
      rd("columns.locationResult"),
      rd("columns.coordinates"),
      rd("columns.origin"),
    ],
    [
      ...data.suspiciousEvents.map((event): CellValue[] => [
        fmt.dateTime(event.serverReceivedAt),
        userText(event.workerName),
        place(event),
        enumLabel("ClockEventType", event.eventType),
        markup`${enumLabel("LocationValidationStatus", event.locationValidationStatus)}${event.mockLocationSuspected ? markup`<br /><strong>${rd("values.mockSuspected")}</strong>` : ""}`,
        markup`${fmt.coordinates(event.latitude, event.longitude)}<br />${rdHtml("values.accuracy", { value: fmt.meters(event.accuracyMeters) })}`,
        enumLabel("EventOrigin", event.origin),
      ]),
      ...data.mockLocationAttempts.map((attempt): CellValue[] => [
        fmt.dateTime(attempt.serverReceivedAt),
        userText(attempt.workerName),
        place(attempt),
        enumLabel("ClockEventType", attempt.eventType),
        markup`<strong>${rd("violations.refusedMock")}</strong>`,
        markup`${fmt.coordinates(attempt.latitude, attempt.longitude)}<br />${rdHtml("values.accuracy", { value: fmt.meters(attempt.accuracyMeters) })}`,
        enumLabel("EventOrigin", attempt.origin),
      ]),
    ],
    { empty: rd("violations.noSuspicious") },
  );
  const flexi = dataTable(
    [
      rd("columns.date"),
      rd("columns.worker"),
      rd("columns.shiftAndPlace"),
      commonText("clockIn"),
      commonText("clockOut"),
      rd("columns.status"),
      rd("violations.enabledBy"),
      rd("columns.reason"),
      rd("columns.distance"),
    ],
    data.flexiCheckEntries.map((entry): CellValue[] => [
      fmt.date(entry.businessDate),
      userText(entry.workerName),
      place(entry),
      entry.clockInAt ? fmt.time(entry.clockInAt) : EM_DASH,
      entry.clockOutAt ? fmt.time(entry.clockOutAt) : rd("common.notEnded"),
      enumLabel("TimeEntryStatus", entry.status),
      userText(entry.enabledByName),
      userText(entry.reason),
      fmt.meters(entry.clockInDistanceMeters),
    ]),
    { empty: rd("violations.noFlexi") },
  );
  const points = dataTable(
    [
      rd("columns.serverTime"),
      rd("columns.worker"),
      rd("columns.shiftAndPlace"),
      rd("columns.event"),
      rd("violations.point"),
      rd("columns.distanceAndLimit"),
      rd("columns.accuracy"),
    ],
    data.temporaryPointUses.map((use): CellValue[] => [
      fmt.dateTime(use.serverReceivedAt),
      userText(use.workerName),
      place(use),
      enumLabel("ClockEventType", use.eventType),
      userText(use.pointName),
      limit(use.distanceMeters, use.pointRadiusMeters, "values.ofLimit"),
      fmt.meters(use.accuracyMeters),
    ]),
    { empty: rd("violations.noPoints") },
  );

  return markup`${standardHeader(meta)} ${operationalNotice()}
  ${summaryBlock(rd("common.summary"), [
    [rd("violations.summary.attempts"), fmt.number(summary.attempts)],
    ...summary.attemptsByCode.map(({ code, count }): [string, CellValue] => [
      rd("violations.summary.attemptsWithCode", { code: codeLabel(code) }),
      fmt.number(count),
    ]),
    [rd("violations.summary.suspicious"), fmt.number(summary.suspicious)],
    [rd("violations.summary.flexi"), fmt.number(summary.flexiCheckEntries)],
    [rd("violations.summary.points"), fmt.number(summary.temporaryPointUses)],
  ])}
  ${section(rd("violations.attemptsTitle"), attemptsTable(data.attempts))} ${section(rd("violations.suspiciousTitle"), suspicious)}
  ${section(rd("violations.flexiTitle"), flexi)} ${section(rd("violations.pointsTitle"), points)}`;
}

/** The refusal codes a clock attempt is stored with, each with a short Arabic name in `reportDocuments.violations.codes`. */
const ATTEMPT_CODES: string[] = [
  ErrorCodes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS,
  ErrorCodes.GPS_ACCURACY_TOO_LOW,
  ErrorCodes.DEVICE_TIME_DEVIATION_EXCEEDED,
  ErrorCodes.MOCK_LOCATION_BLOCKED,
];

/** The short name of a refusal code ("خارج نطاق الموقع"), or the code itself. */
function codeLabel(code: string): string {
  return ATTEMPT_CODES.includes(code) ? rd(`violations.codes.${code}`) : code;
}

export function siteViolationsCsv(data: SiteViolationsData): string {
  const rows: CsvCell[][] = [
    ...data.attempts.map((attempt) => [
      rd("violations.kind.attempt"),
      csv.dateTime(attempt.serverReceivedAt),
      csv.date(attempt.businessDate),
      attempt.workerName,
      shiftTitleText(attempt.shiftTitle, attempt.shiftType),
      projectText(attempt.projectName),
      siteText(attempt.siteName),
      csv.label("ClockEventType", attempt.eventType),
      reason(attempt),
      csv.round(attempt.distanceMeters),
      attempt.allowedRadiusMeters,
      csv.round(attempt.accuracyMeters),
      attempt.requiredAccuracyMeters,
      attempt.deviationSeconds,
      csv.coordinates(attempt.latitude, attempt.longitude),
      null,
    ]),
    ...data.suspiciousEvents.map((event) => [
      rd("violations.kind.suspicious"),
      csv.dateTime(event.serverReceivedAt),
      csv.date(event.businessDate),
      event.workerName,
      shiftTitleText(event.shiftTitle, event.shiftType),
      projectText(event.projectName),
      siteText(event.siteName),
      csv.label("ClockEventType", event.eventType),
      [enumLabel("LocationValidationStatus", event.locationValidationStatus), ...(event.mockLocationSuspected ? [rd("values.mockSuspected")] : [])].join(
        rd("values.listSeparator"),
      ),
      csv.round(event.distanceFromSiteMeters),
      null,
      csv.round(event.accuracyMeters),
      null,
      null,
      csv.coordinates(event.latitude, event.longitude),
      null,
    ]),
    ...data.flexiCheckEntries.map((entry) => [
      rd("violations.kind.flexi"),
      csv.dateTime(entry.clockInAt),
      csv.date(entry.businessDate),
      entry.workerName,
      shiftTitleText(entry.shiftTitle, entry.shiftType),
      projectText(entry.projectName),
      siteText(entry.siteName),
      null,
      [entry.enabledByName ? rd("violations.enabledByValue", { name: entry.enabledByName }) : null, entry.reason]
        .filter((part): part is string => !!part)
        .join(rd("values.listSeparator")),
      csv.round(entry.clockInDistanceMeters),
      null,
      null,
      null,
      null,
      null,
      null,
    ]),
    ...data.temporaryPointUses.map((use) => [
      rd("violations.kind.point"),
      csv.dateTime(use.serverReceivedAt),
      csv.date(use.businessDate),
      use.workerName,
      shiftTitleText(use.shiftTitle, use.shiftType),
      projectText(use.projectName),
      siteText(use.siteName),
      csv.label("ClockEventType", use.eventType),
      null,
      csv.round(use.distanceMeters),
      use.pointRadiusMeters,
      csv.round(use.accuracyMeters),
      null,
      null,
      null,
      use.pointName,
    ]),
  ];
  return buildCsv(
    [
      rd("violations.kind.title"),
      rd("columns.serverTime"),
      rd("columns.date"),
      rd("columns.worker"),
      rd("columns.shift"),
      rd("columns.project"),
      rd("columns.site"),
      rd("columns.event"),
      rd("columns.details"),
      unitHeader.meters(rd("columns.distance")),
      unitHeader.meters(rd("columns.allowedRadius")),
      unitHeader.meters(rd("columns.accuracy")),
      unitHeader.meters(rd("columns.requiredAccuracy")),
      unitHeader.seconds(rd("columns.deviation")),
      rd("columns.coordinates"),
      rd("violations.point"),
    ],
    rows,
  );
}
