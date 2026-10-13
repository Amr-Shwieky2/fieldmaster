import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { EntryCostEstimate, TimeEntryEvidence } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";
import { CALLOUT_FOR_MANAGER, EVIDENCE, apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import AttendanceDetailPage from "../page";

// Every time on the page is Asia/Jerusalem whatever the browser's zone. Run in another zone so that a
// local-time format could not pass by accident on a machine that is itself set to Jerusalem.
const machineTimeZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (machineTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = machineTimeZone;
});

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/attendance/te-1",
  useParams: () => ({ id: "te-1" }),
  useSearchParams: () => new URLSearchParams(),
}));

// Leaflet is covered by geofence-map-picker.test.tsx: here the map itself is a stub. The text legend
// under it is rendered by EvidenceMap outside the dynamic import, so it is real.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub() {
      return <div data-testid="evidence-map" />;
    },
}));

const client = vi.hoisted(() => ({
  getTimeEntryEvidence: vi.fn(),
  getTimeEntryEstimatedCost: vi.fn(),
  approveTimeEntry: vi.fn(),
  rejectTimeEntry: vi.fn(),
  applyFullDayCredit: vi.fn(),
  requestTimeEntryCorrection: vi.fn(),
  // The manual correction dialog opened from the page.
  createManualCorrection: vi.fn(),
  listForgottenStampInfractions: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "FIELD_MANAGER" as "OWNER" | "FIELD_MANAGER" }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

// ── Helpers ─────────────────────────────────────────────────────────────
function renderPage() {
  return renderWithIntl(<AttendanceDetailPage />, { queryClient: true });
}

/** Renders the page for `evidence` and waits until the worker's name is the page title. */
async function renderEvidence(evidence: TimeEntryEvidence = EVIDENCE) {
  client.getTimeEntryEvidence.mockResolvedValue(evidence);
  renderPage();
  await screen.findByRole("heading", { level: 1, name: evidence.worker.fullLegalName });
}

/** A card by its title (CardTitle -> CardHeader -> Card). */
function card(title: string): HTMLElement {
  const element = screen.getByRole("heading", { level: 2, name: title }).parentElement?.parentElement;
  if (!element) throw new Error(`no card titled ${title}`);
  return element;
}

/** The value next to a row label in a description list. */
function rowValue(container: HTMLElement, label: string): string | null | undefined {
  return within(container).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

/** A sub-section of the history card, by its heading. */
function historySection(title: string): HTMLElement {
  const section = within(card("السجل الكامل")).getByRole("heading", { level: 3, name: title }).closest("section");
  if (!section) throw new Error(`no history section ${title}`);
  return section;
}

const OWNER_COST: EntryCostEstimate = {
  timeEntryId: "te-1",
  basis: "ESTIMATED",
  compensationType: "DAILY",
  regularMinutes: 540,
  overtimeMinutes: 90,
  baseAgorot: 40_000,
  overtimeAgorot: 9_000,
  estimatedCostAgorot: 49_000,
};

/** The fixture entry as an emergency call-out, with the times of CALLOUT_FOR_MANAGER. */
const EMERGENCY_EVIDENCE: TimeEntryEvidence = {
  ...EVIDENCE,
  isEmergency: true,
  flags: ["EMERGENCY"],
  // The API creates call-out shifts with this fixed English placeholder title.
  shift: { ...EVIDENCE.shift, shiftType: "EMERGENCY_CALLOUT", title: "Emergency Call-out" },
  emergency: {
    id: CALLOUT_FOR_MANAGER.id,
    authorizationSource: CALLOUT_FOR_MANAGER.authorizationSource,
    authorizedByName: CALLOUT_FOR_MANAGER.authorizedByName,
    turanAssignmentId: CALLOUT_FOR_MANAGER.turanAssignment?.id ?? null,
    actualStartClick: CALLOUT_FOR_MANAGER.actualStartClick,
    compensatedStart: CALLOUT_FOR_MANAGER.compensatedStart,
    actualEndClick: CALLOUT_FOR_MANAGER.actualEndClick,
    compensatedEnd: CALLOUT_FOR_MANAGER.compensatedEnd,
    actualWorkedMinutes: CALLOUT_FOR_MANAGER.actualWorkedMinutes,
    retroactiveMinutes: CALLOUT_FOR_MANAGER.retroactiveMinutes,
    returnBufferMinutes: CALLOUT_FOR_MANAGER.returnBufferMinutes,
    compensatedDurationMinutes: CALLOUT_FOR_MANAGER.compensatedDurationMinutes,
    start: { latitude: CALLOUT_FOR_MANAGER.start.latitude, longitude: CALLOUT_FOR_MANAGER.start.longitude },
    end: CALLOUT_FOR_MANAGER.end ? { latitude: CALLOUT_FOR_MANAGER.end.latitude, longitude: CALLOUT_FOR_MANAGER.end.longitude } : null,
  },
};

/** A note the manager typed with the correction; its audit row repeats it. */
const CORRECTION_NOTE = "نسي العامل تسجيل الدخول عند البوابة";
const DEV_REWIND_NOTE = "Test-mode rewind by 630 min (APP_ENV=development); business date 2026-10-04 -> 2026-10-04";

type AuditEvent = TimeEntryEvidence["history"]["auditEvents"][number];
function auditEvent(fields: Pick<AuditEvent, "id" | "action" | "actorName" | "createdAt"> & Partial<AuditEvent>): AuditEvent {
  return { entityType: "TimeEntry", field: null, oldValue: null, newValue: null, reason: null, note: null, ...fields };
}

/** Audit rows whose reasons are codes, legacy English defaults or typed text, and whose notes must stay hidden. */
const AUDIT_EVIDENCE: TimeEntryEvidence = {
  ...EVIDENCE,
  history: {
    ...EVIDENCE.history,
    corrections: [{ ...EVIDENCE.history.corrections[0], note: CORRECTION_NOTE }],
    auditEvents: [
      auditEvent({
        id: "a-rewind",
        action: "DEV_REWIND",
        actorName: "يوسف الخطيب",
        field: "clockInAt",
        oldValue: "2026-10-04T14:30:00.000Z",
        newValue: "2026-10-04T04:00:00.000Z",
        note: DEV_REWIND_NOTE,
        createdAt: "2026-10-04T14:31:00.000Z",
      }),
      auditEvent({
        id: "a-correction",
        action: "MANUAL_TIME_CORRECTION",
        actorName: "يوسف الخطيب",
        field: "clockInAt",
        oldValue: "2026-10-04T05:00:00.000Z",
        newValue: "2026-10-04T04:00:00.000Z",
        reason: "FORGOTTEN_CLOCK_IN",
        note: CORRECTION_NOTE,
        createdAt: "2026-10-04T15:20:00.000Z",
      }),
      // Legacy English defaults the web app sent before it was Arabic only.
      auditEvent({
        id: "a-rejected",
        action: "TIME_ENTRY_REJECTED",
        actorName: "سلمى منصور",
        reason: "Rejected during review.",
        createdAt: "2026-10-05T06:00:00.000Z",
      }),
      auditEvent({
        id: "a-credit",
        action: "FULL_DAY_CREDIT_APPLIED",
        actorName: "سلمى منصور",
        reason: "Weather stopped work",
        createdAt: "2026-10-05T06:05:00.000Z",
      }),
      // API error codes: one with a wording without details (errors.<CODE>_NO_DETAILS), one with only errors.<CODE>.
      auditEvent({
        id: "a-geofence",
        action: "OFFLINE_EVENT_REJECTED",
        actorName: "خالد ناصر",
        reason: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
        createdAt: "2026-10-04T04:55:00.000Z",
      }),
      auditEvent({
        id: "a-signature",
        action: "OFFLINE_EVENT_REJECTED",
        actorName: "خالد ناصر",
        reason: "INVALID_OFFLINE_SIGNATURE",
        createdAt: "2026-10-04T15:10:00.000Z",
      }),
      // A reason a person typed is shown as written.
      auditEvent({
        id: "a-typed",
        action: "TIME_ENTRY_REJECTED",
        actorName: "سلمى منصور",
        reason: "الصور لا تطابق الموقع",
        createdAt: "2026-10-05T07:00:00.000Z",
      }),
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "FIELD_MANAGER";
  client.getTimeEntryEvidence.mockResolvedValue(EVIDENCE);
  client.getTimeEntryEstimatedCost.mockResolvedValue(OWNER_COST);
  client.approveTimeEntry.mockResolvedValue({});
  client.rejectTimeEntry.mockResolvedValue({});
  client.applyFullDayCredit.mockResolvedValue({});
  client.requestTimeEntryCorrection.mockResolvedValue({});
  client.createManualCorrection.mockResolvedValue({ timeEntry: { id: "te-1" }, correction: { id: "corr-2" } });
  client.listForgottenStampInfractions.mockResolvedValue([]);
});

describe("Attendance detail page", () => {
  it("shows the loading state, then the entry's header and record with Western digits only", async () => {
    let resolve: (value: TimeEntryEvidence) => void = () => {};
    client.getTimeEntryEvidence.mockReturnValue(new Promise<TimeEntryEvidence>((r) => (resolve = r)));
    renderPage();

    expect(screen.getByText("جارٍ التحميل…")).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى الحضور" }).getAttribute("href")).toBe("/attendance");
    expect(client.getTimeEntryEvidence).toHaveBeenCalledWith("te-1");

    resolve(EVIDENCE);
    const title = await screen.findByRole("heading", { level: 1, name: "خالد ناصر" });
    expect(screen.queryByText("جارٍ التحميل…")).toBeNull();
    expect(title.nextElementSibling?.textContent).toBe("حضور يوم 4 أكتوبر 2026");
    expect(screen.getByText("بانتظار الموافقة")).toBeTruthy();
    expect(screen.getByText("محاولة خارج نطاق الموقع")).toBeTruthy();
    expect(screen.queryByText("PENDING_APPROVAL")).toBeNull();
    expect(screen.queryByText("OUTSIDE_GEOFENCE_ATTEMPT")).toBeNull();

    const record = card("بيانات السجل");
    expect(within(record).getByRole("link", { name: "خالد ناصر" }).getAttribute("href")).toBe("/workers/wp-1");
    expect(within(record).getByText("+972500010001").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(rowValue(record, "الوردية")).toBe("تنظيم حركة المرور صباحًا");
    expect(within(record).getByRole("link", { name: "تنظيم حركة المرور صباحًا" }).getAttribute("href")).toBe("/shifts/s-1");
    expect(rowValue(record, "نوع الوردية")).toBe("وردية عادية");
    expect(rowValue(record, "المشروع")).toBe("مشروع أيالون");
    expect(rowValue(record, "الموقع")).toBe("تقاطع الشمال");
    expect(rowValue(record, "طريقة تسجيل الحضور")).toBe("نطاق الموقع");
    expect(rowValue(record, "يوم العمل")).toBe("4 أكتوبر 2026");
    expect(rowValue(record, "موعد الوردية")).toBe("من 4 أكتوبر 2026 في 07:00 إلى 4 أكتوبر 2026 في 16:00");

    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("shows the device, server and validated times of each stamp, the correction badge and the sync and location outcomes", async () => {
    await renderEvidence();

    const clockIn = screen.getByRole("region", { name: "بدء الدوام" });
    // The clock-in was corrected (history has a clockInAt correction); the clock-out was not.
    expect(within(clockIn).getByText("مُصحَّح")).toBeTruthy();
    expect(rowValue(clockIn, "وقت الجهاز")).toBe("4 أكتوبر 2026 في 08:00");
    expect(rowValue(clockIn, "وقت الخادم")).toBe("4 أكتوبر 2026 في 08:00");
    expect(rowValue(clockIn, "الوقت المعتمد")).toBe("4 أكتوبر 2026 في 07:00");
    expect(rowValue(clockIn, "فرق ساعة الجهاز")).toBe("30 ثانية");
    expect(rowValue(clockIn, "طريقة الإرسال")).toBe("عبر الإنترنت");
    expect(rowValue(clockIn, "نتيجة فحص الموقع")).toBe("سليم");
    expect(rowValue(clockIn, "دقة GPS")).toBe("10 م");
    expect(rowValue(clockIn, "المسافة من الموقع")).toBe("56 م");
    // Sent online: no sync row.
    expect(within(clockIn).queryByText("نتيجة المزامنة")).toBeNull();

    const clockOut = screen.getByRole("region", { name: "إنهاء الدوام" });
    expect(within(clockOut).queryByText("مُصحَّح")).toBeNull();
    expect(rowValue(clockOut, "وقت الجهاز")).toBe("4 أكتوبر 2026 في 17:30");
    expect(rowValue(clockOut, "وقت الخادم")).toBe("4 أكتوبر 2026 في 18:10");
    expect(rowValue(clockOut, "الوقت المعتمد")).toBe("4 أكتوبر 2026 في 17:30");
    expect(rowValue(clockOut, "فرق ساعة الجهاز")).toBe("2,400 ثانية");
    expect(rowValue(clockOut, "طريقة الإرسال")).toBe("دون اتصال");
    expect(rowValue(clockOut, "نتيجة المزامنة")).toContain("مُعلَّم للمراجعة · 4 أكتوبر 2026 في 18:10");
    expect(within(clockOut).getByText("أُرسل مرة أخرى وعدّه الخادم مكرّرًا")).toBeTruthy();
    expect(rowValue(clockOut, "نتيجة فحص الموقع")).toBe("مُعلَّم للمراجعة");
    expect(rowValue(clockOut, "المسافة من الموقع")).toBe("—");

    const text = document.body.textContent ?? "";
    for (const raw of ["ONLINE", "OFFLINE", "PASSED", "FLAGGED"]) expect(text).not.toContain(raw);
  });

  it("lists the geofence, the stamps and the refused attempt under the map, and the refused attempts in a table", async () => {
    await renderEvidence();

    expect(screen.getByTestId("evidence-map")).toBeTruthy();
    const legend = screen.getByRole("list", { name: "ما يظهر على الخريطة" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "نطاق الموقع: نصف القطر 150 م",
      "بدء الدوام: الدقة 10 م، المسافة 56 م، فحص الموقع: سليم",
      "إنهاء الدوام: الدقة 12 م، فحص الموقع: مُعلَّم للمراجعة",
      "محاولة بدء الدوام مرفوضة الساعة 07:55: خارج نطاق الموقع، المسافة 229 م",
    ]);

    const location = card("الخريطة وإثباتات الموقع");
    expect(within(location).getByRole("heading", { level: 3, name: "محاولة مرفوضة واحدة" })).toBeTruthy();
    const table = within(location).getByRole("table", { name: "المحاولات التي رفضها الخادم لهذا الحضور" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["الوقت", "الحدث", "سبب الرفض", "التفاصيل", "طريقة الإرسال"]);
    expect(
      within(table)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["4 أكتوبر 2026 في 07:55", "بدء الدوام", "خارج نطاق الموقع", "المسافة 229 م (المسموح 150 م)", "عبر الإنترنت"]);
    expect(screen.queryByText(/GEOFENCE_OUTSIDE_ALLOWED_RADIUS/)).toBeNull();
  });

  it("shows the minutes with the expected regular/overtime split and that full-day credit is not applied", async () => {
    await renderEvidence();

    const duration = card("المدة");
    expect(rowValue(duration, "المدة المسجّلة")).toBe("10 س 30 د");
    expect(rowValue(duration, "استراحة غير مدفوعة")).toBe("0 س 0 د");
    expect(rowValue(duration, "مدة العمل")).toBe("10 س 30 د");
    expect(rowValue(duration, "ساعات عادية")).toBe("9 س 0 د");
    expect(rowValue(duration, "ساعات إضافية")).toBe("1 س 30 د");
    expect(within(duration).getByText("تقسيم متوقع عند الاعتماد: أول 540 دقيقة عمل عادية، وما بعدها ساعات إضافية.")).toBeTruthy();
    expect(within(duration).getByText("احتساب يوم كامل")).toBeTruthy();
    expect(within(duration).getByText("غير مُطبَّق.")).toBeTruthy();
    // Not applied: no badge in the header.
    expect(screen.queryByText("تم احتساب يوم كامل")).toBeNull();
  });

  it("shows the full history: the correction with its infraction, no decisions yet, and the audit events in Arabic", async () => {
    await renderEvidence();

    const corrections = historySection("التصحيحات");
    const correction = within(corrections).getAllByRole("listitem");
    expect(correction).toHaveLength(1);
    const lines = Array.from(correction[0].querySelectorAll("p")).map((line) => line.textContent);
    expect(lines).toEqual([
      "بدء الدوام: من 4 أكتوبر 2026 في 08:00 إلى 4 أكتوبر 2026 في 07:00",
      "السبب: نسيان تسجيل بدء الدوام",
      "نسيان تسجيل رقم 3 في شهر أكتوبر 2026",
      "يوسف الخطيب، 4 أكتوبر 2026 في 18:20",
    ]);

    expect(within(historySection("القرارات")).getByText("لا توجد قرارات بعد.")).toBeTruthy();

    const audit = within(historySection("أحداث سجل التدقيق")).getAllByRole("listitem");
    expect(audit).toHaveLength(2);
    expect(audit[0].querySelector("p")?.textContent).toBe("بدء الدوام");
    expect(audit[0].textContent).toContain("خالد ناصر، 4 أكتوبر 2026 في 08:00");
    expect(Array.from(audit[1].querySelectorAll("p")).map((line) => line.textContent)).toEqual([
      "تصحيح يدوي للوقت",
      "بدء الدوام: من 4 أكتوبر 2026 في 08:00 إلى 4 أكتوبر 2026 في 07:00",
      "السبب: نسيان تسجيل بدء الدوام",
      "يوسف الخطيب، 4 أكتوبر 2026 في 18:20",
    ]);

    const text = document.body.textContent ?? "";
    for (const raw of ["MANUAL_TIME_CORRECTION", "FORGOTTEN_CLOCK_IN", "clockInAt", "2026-10"]) expect(text).not.toContain(raw);
  });

  it("never shows an audit event's note, and shows every audit reason in Arabic unless a person typed it", async () => {
    await renderEvidence(AUDIT_EVIDENCE);

    const audit = within(historySection("أحداث سجل التدقيق")).getAllByRole("listitem");
    expect(audit.map((item) => Array.from(item.querySelectorAll("p")).map((line) => line.textContent))).toEqual([
      // DEV_REWIND: the change only, without the system note.
      ["إرجاع وقت بدء الدوام (تعديل تجريبي)", "بدء الدوام: من 4 أكتوبر 2026 في 17:30 إلى 4 أكتوبر 2026 في 07:00", "يوسف الخطيب، 4 أكتوبر 2026 في 17:31"],
      // A CorrectionReason code: its label; the person's note stays with the correction itself.
      [
        "تصحيح يدوي للوقت",
        "بدء الدوام: من 4 أكتوبر 2026 في 08:00 إلى 4 أكتوبر 2026 في 07:00",
        "السبب: نسيان تسجيل بدء الدوام",
        "يوسف الخطيب، 4 أكتوبر 2026 في 18:20",
      ],
      ["رفض سجل حضور", "السبب: تم الرفض بعد المراجعة.", "سلمى منصور، 5 أكتوبر 2026 في 09:00"],
      ["احتساب يوم كامل", "السبب: توقّف العمل بسبب الطقس", "سلمى منصور، 5 أكتوبر 2026 في 09:05"],
      ["رفض تسجيل تمّ دون اتصال", "السبب: موقعك الحالي خارج نطاق الموقع المسموح به.", "خالد ناصر، 4 أكتوبر 2026 في 07:55"],
      ["رفض تسجيل تمّ دون اتصال", "السبب: تعذّر التحقق من التسجيل الذي تمّ دون اتصال.", "خالد ناصر، 4 أكتوبر 2026 في 18:10"],
      ["رفض سجل حضور", "السبب: الصور لا تطابق الموقع", "سلمى منصور، 5 أكتوبر 2026 في 10:00"],
    ]);
    expect(within(audit[6]).getByText("السبب: الصور لا تطابق الموقع").getAttribute("dir")).toBe("auto");

    // The typed note is shown once, with its correction.
    const notes = screen.getAllByText(CORRECTION_NOTE);
    expect(notes).toHaveLength(1);
    expect(historySection("التصحيحات").contains(notes[0])).toBe(true);
    expect(notes[0].getAttribute("dir")).toBe("auto");

    const text = document.body.textContent ?? "";
    for (const raw of [
      "Test-mode",
      "APP_ENV",
      "Rejected during review.",
      "Weather stopped work",
      "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
      "INVALID_OFFLINE_SIGNATURE",
      "DEV_REWIND",
      "{",
    ]) {
      expect(text).not.toContain(raw);
    }
  });

  it("shows the daily summary with the category label, the text in dir=auto, the materials and the follow-up", async () => {
    await renderEvidence();

    const summary = card("ملخص العمل اليومي");
    expect(rowValue(summary, "نوع العمل")).toBe("تنظيم حركة المرور");
    const text = within(summary).getByText("أغلقت المسرب ونظّمت حركة المرور.");
    expect(text.getAttribute("dir")).toBe("auto");
    expect(text.previousElementSibling?.textContent).toBe("الملخص");
    expect(rowValue(summary, "المواد المستخدمة")).toBe("أقماع مرورية");
    expect(rowValue(summary, "مشاكل واجهتها")).toBe("—");
    expect(rowValue(summary, "يحتاج إلى متابعة")).toBe("نعم");
    expect(screen.queryByText("TRAFFIC_CONTROL")).toBeNull();
  });

  it("never asks for or shows money on a Field Manager's page", async () => {
    auth.role = "FIELD_MANAGER";
    await renderEvidence();
    // Let every query the page starts settle before checking what it asked for.
    await waitFor(() => expect(screen.queryByText("جارٍ التحميل…")).toBeNull());

    expect(client.getTimeEntryEstimatedCost).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "التكلفة التقديرية" })).toBeNull();
    expect(screen.queryByText("للمالك فقط")).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows an Owner the entry's estimated cost from its own Owner-only request", async () => {
    auth.role = "OWNER";
    await renderEvidence();

    const cost = card("التكلفة التقديرية");
    expect(within(cost).getByText("للمالك فقط")).toBeTruthy();
    expect(await within(cost).findByText("₪ 490.00")).toBeTruthy();
    expect(client.getTimeEntryEstimatedCost).toHaveBeenCalledTimes(1);
    expect(client.getTimeEntryEstimatedCost).toHaveBeenCalledWith("te-1");
    expect(rowValue(cost, "الأجر الأساسي")).toBe("₪ 400.00");
    expect(rowValue(cost, "الساعات الإضافية")).toBe("₪ 90.00");
    expect(rowValue(cost, "الإجمالي")).toBe("₪ 490.00");
    expect(within(cost).getByText("₪ 400.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(within(cost).getByText("₪ 490.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(within(cost).getByText("تقدير قبل الاعتماد، حسب المدة المسجّلة.")).toBeTruthy();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("approves the entry and announces it in the status region", async () => {
    await renderEvidence();
    const actions = card("الإجراءات");
    // Exactly what allowedActions permits (full-day credit is not allowed for this 10 h 30 m entry).
    expect(
      within(actions)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["موافقة", "رفض", "طلب تصحيح", "تصحيح يدوي"]);
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(within(actions).getByRole("button", { name: "موافقة" }));

    await waitFor(() => expect(client.approveTimeEntry).toHaveBeenCalledWith("te-1"));
    expect(await screen.findByText("تمت الموافقة على وردية خالد ناصر.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("تمت الموافقة على وردية خالد ناصر.");
  });

  it("asks what to correct before requesting a correction, refuses a blank note and announces the request", async () => {
    await renderEvidence();
    const actions = card("الإجراءات");
    fireEvent.click(within(actions).getByRole("button", { name: "طلب تصحيح" }));

    const note = within(actions).getByLabelText("ما الذي يجب تصحيحه؟") as HTMLTextAreaElement;
    expect(note.value).toBe("يرجى مراجعة أوقات الدوام.");
    expect(within(actions).getByText("تُحفظ الملاحظة مع الطلب في القرارات وفي سجل التدقيق.")).toBeTruthy();

    fireEvent.change(note, { target: { value: "   " } });
    fireEvent.click(within(actions).getByRole("button", { name: "تأكيد طلب التصحيح" }));
    expect(within(actions).getByText("اكتب السبب قبل المتابعة.").getAttribute("role")).toBe("alert");
    expect(client.requestTimeEntryCorrection).not.toHaveBeenCalled();

    fireEvent.change(note, { target: { value: "وقت إنهاء الدوام غير صحيح" } });
    fireEvent.click(within(actions).getByRole("button", { name: "تأكيد طلب التصحيح" }));
    await waitFor(() => expect(client.requestTimeEntryCorrection).toHaveBeenCalledWith("te-1", "وقت إنهاء الدوام غير صحيح"));
    expect(await screen.findByText("تم طلب تصحيح لوردية خالد ناصر.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("تم طلب تصحيح لوردية خالد ناصر.");
    expect(within(actions).queryByLabelText("ما الذي يجب تصحيحه؟")).toBeNull();
  });

  it("explains a finalized payroll period and offers only what the API still allows", async () => {
    await renderEvidence({
      ...EVIDENCE,
      periodFinalized: true,
      allowedActions: { approve: false, reject: true, requestCorrection: false, fullDayCredit: false, correct: false },
    });

    const actions = card("الإجراءات");
    expect(within(actions).getByText("رواتب هذا الشهر معتمدة نهائياً، فلا يمكن الاعتماد أو التصحيح أو احتساب يوم كامل حتى يُعاد فتحها.")).toBeTruthy();
    expect(within(actions).getByRole("button", { name: "رفض" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "موافقة" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تصحيح يدوي" })).toBeNull();
    expect(screen.queryByRole("button", { name: "طلب تصحيح" })).toBeNull();
    expect(screen.queryByRole("button", { name: "احتساب يوم كامل" })).toBeNull();
  });

  it("gives focus back to «تصحيح يدوي» when the correction dialog is closed with Escape or «إغلاق»", async () => {
    await renderEvidence();
    const manual = within(card("الإجراءات")).getByRole("button", { name: "تصحيح يدوي" });

    // A click focuses the button in the browser; fireEvent does not, so focus it first.
    manual.focus();
    fireEvent.click(manual);
    const dialog = screen.getByRole("dialog", { name: "تصحيح يدوي" });
    expect(document.activeElement).toBe(within(dialog).getByRole("radio", { name: "تصحيح وقت بدء الدوام" }));
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(manual);

    manual.focus();
    fireEvent.click(manual);
    fireEvent.click(within(screen.getByRole("dialog", { name: "تصحيح يدوي" })).getByRole("button", { name: "إغلاق" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(manual);
    expect(client.createManualCorrection).not.toHaveBeenCalled();
  });

  it("closes the correction dialog after a save, announces it and gives focus back to «تصحيح يدوي»", async () => {
    await renderEvidence();
    const manual = within(card("الإجراءات")).getByRole("button", { name: "تصحيح يدوي" });
    manual.focus();
    fireEvent.click(manual);

    const dialog = screen.getByRole("dialog", { name: "تصحيح يدوي" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "تصحيح وقت إنهاء الدوام" }));
    fireEvent.change(within(dialog).getByLabelText("الوقت الجديد (توقيت القدس)"), { target: { value: "2026-10-04T18:00" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "السبب" }), { target: { value: "DEVICE_FAILURE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التصحيح" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(client.createManualCorrection.mock.calls[0][0]).toStrictEqual({
      timeEntryId: "te-1",
      field: "CLOCK_OUT",
      newValue: "2026-10-04T15:00:00.000Z",
      reason: "DEVICE_FAILURE",
    });
    // The entry's evidence is loaded again before the dialog closes.
    expect(client.getTimeEntryEvidence).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toBe("تم حفظ التصحيح لوردية خالد ناصر.");
    expect(document.activeElement).toBe(manual);
  });

  it("shows an emergency entry's four call-out times and links to the call-out", async () => {
    await renderEvidence(EMERGENCY_EVIDENCE);

    const emergency = card("استدعاء طوارئ");
    expect(within(emergency).getByText("تكليف بمناوبة ليلية")).toBeTruthy();
    expect(rowValue(emergency, "البداية الفعلية (الضغط على البدء)")).toBe("5 أكتوبر 2026 في 00:26");
    expect(rowValue(emergency, "البداية المحتسبة (قبل 60 دقيقة)")).toBe("4 أكتوبر 2026 في 23:26");
    expect(rowValue(emergency, "النهاية الفعلية (الضغط على الإنهاء)")).toBe("5 أكتوبر 2026 في 01:26");
    expect(rowValue(emergency, "النهاية المحتسبة (بعد 15 دقيقة)")).toBe("5 أكتوبر 2026 في 01:41");
    expect(rowValue(emergency, "مدة العمل الفعلية")).toBe("1 س 0 د");
    expect(rowValue(emergency, "إجمالي المدة المحتسبة")).toBe("2 س 15 د");
    expect(within(emergency).getByRole("link", { name: "عرض استدعاء الطوارئ" }).getAttribute("href")).toBe("/emergencies/co-1");
    // A Field Manager's emergency card never carries money either.
    expect(document.body.textContent).not.toContain("₪");
    expect(screen.queryByText("NIGHT_TURAN_ASSIGNMENT")).toBeNull();
  });

  it("names an emergency call-out shift by its Arabic type, never by the API's English placeholder title", async () => {
    await renderEvidence(EMERGENCY_EVIDENCE);

    const record = card("بيانات السجل");
    expect(rowValue(record, "الوردية")).toBe("استدعاء طوارئ");
    expect(within(record).getByRole("link", { name: "استدعاء طوارئ" }).getAttribute("href")).toBe("/shifts/s-1");
    expect(rowValue(record, "نوع الوردية")).toBe("استدعاء طوارئ");
    expect(document.body.textContent).not.toContain("Emergency Call-out");
  });

  it("shows a translated error with a working retry", async () => {
    client.getTimeEntryEvidence.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderPage();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("حدث خطأ ما");
    expect(screen.queryByText("Internal server error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 1, name: "خالد ناصر" })).toBeTruthy();
    expect(client.getTimeEntryEvidence).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows access denied when the API answers 403", async () => {
    client.getTimeEntryEvidence.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden resource"));
    renderPage();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText("Forbidden resource")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("shows the page's not-found state on 404, never the API's English message", async () => {
    client.getTimeEntryEvidence.mockRejectedValue(apiError(404, "NOT_FOUND", "Time entry not found"));
    renderPage();

    expect(await screen.findByText("غير موجود")).toBeTruthy();
    expect(screen.getByText("لم نعثر على سجل الحضور هذا. ربما أُزيل أو أنه لا يتبع مؤسستك.")).toBeTruthy();
    expect(screen.queryByText("Time entry not found")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "العودة إلى الحضور" }).getAttribute("href")).toBe("/attendance");
  });
});
