import { createTranslator } from "use-intl";
import { NotificationType } from "@fieldmaster/shared-types";
import { createFormatter, getEnumLabel, INTL_LOCALE, type EnumTranslator } from "@fieldmaster/i18n";
import ar from "../../i18n/messages";
import { RENDERED_NOTIFICATION_TYPES, renderNotificationAction, renderNotificationText, type NotificationTranslator } from "../notification-text";

const failOnMissing = (error: Error) => {
  throw error;
};
// The same translators the screens get from useTranslations (keys as plain strings).
const t = createTranslator({ locale: INTL_LOCALE, messages: ar, namespace: "notifications", onError: failOnMissing }) as unknown as NotificationTranslator;
const tEnums = createTranslator({ locale: INTL_LOCALE, messages: ar, namespace: "enums", onError: failOnMissing }) as unknown as EnumTranslator;
const enumLabel = (name: "TuranType", value: string) => getEnumLabel(tEnums, name, value);
const fmt = createFormatter();
const render = (type: string, dataJson: Record<string, unknown> | null) => renderNotificationText(t, fmt, enumLabel, { type: type as never, dataJson });

const FSI = "⁨";
const PDI = "⁩";
const iso = (value: string) => `${FSI}${value}${PDI}`;

describe("Arabic notification text (built from type + data, never the stored English)", () => {
  it("renders every notification type, with a fallback sentence for each", () => {
    expect([...RENDERED_NOTIFICATION_TYPES].sort()).toEqual(Object.values(NotificationType).sort());
    for (const type of Object.values(NotificationType)) {
      const fallback = render(type, {});
      expect(fallback.source).toBe(type === "WORKER_APPROVED" ? "data" : "fallback");
      expect(fallback.title).toMatch(/[ء-ي]/);
      expect(fallback.body).toMatch(/[ء-ي]/);
      expect(`${fallback.title}${fallback.body}`).not.toMatch(/[A-Za-z]{2,}|[٠-٩]/);
    }
  });

  it("tells the worker an attendance was approved, with the shift, date and minutes", () => {
    const text = render("SHIFT_APPROVED", {
      timeEntryId: "te-1",
      shiftTitle: "صيانة إشارات شارع يافا",
      businessDate: "2026-01-15",
      approvedRegularMinutes: 540,
      approvedOvertimeMinutes: 45,
    });
    expect(text).toEqual({
      title: "تمت الموافقة على حضورك",
      body: `وردية «${iso("صيانة إشارات شارع يافا")}» بتاريخ 15 يناير 2026.\nساعات عادية: 9 س 0 د\nساعات إضافية: 0 س 45 د`,
      source: "data",
    });
  });

  it("gives the manager's reason for a rejection, isolated (it is user text)", () => {
    const text = render("SHIFT_REJECTED", { shiftTitle: "Gate B", businessDate: "2026-07-15", reason: "Wrong site" });
    expect(text.body).toBe(`وردية «${iso("Gate B")}» بتاريخ 15 يوليو 2026.\nالسبب: ${iso("Wrong site")}`);
  });

  it("renders Turan and shift assignments with Jerusalem times and the Arabic Turan type", () => {
    const turan = render("TURAN_ASSIGNMENT_CREATED", { assignmentKind: "TURAN", turanType: "NIGHT_TURAN", startAt: "2026-01-15T18:00:00.000Z", endAt: "2026-01-16T04:00:00.000Z" });
    expect(turan.title).toBe("تكليف جديد: مناوبة ليلية");
    expect(turan.body).toBe("من 15 يناير 2026 في 20:00\nإلى 16 يناير 2026 في 06:00");

    const shift = render("TURAN_ASSIGNMENT_CREATED", { assignmentKind: "SHIFT", shiftId: "s1", shiftTitle: "تقاطع تل أبيب", startAt: "2026-07-15T05:00:00.000Z" });
    expect(shift.title).toBe("وردية جديدة");
    expect(shift.body).toBe(`تم تعيينك في وردية «${iso("تقاطع تل أبيب")}».\nالبداية: 15 يوليو 2026 في 08:00`);

    const cancelled = render("TURAN_ASSIGNMENT_CHANGED", { change: "CANCELLED", turanType: "DAY_TURAN", startAt: "2026-01-15T06:00:00.000Z", endAt: "2026-01-15T16:00:00.000Z" });
    expect(cancelled.title).toBe("إلغاء مناوبة");
  });

  it("names the month of finalized payroll", () => {
    expect(render("PAYROLL_FINALIZED", { yearMonth: "2026-09" }).body).toBe("اعتُمدت رواتب شهر سبتمبر 2026 نهائياً. يمكنك الاطلاع على راتبك في صفحة «راتبي».");
  });

  it("shows the emergency placeholder shift title as استدعاء طوارئ", () => {
    const text = render("TEMPORARY_CHECK_IN_POINT_OPENED", { shiftTitle: "Emergency Call-out" });
    expect(text.body).toBe("فُتحت نقطة تسجيل مؤقتة لوردية «استدعاء طوارئ».");
  });

  it("never shows money, even when an Owner's data carries it", () => {
    const text = render("WORKER_CLOCKED_OUT", { workerName: "خالد", shiftTitle: "صيانة", durationMinutes: 600, regularMinutes: 540, overtimeMinutes: 60, estimatedCostAgorot: 123450 });
    expect(text.body).not.toMatch(/₪|1,234/);
  });

  it("uses the type's fallback when a value is missing or malformed, and a generic text for an unknown type", () => {
    expect(render("SHIFT_APPROVED", { shiftTitle: "صيانة", businessDate: "15/01/2026", approvedRegularMinutes: 540, approvedOvertimeMinutes: 0 })).toEqual({
      title: "تمت الموافقة على حضورك",
      body: "تمت الموافقة على حضورك في إحدى الورديات.",
      source: "fallback",
    });
    expect(render("SOMETHING_NEW", { anything: 1 })).toEqual({ title: "إشعار جديد", body: "لديك إشعار جديد.", source: "fallback" });
    expect(render("SHIFT_REJECTED", null).source).toBe("fallback");
  });
});

describe("a worker's offline records (refused, flagged, or both): the text says what happened", () => {
  const offline = (type: string, rejectedCount: number, flaggedCount: number) =>
    render(type, { workerProfileId: "wp-1", workerName: "خالد حداد", rejectedCount, flaggedCount });

  it("refused only: they were refused, nothing is said to need review", () => {
    const text = offline("OFFLINE_EVENT_REJECTED", 1, 0);
    expect(text).toEqual({ title: "رُفضت سجلات حضور دون اتصال", body: `رُفضت 1 من سجلات حضور ${iso("خالد حداد")} المسجّلة دون اتصال.`, source: "data" });
    expect(text.body).not.toMatch(/مراجعة|: 0/);
  });

  it("flagged only: their location needs a review, nothing was refused", () => {
    const text = offline("SUSPICIOUS_LOCATION_DETECTED", 0, 3);
    expect(text).toEqual({ title: "موقع مشبوه يحتاج إلى مراجعة", body: `3 من سجلات حضور ${iso("خالد حداد")} دون اتصال تحتاج إلى مراجعة الموقع.`, source: "data" });
    expect(text.body).not.toMatch(/رُفض/);
  });

  it("both: how many were refused and how many others need a location review", () => {
    expect(offline("OFFLINE_EVENT_REJECTED", 2, 1).body).toBe(`رُفضت 2 من سجلات حضور ${iso("خالد حداد")} المسجّلة دون اتصال، و1 أخرى تحتاج إلى مراجعة الموقع.`);
  });

  it("no counts, or nothing refused or flagged: the type's general sentence", () => {
    expect(offline("OFFLINE_EVENT_REJECTED", 0, 0)).toEqual({ title: "رُفضت سجلات حضور دون اتصال", body: "رُفضت بعض سجلات الحضور المسجّلة دون اتصال.", source: "fallback" });
    expect(render("SUSPICIOUS_LOCATION_DETECTED", { workerName: "خالد" }).source).toBe("fallback");
    // Without a name: «أحد العمال».
    expect(render("OFFLINE_EVENT_REJECTED", { rejectedCount: 1, flaggedCount: 0 }).body).toBe("رُفضت 1 من سجلات حضور أحد العمال المسجّلة دون اتصال.");
  });
});

describe("a temporary supervisor's report resolved (to the supervisor)", () => {
  it("says who resolved it, for which shift, with their note", () => {
    const text = render("TEMPORARY_SUPERVISOR_ISSUE_RESOLVED", { issueId: "iss-1", assignmentId: "as-1", shiftId: "sh-1", shiftTitle: "حفريات شارع هرتسل", resolverName: "سارة لوي", note: "Delivered at 10:00" });
    expect(text).toEqual({
      title: "تم حل بلاغك",
      body: `تم حل بلاغك عن وردية «${iso("حفريات شارع هرتسل")}» بواسطة ${iso("سارة لوي")}.\nالملاحظة: ${iso("Delivered at 10:00")}`,
      source: "data",
    });
  });

  it("without the resolver's name: «أحد المديرين»; without the note: the general sentence", () => {
    expect(render("TEMPORARY_SUPERVISOR_ISSUE_RESOLVED", { shiftTitle: "حفريات", note: "تم" }).body).toBe(`تم حل بلاغك عن وردية «${iso("حفريات")}» بواسطة أحد المديرين.\nالملاحظة: ${iso("تم")}`);
    expect(render("TEMPORARY_SUPERVISOR_ISSUE_RESOLVED", { shiftTitle: "حفريات", resolverName: "سارة" })).toEqual({
      title: "تم حل بلاغك",
      body: "تم حل بلاغ أرسلته بصفتك مشرفًا مؤقتًا.",
      source: "fallback",
    });
  });
});

describe("what an actionable notification asks for (mobile manager mode)", () => {
  const action = (kind: string, dataJson: Record<string, unknown> | null = {}) => renderNotificationAction(t, fmt, { action: { kind } as never, dataJson });

  it("one clear Arabic sentence per action", () => {
    expect(action("REVIEW_ATTENDANCE")).toBe("اعتمد الحضور أو ارفضه");
    expect(action("REVIEW_OFFLINE")).toBe("راجع سجلات الحضور دون اتصال");
    expect(action("REVIEW_ONBOARDING")).toBe("راجع طلب الانضمام");
    expect(action("RESOLVE_SUPERVISOR_ISSUE")).toBe("حلّ بلاغ المشرف المؤقت");
  });

  it("an entry open for too long says for how long, when the data has it", () => {
    expect(action("OPEN_ENTRY", { timeEntryId: "te-1", openMinutes: 541 })).toBe("تواصل مع العامل: الدوام مفتوح منذ أكثر من 9 س 1 د");
    expect(action("OPEN_ENTRY", { timeEntryId: "te-1" })).toBe("تواصل مع العامل: الدوام مفتوح منذ مدة طويلة");
    expect(action("OPEN_ENTRY", null)).toBe("تواصل مع العامل: الدوام مفتوح منذ مدة طويلة");
  });

  it("nothing for information only, and a general sentence for a kind this version does not know", () => {
    expect(renderNotificationAction(t, fmt, { action: null, dataJson: {} })).toBeNull();
    expect(renderNotificationAction(t, fmt, { dataJson: {} })).toBeNull();
    expect(action("SOMETHING_NEW")).toBe("يحتاج هذا الإشعار إلى متابعة");
  });
});
