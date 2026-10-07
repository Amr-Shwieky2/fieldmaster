import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { NotificationType } from "@fieldmaster/shared-types";
import { createFormatter } from "@/lib/format";
import { INTL_LOCALE } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";
import { RENDERED_NOTIFICATION_TYPES, renderNotificationText, type NotificationTranslator } from "../notification-text";

const MESSAGES: Record<string, unknown> = ar.notifications;

const t = createTranslator({
  locale: INTL_LOCALE,
  messages: { notifications: MESSAGES } as never,
  namespace: "notifications" as never,
  onError: (error) => {
    throw error;
  },
}) as unknown as NotificationTranslator;

const fmt = createFormatter();

/**
 * Renders a notification the way the page does. The API still stores an
 * English `title` / `body` on every notification; it is passed along so the
 * tests prove the renderer ignores it.
 */
function render(type: string, dataJson: Record<string, unknown> | null, stored = { title: "Stored English title", body: "Stored English body" }) {
  const notification = { type: type as NotificationType, ...stored, dataJson };
  return renderNotificationText(t, fmt, notification);
}

/** Removes bidi isolate marks so assertions can read the visible text. */
const visible = (value: string) => value.replace(/[⁦-⁩]/g, "");
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

const CLOCK_OUT_DATA = {
  timeEntryId: "te-1",
  shiftId: "s-1",
  shiftTitle: "Ayalon North",
  workerProfileId: "wp-1",
  workerName: "Eli Ramzani",
  clockOutAt: "2026-10-05T13:30:00.000Z",
  durationMinutes: 630,
  regularMinutes: 540,
  overtimeMinutes: 90,
};

describe("notification messages", () => {
  it("cover every NotificationType in Arabic with title, body and fallbackBody", () => {
    expect([...RENDERED_NOTIFICATION_TYPES].sort()).toEqual(Object.values(NotificationType).sort());
    const types = MESSAGES.types as Record<string, Record<string, string>>;
    for (const type of Object.values(NotificationType)) {
      expect(types[type]?.title, `${type}.title`).toBeTruthy();
      expect(types[type]?.body, `${type}.body`).toBeTruthy();
      expect(types[type]?.fallbackBody, `${type}.fallbackBody`).toBeTruthy();
    }
  });
});

describe("renderNotificationText", () => {
  describe("worker clocked out", () => {
    it("shows the Owner the estimated cost as ₪ 1,234.50 in Arabic, with Western digits", () => {
      const text = render("WORKER_CLOCKED_OUT", { ...CLOCK_OUT_DATA, estimatedCostAgorot: 123450 });
      expect(text.source).toBe("data");
      expect(text.title).toBe("أنهى عامل الدوام");
      expect(text.body).toContain("⁦₪ 1,234.50⁩");
      expect(visible(text.body)).toBe(
        "أنهى Eli Ramzani الدوام في وردية «Ayalon North».\nالمجموع: 10 س 30 د\nساعات عادية: 9 س 0 د\nساعات إضافية: 1 س 30 د\nالتكلفة التقديرية: ₪ 1,234.50\nالحضور بانتظار الموافقة.",
      );
      expect(text.body).not.toMatch(ARABIC_INDIC_DIGITS);
      expect(text.title).not.toContain("Stored English");
      expect(text.body).not.toContain("Stored English");
    });

    it("shows a Field Manager (data without money) the durations and no cost line", () => {
      const text = render("WORKER_CLOCKED_OUT", CLOCK_OUT_DATA);
      expect(text.source).toBe("data");
      expect(text.body).not.toContain("₪");
      expect(text.body).not.toMatch(/التكلفة/);
      expect(visible(text.body)).toBe(
        "أنهى Eli Ramzani الدوام في وردية «Ayalon North».\nالمجموع: 10 س 30 د\nساعات عادية: 9 س 0 د\nساعات إضافية: 1 س 30 د\nالحضور بانتظار الموافقة.",
      );
    });

    it("isolates user text so a Latin shift title cannot reorder the Arabic sentence", () => {
      const text = render("WORKER_CLOCKED_OUT", CLOCK_OUT_DATA);
      expect(text.body).toContain("⁨Eli Ramzani⁩");
      expect(text.body).toContain("«⁨Ayalon North⁩»");
    });
  });

  describe("emergency call-out ended", () => {
    const data = { timeEntryId: "te-2", calloutId: "c-1", workerProfileId: "wp-1", workerName: "Moshe Traffic", endedAt: "2026-10-05T01:00:00.000Z", compensatedDurationMinutes: 255 };

    it("adds the cost for an Owner only", () => {
      const owner = render("EMERGENCY_SHIFT_ENDED", { ...data, estimatedCostAgorot: 45000 });
      expect(visible(owner.body)).toBe("أنهى Moshe Traffic استدعاء الطوارئ.\nالمدة المحتسبة: 4 س 15 د\nالتكلفة التقديرية: ₪ 450.00\nالحضور بانتظار الموافقة.");
      const manager = render("EMERGENCY_SHIFT_ENDED", data);
      expect(visible(manager.body)).toBe("أنهى Moshe Traffic استدعاء الطوارئ.\nالمدة المحتسبة: 4 س 15 د\nالحضور بانتظار الموافقة.");
      expect(manager.body).not.toContain("₪");
    });
  });

  describe("old notifications without data", () => {
    it("never shows the stored English text: generic translated sentence instead", () => {
      for (const dataJson of [null, {}]) {
        const text = render("WORKER_CLOCKED_OUT", dataJson, { title: "Worker clocked out", body: "Worker clocked out of \"X\".\nEstimated cost: ₪400.00" });
        expect(text).toEqual({ title: "أنهى عامل الدوام", body: "أنهى أحد العمال الدوام، والحضور بانتظار الموافقة.", source: "fallback" });
      }
    });

    it("uses the type's generic Arabic sentence even when the stored English text is all there is", () => {
      const stored = { title: "New shift assignment", body: 'You\'ve been assigned to "Ayalon" starting 2026-10-06T04:00:00.000Z.' };
      expect(render("TURAN_ASSIGNMENT_CREATED", {}, stored)).toEqual({
        title: "تكليف جديد",
        body: "لديك تكليف جديد. راجع جدولك لمعرفة التفاصيل.",
        source: "fallback",
      });
    });

    it("falls back when a value is malformed instead of printing it", () => {
      const text = render("WORKER_CLOCKED_OUT", { ...CLOCK_OUT_DATA, durationMinutes: "630" });
      expect(text.source).toBe("fallback");
      expect(text).toEqual({ title: "أنهى عامل الدوام", body: "أنهى أحد العمال الدوام، والحضور بانتظار الموافقة.", source: "fallback" });
    });

    it("uses a generic message for a type this version does not know", () => {
      expect(render("SOMETHING_NEW", { foo: 1 })).toEqual({ title: "إشعار جديد", body: "لديك إشعار جديد.", source: "fallback" });
      // Never the stored English text, even for an unknown type.
      expect(render("SOMETHING_NEW", null, { title: "Something new", body: "Details" })).toEqual({ title: "إشعار جديد", body: "لديك إشعار جديد.", source: "fallback" });
    });
  });

  describe("other types", () => {
    it("clock-in shows the worker, shift and time in Asia/Jerusalem", () => {
      const data = { shiftTitle: "Ayalon North", workerName: "Eli Ramzani", clockInAt: "2026-10-05T04:02:00.000Z" };
      const text = render("WORKER_CLOCKED_IN", data);
      expect(text.title).toBe("بدأ عامل الدوام");
      // 04:02 UTC is 07:02 in Asia/Jerusalem (summer time).
      expect(visible(text.body)).toBe("بدأ Eli Ramzani الدوام في وردية «Ayalon North».\nالوقت: 5 أكتوبر 2026 في 07:02");
      expect(text.body).not.toMatch(ARABIC_INDIC_DIGITS);
    });

    it("Turan assignment: the title names the Turan type with the glossary words", () => {
      const data = { assignmentKind: "TURAN", turanAssignmentId: "t-1", turanType: "NIGHT_TURAN", startAt: "2026-10-05T17:00:00.000Z", endAt: "2026-10-06T05:00:00.000Z" };
      const text = render("TURAN_ASSIGNMENT_CREATED", data);
      expect(text.title).toBe("تكليف مناوبة ليلية");
      expect(text.body).toBe("لديك مناوبة ليلية.\nمن: 5 أكتوبر 2026 في 20:00\nإلى: 6 أكتوبر 2026 في 08:00");
    });

    it("a shift assignment (same type, assignmentKind SHIFT) reads as a shift", () => {
      const data = { assignmentKind: "SHIFT", shiftId: "s-1", shiftTitle: "Ayalon North", startAt: "2026-10-06T03:00:00.000Z", endAt: "2026-10-06T12:00:00.000Z" };
      const text = render("TURAN_ASSIGNMENT_CREATED", data);
      expect(text.title).toBe("وردية جديدة");
      expect(visible(text.body)).toBe("تم تعيينك في وردية «Ayalon North».\nالبداية: 6 أكتوبر 2026 في 06:00");
    });

    it("a cancelled Turan says it was cancelled", () => {
      const data = { change: "CANCELLED", turanAssignmentId: "t-1", turanType: "DAY_TURAN", startAt: "2026-10-07T05:00:00.000Z", endAt: "2026-10-07T15:00:00.000Z" };
      const text = render("TURAN_ASSIGNMENT_CHANGED", data);
      expect(text.title).toBe("تم إلغاء المناوبة");
      expect(text.body).toContain("(مناوبة نهارية)");
      expect(text.body).toBe("تم إلغاء إحدى مناوباتك (مناوبة نهارية).\nمن: 7 أكتوبر 2026 في 08:00\nإلى: 7 أكتوبر 2026 في 18:00");
    });

    it("approval and rejection show the business date and the reason", () => {
      const approved = { shiftTitle: "Ayalon North", businessDate: "2026-10-04", approvedRegularMinutes: 540, approvedOvertimeMinutes: 60 };
      expect(visible(render("SHIFT_APPROVED", approved).body)).toBe("تمت الموافقة على حضورك في وردية «Ayalon North» بتاريخ 4 أكتوبر 2026.\nساعات عادية: 9 س 0 د\nساعات إضافية: 1 س 0 د");
      const rejected = { shiftTitle: "Ayalon North", businessDate: "2026-10-04", reason: "Accidental double clock-in" };
      const text = render("SHIFT_REJECTED", rejected);
      expect(text.title).toBe("تم رفض الحضور");
      expect(visible(text.body)).toBe("تم رفض حضورك في وردية «Ayalon North» بتاريخ 4 أكتوبر 2026.\nالسبب: Accidental double clock-in");
      // The reason is user text: isolated so it cannot reorder the Arabic sentence.
      expect(text.body).toContain("⁨Accidental double clock-in⁩");
    });

    it("payroll finalized names the month", () => {
      expect(render("PAYROLL_FINALIZED", { yearMonth: "2026-09" }).body).toBe("تم إقفال رواتب شهر سبتمبر 2026.");
    });

    it("offline review shows the counts and a generic name when the worker is unknown", () => {
      const text = render("OFFLINE_EVENT_REJECTED", { workerProfileId: "wp-1", workerName: null, flaggedCount: 1, rejectedCount: 2 });
      expect(text.body).toBe("سجلات حضور أحد العمال المسجّلة دون اتصال تحتاج إلى مراجعة.\nمُعلَّمة للمراجعة: 1\nمرفوضة: 2");
      const suspicious = render("SUSPICIOUS_LOCATION_DETECTED", { workerName: "Eli", flaggedCount: 3, rejectedCount: 0 });
      expect(suspicious.title).toBe("موقع مشبوه يحتاج إلى مراجعة");
      expect(visible(suspicious.body)).toBe("سجلات حضور Eli المسجّلة دون اتصال تحتاج إلى مراجعة.\nمُعلَّمة للمراجعة: 3\nمرفوضة: 0");
    });

    it("onboarding and worker approval", () => {
      expect(visible(render("ONBOARDING_SUBMITTED", { workerProfileId: "wp-9", workerName: "Ido Cone" }).body)).toBe("قدّم Ido Cone طلب انضمام، وهو بانتظار مراجعتك.");
      expect(render("WORKER_APPROVED", { workerProfileId: "wp-9" }).source).toBe("data");
    });
  });

describe("emergency call-out shift titles", () => {
  it("shows the API's English placeholder title as استدعاء طوارئ, and keeps a typed title", () => {
    const placeholder = render("WORKER_CLOCKED_IN", { shiftTitle: "Emergency Call-out", workerName: "Eli", clockInAt: "2026-01-15T08:30:00.000Z" });
    expect(visible(placeholder.body)).toContain("«استدعاء طوارئ»");
    expect(placeholder.body).not.toContain("Emergency Call-out");
    const typed = render("WORKER_CLOCKED_IN", { shiftTitle: "Night signals", workerName: "Eli", clockInAt: "2026-01-15T08:30:00.000Z" });
    expect(visible(typed.body)).toContain("«Night signals»");
  });
});

});
