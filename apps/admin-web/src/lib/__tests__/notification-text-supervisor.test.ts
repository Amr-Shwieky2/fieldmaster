import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { NotificationType } from "@fieldmaster/shared-types";
import { createFormatter, INTL_LOCALE } from "@fieldmaster/i18n";
import ar from "@/i18n/messages";
import { RENDERED_NOTIFICATION_TYPES, renderNotificationText, type NotificationTranslator } from "../notification-text";

// Step 6: the temporary supervisor's issue report, and the 9-hour job's "open for more than 9 hours" notification.

const t = createTranslator({
  locale: INTL_LOCALE,
  messages: { notifications: ar.notifications } as never,
  namespace: "notifications" as never,
  onError: (error) => {
    throw error;
  },
}) as unknown as NotificationTranslator;

const fmt = createFormatter();

/** Renders a notification the way the page does; the API's stored English text is passed along to prove it is never shown. */
function render(type: string, dataJson: Record<string, unknown> | null, stored = { title: "Stored English title", body: "Stored English body" }) {
  return renderNotificationText(t, fmt, { type: type as NotificationType, ...stored, dataJson });
}

/** Removes bidi isolate marks so assertions can read the visible text. */
const visible = (value: string) => value.replace(/[⁦-⁩]/g, "");
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

/** What `TemporarySupervisorsService.reportIssue` stores for each recipient. */
const ISSUE_DATA = {
  assignmentId: "ta-1",
  shiftId: "s-1",
  shiftTitle: "تنظيم حركة المرور صباحًا",
  workerProfileId: "wp-1",
  workerName: "خالد ناصر",
  issueText: "إشارة المرور عند المدخل الشمالي معطّلة.",
};

/** What the 9-hour sweep (`LongOpenEntriesService.sweep`) stores: no money, the clock-in and how long the entry has been open. */
const LONG_OPEN_DATA = {
  timeEntryId: "te-1",
  shiftId: "s-1",
  shiftTitle: "تنظيم حركة المرور صباحًا",
  workerProfileId: "wp-1",
  workerName: "خالد ناصر",
  clockInAt: "2026-10-12T04:00:00.000Z",
  openMinutes: 545,
};

describe("temporary supervisor issue report notifications", () => {
  it("is a known type with an Arabic title, body and fallback", () => {
    expect(RENDERED_NOTIFICATION_TYPES).toContain(NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED);
    expect(ar.notifications.types.TEMPORARY_SUPERVISOR_ISSUE_REPORTED).toEqual({
      title: "بلاغ من مشرف مؤقت",
      body: "بلاغ من {workerName}، المشرف المؤقت لوردية «{shiftTitle}»: {issueText}",
      fallbackBody: "أرسل مشرف مؤقت بلاغًا عن إحدى الورديات.",
    });
  });

  it("shows the supervisor's name, the shift title and the issue as written", () => {
    const text = render("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", ISSUE_DATA);
    expect(text.source).toBe("data");
    expect(text.title).toBe("بلاغ من مشرف مؤقت");
    expect(visible(text.body)).toBe("بلاغ من خالد ناصر، المشرف المؤقت لوردية «تنظيم حركة المرور صباحًا»: إشارة المرور عند المدخل الشمالي معطّلة.");
    expect(text.title).not.toContain("Stored English");
    expect(text.body).not.toContain("Stored English");
    expect(text.body).not.toMatch(ARABIC_INDIC_DIGITS);
  });

  it("isolates the name, the shift title and the issue text so Latin text cannot reorder the Arabic sentence", () => {
    const text = render("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", {
      ...ISSUE_DATA,
      workerName: "Eli Ramzani",
      shiftTitle: "Ayalon North",
      issueText: "Pole #4 is down",
    });
    expect(text.body).toBe("بلاغ من ⁨Eli Ramzani⁩، المشرف المؤقت لوردية «⁨Ayalon North⁩»: ⁨Pole #4 is down⁩");
  });

  it("shows the issue without the spaces and line breaks around it", () => {
    const text = render("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", { ...ISSUE_DATA, issueText: "\n  نقص في الأقماع المرورية  \n" });
    expect(text.body).toContain("⁨نقص في الأقماع المرورية⁩");
    expect(visible(text.body)).toBe("بلاغ من خالد ناصر، المشرف المؤقت لوردية «تنظيم حركة المرور صباحًا»: نقص في الأقماع المرورية");
  });

  it("names a generic worker when the API could not resolve the supervisor's name", () => {
    const text = render("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", { ...ISSUE_DATA, workerName: null });
    expect(text.source).toBe("data");
    expect(visible(text.body)).toBe("بلاغ من أحد العمال، المشرف المؤقت لوردية «تنظيم حركة المرور صباحًا»: إشارة المرور عند المدخل الشمالي معطّلة.");
  });

  it("shows an emergency call-out's placeholder title as استدعاء طوارئ", () => {
    const text = render("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", { ...ISSUE_DATA, shiftTitle: "Emergency Call-out" });
    expect(visible(text.body)).toBe("بلاغ من خالد ناصر، المشرف المؤقت لوردية «استدعاء طوارئ»: إشارة المرور عند المدخل الشمالي معطّلة.");
    expect(text.body).not.toContain("Emergency Call-out");
  });

  it.each([
    ["without issueText", { ...ISSUE_DATA, issueText: undefined }],
    ["with an empty issueText", { ...ISSUE_DATA, issueText: "" }],
    ["with a blank issueText", { ...ISSUE_DATA, issueText: "   " }],
    ["with a non-text issueText", { ...ISSUE_DATA, issueText: 42 }],
    ["without the shift title", { ...ISSUE_DATA, shiftTitle: undefined }],
    ["without data", null],
  ])("falls back to the generic Arabic sentence %s, never the stored English text", (_case, dataJson) => {
    const stored = { title: "Issue reported by a temporary supervisor", body: 'Khaled reported an issue on "Ayalon": broken light' };
    expect(render("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", dataJson, stored)).toEqual({
      title: "بلاغ من مشرف مؤقت",
      body: "أرسل مشرف مؤقت بلاغًا عن إحدى الورديات.",
      source: "fallback",
    });
  });
});

describe("open for more than 9 hours (OVERTIME_THRESHOLD_CROSSED from the 9-hour job)", () => {
  it("renders from the data the job sends: the worker and the shift, without money", () => {
    const text = render("OVERTIME_THRESHOLD_CROSSED", LONG_OPEN_DATA, {
      title: "Shift open for more than 9 hours",
      body: 'Khaled has been clocked in to "Ayalon" for more than 9 hours.',
    });
    expect(text.source).toBe("data");
    expect(text.title).toBe("بدأت الساعات الإضافية");
    expect(visible(text.body)).toBe("تجاوز خالد ناصر الدوام العادي في وردية «تنظيم حركة المرور صباحًا»، وبدأت ساعاته الإضافية.");
    expect(text.body).toContain("⁨خالد ناصر⁩");
    expect(text.body).toContain("«⁨تنظيم حركة المرور صباحًا⁩»");
    expect(text.body).not.toContain("₪");
    expect(text.body).not.toMatch(ARABIC_INDIC_DIGITS);
    expect(text.title).not.toContain("9 hours");
    expect(text.body).not.toContain("clocked in");
  });

  it("names a generic worker when the job could not load the worker's name", () => {
    const text = render("OVERTIME_THRESHOLD_CROSSED", { ...LONG_OPEN_DATA, workerName: null });
    expect(text.source).toBe("data");
    expect(visible(text.body)).toBe("تجاوز أحد العمال الدوام العادي في وردية «تنظيم حركة المرور صباحًا»، وبدأت ساعاته الإضافية.");
  });

  it("shows a long-open emergency call-out with the Arabic shift title", () => {
    const text = render("OVERTIME_THRESHOLD_CROSSED", { ...LONG_OPEN_DATA, shiftTitle: "Emergency Call-out" });
    expect(visible(text.body)).toBe("تجاوز خالد ناصر الدوام العادي في وردية «استدعاء طوارئ»، وبدأت ساعاته الإضافية.");
  });

  it("falls back to the generic Arabic sentence without the shift title", () => {
    expect(render("OVERTIME_THRESHOLD_CROSSED", { ...LONG_OPEN_DATA, shiftTitle: undefined })).toEqual({
      title: "بدأت الساعات الإضافية",
      body: "تجاوز أحد العمال الدوام العادي، وبدأت ساعاته الإضافية.",
      source: "fallback",
    });
  });
});
