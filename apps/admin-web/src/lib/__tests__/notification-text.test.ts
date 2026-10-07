import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { NotificationType } from "@fieldmaster/shared-types";
import { createFormatter } from "@/lib/format";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import { RENDERED_NOTIFICATION_TYPES, renderNotificationText, type NotificationTranslator } from "../notification-text";

const MESSAGES: Record<Locale, Record<string, unknown>> = { ar: ar.notifications, en: en.notifications };

function translator(locale: Locale): NotificationTranslator {
  return createTranslator({
    locale: INTL_LOCALE[locale],
    messages: { notifications: MESSAGES[locale] } as never,
    namespace: "notifications" as never,
    onError: (error) => {
      throw error;
    },
  }) as unknown as NotificationTranslator;
}

const ctx = {
  ar: { t: translator("ar"), fmt: createFormatter("ar") },
  en: { t: translator("en"), fmt: createFormatter("en") },
};

function render(locale: Locale, type: string, dataJson: Record<string, unknown> | null, stored = { title: "Stored English title", body: "Stored English body" }, storedTextFallback = false) {
  return renderNotificationText(ctx[locale].t, ctx[locale].fmt, { type: type as NotificationType, ...stored, dataJson }, { storedTextFallback });
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
  it("cover every NotificationType in Arabic and English with title, body and fallbackBody", () => {
    expect([...RENDERED_NOTIFICATION_TYPES].sort()).toEqual(Object.values(NotificationType).sort());
    for (const locale of ["ar", "en"] as const) {
      const types = MESSAGES[locale].types as Record<string, Record<string, string>>;
      for (const type of Object.values(NotificationType)) {
        expect(types[type]?.title, `${locale} ${type}.title`).toBeTruthy();
        expect(types[type]?.body, `${locale} ${type}.body`).toBeTruthy();
        expect(types[type]?.fallbackBody, `${locale} ${type}.fallbackBody`).toBeTruthy();
      }
    }
  });
});

describe("renderNotificationText", () => {
  describe("worker clocked out", () => {
    it("shows the Owner the estimated cost as ₪ 1,234.50 in Arabic, with Western digits", () => {
      const text = render("ar", "WORKER_CLOCKED_OUT", { ...CLOCK_OUT_DATA, estimatedCostAgorot: 123450 });
      expect(text.source).toBe("data");
      expect(text.title).toBe("أنهى عامل الدوام");
      expect(text.body).toContain("⁦₪ 1,234.50⁩");
      expect(visible(text.body)).toBe(
        "أنهى Eli Ramzani الدوام في وردية «Ayalon North».\nالمجموع: 10 س 30 د\nساعات عادية: 9 س 0 د\nساعات إضافية: 1 س 30 د\nالتكلفة التقديرية: ₪ 1,234.50\nالحضور بانتظار الموافقة.",
      );
      expect(text.body).not.toMatch(ARABIC_INDIC_DIGITS);
      expect(text.body).not.toContain("Stored English");
    });

    it("shows the Owner the estimated cost in English", () => {
      const text = render("en", "WORKER_CLOCKED_OUT", { ...CLOCK_OUT_DATA, estimatedCostAgorot: 123450 });
      expect(visible(text.body)).toBe("Eli Ramzani clocked out of “Ayalon North”.\nTotal: 10h 30m\nRegular: 9h 0m\nOvertime: 1h 30m\nEstimated cost: ₪ 1,234.50\nPending approval.");
    });

    it("shows a Field Manager (data without money) the durations and no cost line", () => {
      for (const locale of ["ar", "en"] as const) {
        const text = render(locale, "WORKER_CLOCKED_OUT", CLOCK_OUT_DATA);
        expect(text.source).toBe("data");
        expect(text.body).not.toContain("₪");
        expect(text.body).not.toMatch(/التكلفة|cost/i);
      }
      expect(visible(render("ar", "WORKER_CLOCKED_OUT", CLOCK_OUT_DATA).body)).toContain("ساعات إضافية: 1 س 30 د");
    });

    it("isolates user text so a Latin shift title cannot reorder the Arabic sentence", () => {
      const text = render("ar", "WORKER_CLOCKED_OUT", CLOCK_OUT_DATA);
      expect(text.body).toContain("⁨Eli Ramzani⁩");
      expect(text.body).toContain("«⁨Ayalon North⁩»");
    });
  });

  describe("emergency call-out ended", () => {
    const data = { timeEntryId: "te-2", calloutId: "c-1", workerProfileId: "wp-1", workerName: "Moshe Traffic", endedAt: "2026-10-05T01:00:00.000Z", compensatedDurationMinutes: 255 };

    it("adds the cost for an Owner only", () => {
      const owner = render("ar", "EMERGENCY_SHIFT_ENDED", { ...data, estimatedCostAgorot: 45000 });
      expect(visible(owner.body)).toBe("أنهى Moshe Traffic استدعاء الطوارئ.\nالمدة المحتسبة: 4 س 15 د\nالتكلفة التقديرية: ₪ 450.00\nالحضور بانتظار الموافقة.");
      const manager = render("ar", "EMERGENCY_SHIFT_ENDED", data);
      expect(visible(manager.body)).toBe("أنهى Moshe Traffic استدعاء الطوارئ.\nالمدة المحتسبة: 4 س 15 د\nالحضور بانتظار الموافقة.");
      expect(visible(render("en", "EMERGENCY_SHIFT_ENDED", data).body)).toBe("Moshe Traffic ended an emergency call-out.\nCompensated duration: 4h 15m\nPending approval.");
    });
  });

  describe("old notifications without data", () => {
    it("never shows the stored English text in Arabic: generic translated sentence instead", () => {
      for (const dataJson of [null, {}]) {
        const text = render("ar", "WORKER_CLOCKED_OUT", dataJson, { title: "Worker clocked out", body: "Worker clocked out of \"X\".\nEstimated cost: ₪400.00" });
        expect(text).toEqual({ title: "أنهى عامل الدوام", body: "أنهى أحد العمال الدوام، والحضور بانتظار الموافقة.", source: "fallback" });
      }
    });

    it("may show the stored English text in English", () => {
      const stored = { title: "New shift assignment", body: 'You\'ve been assigned to "Ayalon" starting 2026-10-06T04:00:00.000Z.' };
      expect(render("en", "TURAN_ASSIGNMENT_CREATED", {}, stored, true)).toEqual({ ...stored, source: "stored" });
      // Without the option English uses the generic sentence too.
      expect(render("en", "TURAN_ASSIGNMENT_CREATED", {}, stored)).toEqual({
        title: "New assignment",
        body: "You have a new assignment. Check your schedule for details.",
        source: "fallback",
      });
    });

    it("falls back when a value is malformed instead of printing it", () => {
      const text = render("ar", "WORKER_CLOCKED_OUT", { ...CLOCK_OUT_DATA, durationMinutes: "630" });
      expect(text.source).toBe("fallback");
    });

    it("uses a generic message for a type this version does not know", () => {
      expect(render("ar", "SOMETHING_NEW", { foo: 1 })).toEqual({ title: "إشعار جديد", body: "لديك إشعار جديد.", source: "fallback" });
      expect(render("en", "SOMETHING_NEW", null, { title: "Something new", body: "Details" }, true)).toEqual({ title: "Something new", body: "Details", source: "stored" });
    });
  });

  describe("other types", () => {
    it("clock-in shows the worker, shift and time in Asia/Jerusalem", () => {
      const data = { shiftTitle: "Ayalon North", workerName: "Eli Ramzani", clockInAt: "2026-10-05T04:02:00.000Z" };
      expect(visible(render("en", "WORKER_CLOCKED_IN", data).body)).toBe("Eli Ramzani clocked in for “Ayalon North”.\nTime: Oct 5, 2026, 07:02");
      const arabic = visible(render("ar", "WORKER_CLOCKED_IN", data).body);
      expect(arabic).toContain("بدأ Eli Ramzani الدوام في وردية «Ayalon North».");
      expect(arabic).toContain("07:02");
      expect(arabic).toContain("أكتوبر");
    });

    it("Turan assignment: the title names the Turan type with the glossary words", () => {
      const data = { assignmentKind: "TURAN", turanAssignmentId: "t-1", turanType: "NIGHT_TURAN", startAt: "2026-10-05T17:00:00.000Z", endAt: "2026-10-06T05:00:00.000Z" };
      const ar = render("ar", "TURAN_ASSIGNMENT_CREATED", data);
      expect(ar.title).toBe("تكليف مناوبة ليلية");
      expect(ar.body).toContain("لديك مناوبة ليلية.");
      expect(ar.body).toContain("20:00");
      const en = render("en", "TURAN_ASSIGNMENT_CREATED", data);
      expect(en.title).toBe("Night Turan assignment");
      expect(en.body).toBe("You’re scheduled for a Night Turan.\nFrom: Oct 5, 2026, 20:00\nTo: Oct 6, 2026, 08:00");
    });

    it("a shift assignment (same type, assignmentKind SHIFT) reads as a shift", () => {
      const data = { assignmentKind: "SHIFT", shiftId: "s-1", shiftTitle: "Ayalon North", startAt: "2026-10-06T03:00:00.000Z", endAt: "2026-10-06T12:00:00.000Z" };
      expect(render("ar", "TURAN_ASSIGNMENT_CREATED", data).title).toBe("وردية جديدة");
      expect(visible(render("en", "TURAN_ASSIGNMENT_CREATED", data).body)).toBe("You’ve been assigned to “Ayalon North”.\nStarts: Oct 6, 2026, 06:00");
    });

    it("a cancelled Turan says it was cancelled", () => {
      const data = { change: "CANCELLED", turanAssignmentId: "t-1", turanType: "DAY_TURAN", startAt: "2026-10-07T05:00:00.000Z", endAt: "2026-10-07T15:00:00.000Z" };
      const ar = render("ar", "TURAN_ASSIGNMENT_CHANGED", data);
      expect(ar.title).toBe("تم إلغاء المناوبة");
      expect(ar.body).toContain("(مناوبة نهارية)");
      expect(render("en", "TURAN_ASSIGNMENT_CHANGED", data).title).toBe("Turan assignment cancelled");
    });

    it("approval and rejection show the business date and the reason", () => {
      const approved = { shiftTitle: "Ayalon North", businessDate: "2026-10-04", approvedRegularMinutes: 540, approvedOvertimeMinutes: 60 };
      expect(visible(render("ar", "SHIFT_APPROVED", approved).body)).toBe("تمت الموافقة على حضورك في وردية «Ayalon North» بتاريخ 4 أكتوبر 2026.\nساعات عادية: 9 س 0 د\nساعات إضافية: 1 س 0 د");
      const rejected = { shiftTitle: "Ayalon North", businessDate: "2026-10-04", reason: "Accidental double clock-in" };
      expect(visible(render("en", "SHIFT_REJECTED", rejected).body)).toBe("Your attendance for “Ayalon North” on Oct 4, 2026 was rejected.\nReason: Accidental double clock-in");
    });

    it("payroll finalized names the month", () => {
      expect(render("ar", "PAYROLL_FINALIZED", { yearMonth: "2026-09" }).body).toBe("تم إقفال رواتب شهر سبتمبر 2026.");
      expect(render("en", "PAYROLL_FINALIZED", { yearMonth: "2026-09" }).body).toBe("Payroll for September 2026 has been finalized.");
    });

    it("offline review shows the counts and a generic name when the worker is unknown", () => {
      const text = render("ar", "OFFLINE_EVENT_REJECTED", { workerProfileId: "wp-1", workerName: null, flaggedCount: 1, rejectedCount: 2 });
      expect(text.body).toBe("سجلات حضور أحد العمال المسجّلة دون اتصال تحتاج إلى مراجعة.\nمُعلَّمة للمراجعة: 1\nمرفوضة: 2");
      expect(render("en", "SUSPICIOUS_LOCATION_DETECTED", { workerName: "Eli", flaggedCount: 3, rejectedCount: 0 }).title).toBe("Suspicious location needs review");
    });

    it("onboarding and worker approval", () => {
      expect(visible(render("ar", "ONBOARDING_SUBMITTED", { workerProfileId: "wp-9", workerName: "Ido Cone" }).body)).toBe("قدّم Ido Cone طلب انضمام، وهو بانتظار مراجعتك.");
      expect(render("ar", "WORKER_APPROVED", { workerProfileId: "wp-9" }).source).toBe("data");
    });
  });
});
