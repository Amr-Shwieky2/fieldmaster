import { vi } from "vitest";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  PayrollAdjustmentLine,
  PayrollCalculationRun,
  PayrollCostGroup,
  PayrollPeriodSummary,
  PayrollTotals,
  PayrollVersionDetail,
  PayrollVersionSummary,
  PayrollWorkerDetail,
  PayrollWorkerLine,
  Worker,
} from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { sessionStore } from "@/lib/session-store";
import { createIntlWrapper } from "@/test/render-with-intl";
import PayrollPeriodPage from "@/app/(app)/payroll/[yearMonth]/page";

/**
 * Step 7 payroll test helpers: `fetch` routed per "METHOD /path" (the real
 * api-client and AuthProvider run), the real Arabic messages, and API
 * fixtures for September 2026 (version 2 of the month). Instants are UTC; in
 * Asia/Jerusalem (IDT, UTC+3) 08:30Z reads 11:30.
 */

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function apiError(status: number, code: string, message = "English API message") {
  return json(status, { statusCode: status, code, message, details: {}, correlationId: "c-1" });
}

export type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;
export type FetchMock = ReturnType<typeof mockApi>;

/** Routes `fetch` by "METHOD /path" (path after /api/v1, without the query). Unknown routes answer 500. */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^.*\/api\/v1/, "");
    const handler = routes[`${init?.method ?? "GET"} ${path}`];
    return handler ? handler(init) : apiError(500, "INTERNAL_ERROR", `unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The requests made to one route, with their parsed JSON body and headers. */
export function requestsTo(fetchMock: FetchMock, method: string, path: string) {
  return fetchMock.mock.calls
    .filter(([url, init]) => (init?.method ?? "GET") === method && new URL(String(url)).pathname.endsWith(`/api/v1${path}`))
    .map(([, init]) => ({
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }));
}

export function seedSession(role: OrgRole) {
  sessionStore.save({ accessToken: "test-access", refreshToken: "test-refresh", organizationId: "org-1", role, workerProfileId: null });
}

export function renderPeriodPage(): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PayrollPeriodPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
}

/** Attributes a user reads (tooltip, placeholder) or hears from a screen reader (accessible name, alt text). */
const READABLE_ATTRIBUTES = ["aria-label", "aria-valuetext", "title", "placeholder", "alt"];

/** Distinct Latin-script words on the page, read per text node (so adjacent elements do not merge) and per readable attribute. */
export function latinWordsOnPage(): { text: string[]; attributes: string[] } {
  const collect = (values: Iterable<string | null>) => {
    const words = new Set<string>();
    for (const value of values) for (const word of value?.match(/[A-Za-z]+/g) ?? []) words.add(word);
    return [...words].sort();
  };
  const texts: (string | null)[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node.textContent);
  const attributes = [...document.body.querySelectorAll("*")].flatMap((el) => READABLE_ATTRIBUTES.map((name) => el.getAttribute(name)));
  return { text: collect(texts), attributes: collect(attributes) };
}

/** Collapses the whitespace of an element's text (cells hold several inline elements). */
export function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A UUID v4 (the Idempotency-Key of a "calculate" click). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ── Fixtures ──────────────────────────────────────────────────────────────

export const OWNER_NAME = "رنا عودة";

/** 21 approved shifts, 60 + 15 emergency minutes, a bonus and a forgotten-stamp penalty. */
export const ELI: PayrollWorkerLine = {
  workerProfileId: "wp-1",
  fullLegalName: "Eli Ramzani",
  approvedShifts: 21,
  standardDaysCredited: 21,
  regularMinutes: 10080,
  overtimeMinutes: 150,
  emergencyRetroactiveMinutes: 60,
  emergencyReturnMinutes: 15,
  grossBaseAgorot: 840000,
  overtimeAgorot: 12350,
  positiveAdjustmentsAgorot: 5000,
  forgottenStampPenaltiesAgorot: 2500,
  reversalsAgorot: 0,
  otherDeductionsAgorot: 0,
  netPayableAgorot: 854850,
  pendingEntries: 0,
  entriesWithoutCompensation: 0,
};

/** A penalty that was reversed, two entries waiting for approval and one approved entry without a compensation profile. */
export const SAMI: PayrollWorkerLine = {
  workerProfileId: "wp-2",
  fullLegalName: "سامي حداد",
  approvedShifts: 3,
  standardDaysCredited: 3,
  regularMinutes: 1440,
  overtimeMinutes: 0,
  emergencyRetroactiveMinutes: 0,
  emergencyReturnMinutes: 0,
  grossBaseAgorot: 123450,
  overtimeAgorot: 0,
  positiveAdjustmentsAgorot: 0,
  forgottenStampPenaltiesAgorot: 2500,
  reversalsAgorot: 2500,
  otherDeductionsAgorot: 0,
  netPayableAgorot: 123450,
  pendingEntries: 2,
  entriesWithoutCompensation: 1,
};

export const TOTALS: PayrollTotals = {
  workers: 2,
  approvedShifts: 24,
  standardDaysCredited: 24,
  regularMinutes: 11520,
  overtimeMinutes: 150,
  emergencyRetroactiveMinutes: 60,
  emergencyReturnMinutes: 15,
  grossBaseAgorot: 963450,
  overtimeAgorot: 12350,
  positiveAdjustmentsAgorot: 5000,
  forgottenStampPenaltiesAgorot: 5000,
  reversalsAgorot: 2500,
  otherDeductionsAgorot: 0,
  netPayableAgorot: 978300,
};

export const PROJECTS: PayrollCostGroup[] = [
  {
    id: "pr-1",
    name: "برج الميناء",
    approvedShifts: 23,
    workers: 2,
    regularMinutes: 11220,
    overtimeMinutes: 150,
    grossBaseAgorot: 938450,
    overtimeAgorot: 12350,
    totalAgorot: 950800,
  },
  {
    id: null,
    name: null,
    approvedShifts: 1,
    workers: 1,
    regularMinutes: 300,
    overtimeMinutes: 0,
    grossBaseAgorot: 25000,
    overtimeAgorot: 0,
    totalAgorot: 25000,
  },
];

export const SITES: PayrollCostGroup[] = [
  {
    id: "si-1",
    name: "الرصيف الشمالي",
    projectName: "برج الميناء",
    approvedShifts: 23,
    workers: 2,
    regularMinutes: 11220,
    overtimeMinutes: 150,
    grossBaseAgorot: 938450,
    overtimeAgorot: 12350,
    totalAgorot: 950800,
  },
  {
    id: null,
    name: null,
    projectName: null,
    approvedShifts: 1,
    workers: 1,
    regularMinutes: 300,
    overtimeMinutes: 0,
    grossBaseAgorot: 25000,
    overtimeAgorot: 0,
    totalAgorot: 25000,
  },
];

function adjustment(fields: Partial<PayrollAdjustmentLine> & Pick<PayrollAdjustmentLine, "id" | "type" | "source" | "amountAgorot">): PayrollAdjustmentLine {
  return {
    workerProfileId: "wp-1",
    fullLegalName: "Eli Ramzani",
    reason: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    createdByName: OWNER_NAME,
    relatedInfractionId: null,
    timeEntryId: null,
    reversalOfId: null,
    reversedById: null,
    ...fields,
  };
}

export const ELI_BONUS = adjustment({ id: "adj-bonus", type: "MANUAL_BONUS", source: "MANUAL", amountAgorot: 5000, reason: "مكافأة إنهاء الطابق" });
export const ELI_PENALTY = adjustment({
  id: "adj-pen-eli",
  type: "FORGOTTEN_STAMP_PENALTY",
  source: "SYSTEM",
  amountAgorot: -2500,
  createdAt: "2026-09-12T05:00:00.000Z",
  relatedInfractionId: "inf-2",
  timeEntryId: "te-7",
});
export const SAMI_PENALTY = adjustment({
  id: "adj-pen-sami",
  workerProfileId: "wp-2",
  fullLegalName: "سامي حداد",
  type: "FORGOTTEN_STAMP_PENALTY",
  source: "SYSTEM",
  amountAgorot: -2500,
  createdAt: "2026-09-10T06:00:00.000Z",
  relatedInfractionId: "inf-1",
  timeEntryId: "te-9",
  reversedById: "adj-rev-sami",
});
export const SAMI_REVERSAL = adjustment({
  id: "adj-rev-sami",
  workerProfileId: "wp-2",
  fullLegalName: "سامي حداد",
  type: "FORGOTTEN_STAMP_REVERSAL",
  source: "MANUAL",
  amountAgorot: 2500,
  reason: "عطل في الهاتف أثناء التسجيل",
  createdAt: "2026-09-11T07:00:00.000Z",
  relatedInfractionId: "inf-1",
  reversalOfId: "adj-pen-sami",
});
/** Added after the calculation on screen. */
export const NEW_DEDUCTION = adjustment({
  id: "adj-new",
  type: "MANUAL_DEDUCTION",
  source: "MANUAL",
  amountAgorot: -1000,
  reason: "سلفة على الراتب",
  createdAt: "2026-10-03T10:00:00.000Z",
});

export function run(overrides: Partial<PayrollCalculationRun> = {}): PayrollCalculationRun {
  return {
    id: "run-1",
    yearMonth: "2026-09",
    version: 2,
    state: "SUCCEEDED",
    progress: 100,
    processedWorkers: 2,
    totalWorkers: 2,
    requestedAt: "2026-10-02T08:29:00.000Z",
    requestedByName: OWNER_NAME,
    startedAt: "2026-10-02T08:29:05.000Z",
    finishedAt: "2026-10-02T08:30:00.000Z",
    errorCode: null,
    ...overrides,
  };
}

/** Version 2 of September 2026 (reopened from the finalized version 1), calculated and under review. */
export function detail(overrides: Partial<PayrollVersionDetail> = {}): PayrollVersionDetail {
  return {
    id: "pv-2",
    yearMonth: "2026-09",
    version: 2,
    status: "REVIEW",
    isCurrent: true,
    legacy: false,
    createdAt: "2026-10-01T07:00:00.000Z",
    createdByName: OWNER_NAME,
    reopenedAt: "2026-10-01T07:00:00.000Z",
    reopenedByName: OWNER_NAME,
    reopenReason: "تصحيح ساعات سامي",
    previousVersion: 1,
    calculatedAt: "2026-10-02T08:30:00.000Z",
    calculatedByName: OWNER_NAME,
    finalizedAt: null,
    finalizedByName: null,
    calculation: run(),
    changedSinceCalculation: false,
    allowedActions: { calculate: true, finalize: true, reopen: false, addAdjustment: true },
    totals: TOTALS,
    workers: [ELI, SAMI],
    projects: PROJECTS,
    sites: SITES,
    adjustments: [ELI_BONUS, ELI_PENALTY, SAMI_PENALTY, SAMI_REVERSAL],
    adjustmentsNotIncluded: [],
    warnings: { workersWithoutCompensation: [] },
    pending: { entries: 0, byWorker: [] },
    legacyNetByWorker: null,
    ...overrides,
  };
}

/** The same version once finalized: it may only be reopened. */
export function finalizedDetail(overrides: Partial<PayrollVersionDetail> = {}): PayrollVersionDetail {
  return detail({
    status: "FINALIZED",
    finalizedAt: "2026-10-03T12:00:00.000Z",
    finalizedByName: OWNER_NAME,
    allowedActions: { calculate: false, finalize: false, reopen: true, addAdjustment: false },
    ...overrides,
  });
}

/** The version a reopen of version 2 creates: the month's new working version, not calculated yet. */
export function reopenedDetail(overrides: Partial<PayrollVersionDetail> = {}): PayrollVersionDetail {
  return detail({
    id: "pv-3",
    version: 3,
    status: "OPEN",
    createdAt: "2026-10-13T09:00:00.000Z",
    reopenedAt: "2026-10-13T09:00:00.000Z",
    reopenReason: "تصحيح ساعات سامي",
    previousVersion: 2,
    calculatedAt: null,
    calculatedByName: null,
    calculation: null,
    allowedActions: { calculate: true, finalize: false, reopen: false, addAdjustment: true },
    totals: null,
    workers: [],
    projects: [],
    sites: [],
    adjustments: [],
    pending: null,
    ...overrides,
  });
}

export const VERSIONS: PayrollVersionSummary[] = [
  {
    id: "pv-1",
    version: 1,
    status: "FINALIZED",
    isCurrent: false,
    legacy: false,
    createdAt: "2026-09-30T15:00:00.000Z",
    createdByName: OWNER_NAME,
    reopenedAt: null,
    reopenedByName: null,
    reopenReason: null,
    calculatedAt: "2026-09-30T15:05:00.000Z",
    calculatedByName: OWNER_NAME,
    finalizedAt: "2026-09-30T16:00:00.000Z",
    finalizedByName: OWNER_NAME,
    workers: 2,
    netPayableAgorot: 950000,
  },
  {
    id: "pv-2",
    version: 2,
    status: "REVIEW",
    isCurrent: true,
    legacy: false,
    createdAt: "2026-10-01T07:00:00.000Z",
    createdByName: OWNER_NAME,
    reopenedAt: "2026-10-01T07:00:00.000Z",
    reopenedByName: OWNER_NAME,
    reopenReason: "تصحيح ساعات سامي",
    calculatedAt: "2026-10-02T08:30:00.000Z",
    calculatedByName: OWNER_NAME,
    finalizedAt: null,
    finalizedByName: null,
    workers: 2,
    netPayableAgorot: 978300,
  },
];

/** Eli's drill-down: a standard shift with overtime, an emergency call-out (-60 / +15) and a full-day credit without a compensation profile. */
export const ELI_DETAIL: PayrollWorkerDetail = {
  yearMonth: "2026-09",
  version: 2,
  worker: ELI,
  entries: [
    {
      timeEntryId: "te-1",
      businessDate: "2026-09-01",
      shift: { id: "sh-1", title: "صب الأسقف", shiftType: "STANDARD" },
      projectName: "برج الميناء",
      siteName: "الرصيف الشمالي",
      clockInAt: "2026-09-01T04:00:00.000Z",
      clockOutAt: "2026-09-01T14:30:00.000Z",
      approvedRegularMinutes: 480,
      approvedOvertimeMinutes: 150,
      fullDayCredit: false,
      isEmergency: false,
      emergencyRetroactiveMinutes: 0,
      emergencyReturnMinutes: 0,
      compensationType: "HOURLY",
      standardDayCredited: true,
      regularMinutes: 480,
      overtimeMinutes: 150,
      baseAgorot: 40000,
      overtimeAgorot: 12350,
      totalAgorot: 52350,
    },
    {
      timeEntryId: "te-2",
      businessDate: "2026-09-02",
      shift: { id: "sh-2", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" },
      projectName: null,
      siteName: null,
      clockInAt: "2026-09-02T19:00:00.000Z",
      clockOutAt: "2026-09-02T21:00:00.000Z",
      approvedRegularMinutes: 195,
      approvedOvertimeMinutes: 0,
      fullDayCredit: false,
      isEmergency: true,
      emergencyRetroactiveMinutes: 60,
      emergencyReturnMinutes: 15,
      compensationType: "HOURLY",
      standardDayCredited: false,
      regularMinutes: 195,
      overtimeMinutes: 0,
      baseAgorot: 16250,
      overtimeAgorot: 0,
      totalAgorot: 16250,
    },
    {
      timeEntryId: "te-3",
      businessDate: "2026-09-03",
      shift: { id: "sh-3", title: "تركيب النوافذ", shiftType: "STANDARD" },
      projectName: "برج الميناء",
      siteName: "الرصيف الشمالي",
      clockInAt: "2026-09-03T04:00:00.000Z",
      clockOutAt: "2026-09-03T08:00:00.000Z",
      approvedRegularMinutes: 540,
      approvedOvertimeMinutes: 0,
      fullDayCredit: true,
      isEmergency: false,
      emergencyRetroactiveMinutes: 0,
      emergencyReturnMinutes: 0,
      compensationType: null,
      standardDayCredited: false,
      regularMinutes: 540,
      overtimeMinutes: 0,
      baseAgorot: 0,
      overtimeAgorot: 0,
      totalAgorot: 0,
    },
  ],
  adjustments: [ELI_BONUS, ELI_PENALTY],
};

export const WORKERS: Worker[] = [
  {
    id: "wp-1",
    organizationId: "org-1",
    fullLegalName: "Eli Ramzani",
    preferredName: null,
    phoneNumber: "+972500000001",
    accountStatus: "ACTIVE",
    role: "WORKER",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "wp-3",
    organizationId: "org-1",
    fullLegalName: "ليلى خوري",
    preferredName: null,
    phoneNumber: "+972500000003",
    accountStatus: "ACTIVE",
    role: "WORKER",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "wp-4",
    organizationId: "org-1",
    fullLegalName: "عامل موقوف",
    preferredName: null,
    phoneNumber: "+972500000004",
    accountStatus: "SUSPENDED",
    role: "WORKER",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const PERIODS: PayrollPeriodSummary[] = [
  {
    id: "pv-2",
    yearMonth: "2026-09",
    version: 2,
    versionCount: 2,
    status: "REVIEW",
    workers: 2,
    netPayableAgorot: 978300,
    calculatedAt: "2026-10-02T08:30:00.000Z",
    finalizedAt: null,
  },
  {
    id: "pv-8",
    yearMonth: "2026-08",
    version: 1,
    versionCount: 1,
    status: "FINALIZED",
    workers: 3,
    netPayableAgorot: 1523075,
    calculatedAt: "2026-09-01T06:00:00.000Z",
    finalizedAt: "2026-09-02T07:15:00.000Z",
  },
  {
    id: "pv-10",
    yearMonth: "2026-10",
    version: 1,
    versionCount: 1,
    status: "OPEN",
    workers: null,
    netPayableAgorot: null,
    calculatedAt: null,
    finalizedAt: null,
  },
];
