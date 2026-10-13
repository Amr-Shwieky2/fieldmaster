import { createTranslator } from "use-intl";
import { NotificationType } from "@fieldmaster/shared-types";
import { createFormatter, getEnumLabel, INTL_LOCALE, type EnumTranslator } from "@fieldmaster/i18n";
import ar from "../../i18n/messages";
import { RENDERED_NOTIFICATION_TYPES, renderNotificationText, type NotificationTranslator } from "../notification-text";

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
