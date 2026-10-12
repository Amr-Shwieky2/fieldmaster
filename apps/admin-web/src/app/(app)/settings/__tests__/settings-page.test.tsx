import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { FieldManagerAudience, NotificationPreferenceView, OrganizationSettingsView } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import SettingsPage from "../page";

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings",
  useSearchParams: () => new URLSearchParams(),
}));

const client = vi.hoisted(() => ({
  getOrganizationSettings: vi.fn(),
  updateWorkdaySettings: vi.fn(),
  updateOnboardingSettings: vi.fn(),
  updateNotificationSettings: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "FIELD_MANAGER" }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

// ── Fixtures ────────────────────────────────────────────────────────────
function preference(
  type: NotificationPreferenceView["type"],
  fieldManagerAudience: FieldManagerAudience,
  owners: boolean,
  fieldManagers: boolean,
  defaults = { owners, fieldManagers },
): NotificationPreferenceView {
  return { type, fieldManagerAudience, owners, fieldManagers, defaults };
}

/** The manager-facing events in the API's order; one stored choice differs from its default. */
const NOTIFICATIONS: NotificationPreferenceView[] = [
  preference("WORKER_CLOCKED_IN", "SHIFT_MANAGER", true, true),
  preference("WORKER_CLOCKED_OUT", "SHIFT_MANAGER", true, true),
  // The page shows the stored choice, not the default.
  preference("OVERTIME_THRESHOLD_CROSSED", "SHIFT_MANAGER", true, false, { owners: true, fieldManagers: true }),
  preference("TEMPORARY_SUPERVISOR_ISSUE_REPORTED", "SHIFT_MANAGER", true, true),
  preference("EMERGENCY_SHIFT_STARTED", "ALL_FIELD_MANAGERS", true, true),
  preference("EMERGENCY_SHIFT_ENDED", "ALL_FIELD_MANAGERS", true, true),
  preference("ONBOARDING_SUBMITTED", "ALL_FIELD_MANAGERS", true, false),
  preference("OFFLINE_EVENT_REJECTED", "ALL_FIELD_MANAGERS", true, false),
  preference("SUSPICIOUS_LOCATION_DETECTED", "ALL_FIELD_MANAGERS", true, false),
];

/** An Owner's copy: editable, with the forgotten-stamp penalty amount (1,000 agorot). */
const OWNER_SETTINGS: OrganizationSettingsView = {
  canEdit: true,
  workday: {
    defaultGraceMinutes: 10,
    defaultGeofenceRadiusMeters: 100,
    defaultMinGpsAccuracyMeters: 50,
    deviceTimeDeviationSeconds: 120,
    temporaryPointRadiusMeters: 100,
    temporaryPointMinAccuracyMeters: 75,
    autoDeductUnpaidBreaks: false,
    timezone: "Asia/Jerusalem",
  },
  onboarding: { invitationTtlHours: 72 },
  notifications: NOTIFICATIONS,
  testMode: { appEnv: "development", devLoginEnabled: true },
  fixedRules: {
    standardDayMinutes: 540,
    freeForgottenStampsPerMonth: 2,
    emergencyRetroactiveMinutes: 60,
    emergencyReturnBufferMinutes: 15,
    forgottenStampPenaltyAgorot: 1000,
  },
  updatedAt: "2026-10-12T07:00:00.000Z",
};

/** A Field Manager's copy: read-only, and without any `forgottenStampPenaltyAgorot` key (money). */
const MANAGER_SETTINGS: OrganizationSettingsView = {
  ...OWNER_SETTINGS,
  canEdit: false,
  fixedRules: { standardDayMinutes: 540, freeForgottenStampsPerMonth: 2, emergencyRetroactiveMinutes: 60, emergencyReturnBufferMinutes: 15 },
};

/** The six workday numbers in page order: label, value, unit, and what describes the field (its hint). */
const WORKDAY_NUMBERS = [
  ["مهلة التأخير الافتراضية", "10", "دقيقة", ["للورديات الجديدة: بعدها يظهر العامل الذي لم يبدأ الدوام متأخرًا."]],
  ["نصف قطر نطاق الموقع الافتراضي", "100", "م", ["للمواقع الجديدة."]],
  ["دقة GPS المطلوبة افتراضيًا", "50", "م", ["لنطاقات المواقع الجديدة: يُرفض التسجيل إذا كانت الدقة أضعف من ذلك."]],
  ["أقصى فرق مسموح في ساعة الجهاز", "120", "ثانية", ["يُرفض التسجيل المباشر إذا اختلفت ساعة الهاتف عن ساعة الخادم بأكثر من ذلك."]],
  ["نصف قطر نقطة التسجيل المؤقتة الافتراضي", "100", "م", ["للنقاط المؤقتة الجديدة."]],
  ["دقة GPS المطلوبة عند نقطة مؤقتة", "75", "م", ["يُرفض التسجيل عند نقطة مؤقتة إذا كانت الدقة أضعف من ذلك."]],
];

/** Each notification row: the event, who among the Field Managers it reaches, and the Owners / Field Managers choices. */
const NOTIFICATION_ROWS = [
  ["بدأ عامل الدوام", "مديرو الميدان: مدير الوردية فقط.", true, true],
  ["أنهى عامل الدوام", "مديرو الميدان: مدير الوردية فقط.", true, true],
  ["بدأت الساعات الإضافية", "مديرو الميدان: مدير الوردية فقط.", true, false],
  ["بلاغ من مشرف مؤقت", "مديرو الميدان: مدير الوردية فقط.", true, true],
  ["بدأ استدعاء طوارئ", "مديرو الميدان: كل مديري الميدان.", true, true],
  ["انتهى استدعاء طوارئ", "مديرو الميدان: كل مديري الميدان.", true, true],
  ["تم تقديم طلب انضمام", "مديرو الميدان: كل مديري الميدان.", true, false],
  ["تم رفض حضور مسجّل دون اتصال", "مديرو الميدان: كل مديري الميدان.", true, false],
  ["تم رصد موقع مشبوه", "مديرو الميدان: كل مديري الميدان.", true, false],
];

const READ_ONLY_NOTICE = "يمكن للمالك فقط تعديل الإعدادات. تعرض هذه الصفحة القيم الحالية للاطلاع.";
const SAVED = "تم الحفظ.";
const SAVE_WORKDAY = "حفظ إعدادات يوم العمل";
const SAVE_ONBOARDING = "حفظ إعدادات الانضمام";
const SAVE_NOTIFICATIONS = "حفظ إعدادات الإشعارات";
const STANDARD_DAY_RULE = "يوم العمل العادي 9 ساعات (540 دقيقة)، وما بعده ساعات إضافية.";
const FREE_STAMPS_RULE = "أول مخالفتين لنسيان التسجيل في الشهر بلا خصم.";
const EMERGENCY_RULE = "استدعاء الطوارئ: يُحتسب البدء قبل 60 دقيقة من الضغط على البدء، والانتهاء بعد 15 دقيقة من الضغط على الإنهاء.";

// ── Helpers ─────────────────────────────────────────────────────────────
function renderPage() {
  return renderWithIntl(<SettingsPage />, { queryClient: true });
}

/** Renders the page for `settings` and waits for its first section. */
async function renderSettings(settings: OrganizationSettingsView) {
  client.getOrganizationSettings.mockResolvedValue(settings);
  const result = renderPage();
  await screen.findByRole("heading", { level: 2, name: "يوم العمل" });
  return result;
}

/** A section by its title (CardTitle -> CardHeader -> Card). */
function section(title: string): HTMLElement {
  const element = screen.getByRole("heading", { level: 2, name: title }).parentElement?.parentElement;
  if (!element) throw new Error(`no section titled ${title}`);
  return element;
}

function numberInput(label: string): HTMLInputElement {
  return screen.getByRole("spinbutton", { name: label }) as HTMLInputElement;
}

/** The texts of the elements that describe a field (aria-describedby), in order. */
function describedBy(field: HTMLElement): (string | null | undefined)[] {
  return (field.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
}

/** Each number field of a section: its label, value, unit and description. */
function numberFields(container: HTMLElement) {
  return (within(container).getAllByRole("spinbutton") as HTMLInputElement[]).map((field) => [
    field.labels?.[0]?.textContent,
    field.value,
    field.nextElementSibling?.textContent,
    describedBy(field),
  ]);
}

function notificationTable(): HTMLElement {
  return within(section("الإشعارات")).getByRole("table", { name: "من يصله كل إشعار: المالكون ومديرو الميدان" });
}

/** Each event row of the notifications table: event, audience line, and whether Owners / Field Managers get it. */
function notificationRows() {
  return within(notificationTable())
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const [event, audience] = Array.from(within(row).getByRole("rowheader").querySelectorAll("p"), (line) => line.textContent);
      const [owners, fieldManagers] = within(row).getAllByRole("checkbox") as HTMLInputElement[];
      return [event, audience, owners.checked, fieldManagers.checked];
    });
}

function fixedRules(): (string | null)[] {
  return within(section("قواعد ثابتة"))
    .getAllByRole("listitem")
    .map((rule) => rule.textContent);
}

/** The value next to a label of a description list. */
function rowValue(container: HTMLElement, label: string): string | null | undefined {
  return within(container).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

/** Matches the innermost element whose whole text (nested elements included) is exactly `text`. */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text);
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "OWNER";
  client.getOrganizationSettings.mockResolvedValue(OWNER_SETTINGS);
  client.updateWorkdaySettings.mockResolvedValue(OWNER_SETTINGS);
  client.updateOnboardingSettings.mockResolvedValue(OWNER_SETTINGS);
  client.updateNotificationSettings.mockResolvedValue(OWNER_SETTINGS);
});

describe("Settings page", () => {
  it("shows the loading state while the settings load", () => {
    client.getOrganizationSettings.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "الإعدادات" })).toBeTruthy();
    expect(
      screen.getByText("إعدادات المؤسسة التي يطبّقها النظام. يحفظ المالك كل قسم وحده، ويُسجَّل كل تغيير في سجل التدقيق بالقيمة القديمة والجديدة."),
    ).toBeTruthy();
    expect(screen.getByText("جارٍ التحميل…").closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    client.getOrganizationSettings.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderPage();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("حدث خطأ ما");
    expect(screen.queryByText("Internal server error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 2, name: "يوم العمل" })).toBeTruthy();
    expect(client.getOrganizationSettings).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows access denied when the API answers 403", async () => {
    client.getOrganizationSettings.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden resource"));
    renderPage();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText("Forbidden resource")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("states the test mode read-only: the environment, and whether dev login is on or off", async () => {
    const { unmount } = await renderSettings(OWNER_SETTINGS);

    let testMode = section("وضع الاختبار");
    expect(within(testMode).getByText("للاطلاع فقط: يُضبط في إعدادات الخادم ولا يمكن تغييره من هنا.")).toBeTruthy();
    expect(rowValue(testMode, "بيئة التشغيل")).toBe("development");
    expect(within(testMode).getByText("development").getAttribute("dir")).toBe("ltr");
    expect(rowValue(testMode, "الدخول التجريبي دون رمز تحقق")).toBe("مفعّل");
    // Nothing to change here, even for an Owner.
    expect(testMode.querySelectorAll("input, select, textarea, button")).toHaveLength(0);
    unmount();

    await renderSettings({ ...OWNER_SETTINGS, testMode: { appEnv: "production", devLoginEnabled: false } });
    testMode = section("وضع الاختبار");
    expect(rowValue(testMode, "بيئة التشغيل")).toBe("production");
    expect(rowValue(testMode, "الدخول التجريبي دون رمز تحقق")).toBe("معطّل");
  });
});

describe("Settings page: Owner", () => {
  it("shows the current values, all editable, a save button per section and the users link", async () => {
    await renderSettings(OWNER_SETTINGS);

    expect(screen.getByRole("link", { name: "المستخدمون والأجهزة" }).getAttribute("href")).toBe("/settings/users");
    expect(screen.queryByText(READ_ONLY_NOTICE)).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "يوم العمل",
      "الانضمام",
      "الإشعارات",
      "وضع الاختبار",
      "قواعد ثابتة",
    ]);

    const workday = section("يوم العمل");
    expect(numberFields(workday)).toEqual(WORKDAY_NUMBERS);
    expect(
      within(workday)
        .getAllByRole("spinbutton")
        .map((field) => field.getAttribute("dir")),
    ).toEqual(Array(6).fill("ltr"));
    expect((within(workday).getByRole("checkbox", { name: "خصم الاستراحات غير المدفوعة تلقائيًا" }) as HTMLInputElement).checked).toBe(false);
    expect(within(workday).getByText("يُحفظ هذا الإعداد كما هو، ولا تطبّقه أي قاعدة حساب حاليًا.")).toBeTruthy();
    // The time zone is shown, never editable.
    expect(within(workday).getByText(fullText("توقيت القدس (Asia/Jerusalem)"))).toBeTruthy();
    expect(within(workday).getByText("Asia/Jerusalem").getAttribute("dir")).toBe("ltr");

    expect(numberFields(section("الانضمام"))).toEqual([["مدة صلاحية الدعوة", "72", "ساعة", ["للدعوات الجديدة."]]]);

    expect(
      within(notificationTable())
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["الإشعار", "المالكون", "مديرو الميدان"]);
    expect(notificationRows()).toEqual(NOTIFICATION_ROWS);
    expect(within(section("الإشعارات")).getByText("لا تحمل إشعارات مديري الميدان أي مبالغ مالية في كل الأحوال.")).toBeTruthy();

    const inputs = Array.from(document.body.querySelectorAll("input"));
    expect(inputs).toHaveLength(26);
    expect(inputs.filter((input) => input.disabled)).toEqual([]);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([SAVE_WORKDAY, SAVE_ONBOARDING, SAVE_NOTIFICATIONS]);
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("saves the workday section on its own, with every number and the unpaid-breaks choice, then says «تم الحفظ.»", async () => {
    await renderSettings(OWNER_SETTINGS);
    let finishSave: (settings: OrganizationSettingsView) => void = () => {};
    client.updateWorkdaySettings.mockReturnValue(new Promise<OrganizationSettingsView>((resolve) => (finishSave = resolve)));
    const workday = section("يوم العمل");

    fireEvent.change(numberInput("مهلة التأخير الافتراضية"), { target: { value: "15" } });
    fireEvent.change(numberInput("نصف قطر نطاق الموقع الافتراضي"), { target: { value: "150" } });
    fireEvent.change(numberInput("أقصى فرق مسموح في ساعة الجهاز"), { target: { value: "90" } });
    fireEvent.click(within(workday).getByRole("checkbox", { name: "خصم الاستراحات غير المدفوعة تلقائيًا" }));
    // A change in another section is not part of this save.
    fireEvent.change(numberInput("مدة صلاحية الدعوة"), { target: { value: "48" } });
    fireEvent.click(within(workday).getByRole("button", { name: SAVE_WORKDAY }));

    // While saving, the button says so and cannot be pressed again.
    expect(((await within(workday).findByRole("button", { name: "جارٍ الحفظ…" })) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(client.updateWorkdaySettings).toHaveBeenCalledTimes(1));
    expect(client.updateWorkdaySettings.mock.calls).toStrictEqual([
      [
        {
          defaultGraceMinutes: 15,
          defaultGeofenceRadiusMeters: 150,
          defaultMinGpsAccuracyMeters: 50,
          deviceTimeDeviationSeconds: 90,
          temporaryPointRadiusMeters: 100,
          temporaryPointMinAccuracyMeters: 75,
          autoDeductUnpaidBreaks: true,
        },
      ],
    ]);
    expect(client.updateOnboardingSettings).not.toHaveBeenCalled();
    expect(client.updateNotificationSettings).not.toHaveBeenCalled();

    finishSave({
      ...OWNER_SETTINGS,
      workday: {
        ...OWNER_SETTINGS.workday,
        defaultGraceMinutes: 15,
        defaultGeofenceRadiusMeters: 150,
        deviceTimeDeviationSeconds: 90,
        autoDeductUnpaidBreaks: true,
      },
    });
    expect(await within(workday).findByText(SAVED)).toBeTruthy();
    expect((within(workday).getByRole("button", { name: SAVE_WORKDAY }) as HTMLButtonElement).disabled).toBe(false);
    // Only this section was saved: the onboarding change still waits for its own button.
    expect(screen.getAllByText(SAVED)).toHaveLength(1);
    expect(numberInput("مدة صلاحية الدعوة").value).toBe("48");
    expect(numberInput("مهلة التأخير الافتراضية").value).toBe("15");
  });

  it("saves the onboarding section on its own, and clears «تم الحفظ.» on the next edit", async () => {
    client.updateOnboardingSettings.mockResolvedValue({ ...OWNER_SETTINGS, onboarding: { invitationTtlHours: 48 } });
    await renderSettings(OWNER_SETTINGS);
    const onboarding = section("الانضمام");

    fireEvent.change(numberInput("مدة صلاحية الدعوة"), { target: { value: "48" } });
    fireEvent.click(within(onboarding).getByRole("button", { name: SAVE_ONBOARDING }));

    expect(await within(onboarding).findByText(SAVED)).toBeTruthy();
    expect(client.updateOnboardingSettings.mock.calls).toStrictEqual([[{ invitationTtlHours: 48 }]]);
    expect(client.updateWorkdaySettings).not.toHaveBeenCalled();
    expect(client.updateNotificationSettings).not.toHaveBeenCalled();
    expect(screen.getAllByText(SAVED)).toHaveLength(1);

    fireEvent.change(numberInput("مدة صلاحية الدعوة"), { target: { value: "24" } });
    await waitFor(() => expect(within(onboarding).queryByText(SAVED)).toBeNull());
  });

  it("saves the Owners and Field Managers choice of every event in the notifications section", async () => {
    // The API applies the choices it receives and returns the updated settings.
    client.updateNotificationSettings.mockImplementation(async (preferences: { type: string; owners: boolean; fieldManagers: boolean }[]) => ({
      ...OWNER_SETTINGS,
      notifications: OWNER_SETTINGS.notifications.map((item) => ({ ...item, ...preferences.find((sent) => sent.type === item.type) })),
    }));
    await renderSettings(OWNER_SETTINGS);
    const notifications = section("الإشعارات");

    fireEvent.click(within(notifications).getByRole("checkbox", { name: "إرسال «بدأ عامل الدوام» إلى مديري الميدان" }));
    fireEvent.click(within(notifications).getByRole("checkbox", { name: "إرسال «تم تقديم طلب انضمام» إلى مديري الميدان" }));
    fireEvent.click(within(notifications).getByRole("checkbox", { name: "إرسال «تم رصد موقع مشبوه» إلى المالكين" }));
    fireEvent.click(within(notifications).getByRole("button", { name: SAVE_NOTIFICATIONS }));

    expect(await within(notifications).findByText(SAVED)).toBeTruthy();
    expect(client.updateNotificationSettings.mock.calls).toStrictEqual([
      [
        [
          { type: "WORKER_CLOCKED_IN", owners: true, fieldManagers: false },
          { type: "WORKER_CLOCKED_OUT", owners: true, fieldManagers: true },
          { type: "OVERTIME_THRESHOLD_CROSSED", owners: true, fieldManagers: false },
          { type: "TEMPORARY_SUPERVISOR_ISSUE_REPORTED", owners: true, fieldManagers: true },
          { type: "EMERGENCY_SHIFT_STARTED", owners: true, fieldManagers: true },
          { type: "EMERGENCY_SHIFT_ENDED", owners: true, fieldManagers: true },
          { type: "ONBOARDING_SUBMITTED", owners: true, fieldManagers: true },
          { type: "OFFLINE_EVENT_REJECTED", owners: true, fieldManagers: false },
          { type: "SUSPICIOUS_LOCATION_DETECTED", owners: false, fieldManagers: false },
        ],
      ],
    ]);
    expect(client.updateWorkdaySettings).not.toHaveBeenCalled();
    expect(client.updateOnboardingSettings).not.toHaveBeenCalled();
    expect(notificationRows().map(([event, , owners, fieldManagers]) => [event, owners, fieldManagers])).toEqual([
      ["بدأ عامل الدوام", true, false],
      ["أنهى عامل الدوام", true, true],
      ["بدأت الساعات الإضافية", true, false],
      ["بلاغ من مشرف مؤقت", true, true],
      ["بدأ استدعاء طوارئ", true, true],
      ["انتهى استدعاء طوارئ", true, true],
      ["تم تقديم طلب انضمام", true, true],
      ["تم رفض حضور مسجّل دون اتصال", true, false],
      ["تم رصد موقع مشبوه", false, false],
    ]);
  });

  it("refuses values out of range before sending anything, with the allowed range under the field", async () => {
    await renderSettings(OWNER_SETTINGS);
    const workday = section("يوم العمل");
    const onboarding = section("الانضمام");
    const grace = numberInput("مهلة التأخير الافتراضية");
    const ttl = numberInput("مدة صلاحية الدعوة");

    fireEvent.change(grace, { target: { value: "121" } });
    fireEvent.change(numberInput("نصف قطر نطاق الموقع الافتراضي"), { target: { value: "9" } });
    fireEvent.change(numberInput("دقة GPS المطلوبة افتراضيًا"), { target: { value: "" } });
    fireEvent.change(numberInput("أقصى فرق مسموح في ساعة الجهاز"), { target: { value: "90.5" } });
    fireEvent.click(within(workday).getByRole("button", { name: SAVE_WORKDAY }));

    // A plain ICU argument is not grouped: the limits read as they are typed into the field.
    expect(
      within(workday)
        .getAllByRole("alert")
        .map((alert) => alert.textContent),
    ).toEqual(["أدخل عددًا صحيحًا من 0 إلى 120.", "أدخل عددًا صحيحًا من 10 إلى 5000.", "أدخل عددًا صحيحًا من 5 إلى 500.", "أدخل عددًا صحيحًا من 10 إلى 3600."]);
    // Each message belongs to its field, after the field's hint; valid fields are not marked.
    expect(grace.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(grace)).toEqual(["للورديات الجديدة: بعدها يظهر العامل الذي لم يبدأ الدوام متأخرًا.", "أدخل عددًا صحيحًا من 0 إلى 120."]);
    expect(numberInput("نصف قطر نقطة التسجيل المؤقتة الافتراضي").getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(ttl, { target: { value: "0" } });
    fireEvent.click(within(onboarding).getByRole("button", { name: SAVE_ONBOARDING }));
    expect(within(onboarding).getByRole("alert").textContent).toBe("أدخل عددًا صحيحًا من 1 إلى 720.");
    expect(ttl.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(ttl)).toEqual(["أدخل عددًا صحيحًا من 1 إلى 720."]);
    fireEvent.change(ttl, { target: { value: "721" } });
    fireEvent.click(within(onboarding).getByRole("button", { name: SAVE_ONBOARDING }));
    expect(within(onboarding).getByRole("alert").textContent).toBe("أدخل عددًا صحيحًا من 1 إلى 720.");

    // The limits themselves are allowed: the corrected values are the only ones ever sent.
    fireEvent.change(grace, { target: { value: "120" } });
    fireEvent.change(numberInput("نصف قطر نطاق الموقع الافتراضي"), { target: { value: "10" } });
    fireEvent.change(numberInput("دقة GPS المطلوبة افتراضيًا"), { target: { value: "500" } });
    fireEvent.change(numberInput("أقصى فرق مسموح في ساعة الجهاز"), { target: { value: "3600" } });
    expect(screen.queryAllByRole("alert").map((alert) => alert.textContent)).toEqual(["أدخل عددًا صحيحًا من 1 إلى 720."]);
    fireEvent.click(within(workday).getByRole("button", { name: SAVE_WORKDAY }));
    fireEvent.change(ttl, { target: { value: "720" } });
    fireEvent.click(within(onboarding).getByRole("button", { name: SAVE_ONBOARDING }));

    await waitFor(() => expect(screen.getAllByText(SAVED)).toHaveLength(2));
    expect(client.updateWorkdaySettings.mock.calls).toStrictEqual([
      [
        {
          defaultGraceMinutes: 120,
          defaultGeofenceRadiusMeters: 10,
          defaultMinGpsAccuracyMeters: 500,
          deviceTimeDeviationSeconds: 3600,
          temporaryPointRadiusMeters: 100,
          temporaryPointMinAccuracyMeters: 75,
          autoDeductUnpaidBreaks: false,
        },
      ],
    ]);
    expect(client.updateOnboardingSettings.mock.calls).toStrictEqual([[{ invitationTtlHours: 720 }]]);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("shows the API's error in Arabic inside the section that failed, while the other sections still save", async () => {
    client.updateWorkdaySettings.mockRejectedValue(apiError(400, "VALIDATION_FAILED", "defaultGraceMinutes must not be greater than 120"));
    client.updateOnboardingSettings.mockResolvedValue({ ...OWNER_SETTINGS, onboarding: { invitationTtlHours: 48 } });
    await renderSettings(OWNER_SETTINGS);
    const workday = section("يوم العمل");

    fireEvent.change(numberInput("مهلة التأخير الافتراضية"), { target: { value: "20" } });
    fireEvent.click(within(workday).getByRole("button", { name: SAVE_WORKDAY }));

    const alert = await within(workday).findByRole("alert");
    expect(alert.textContent).toBe("بعض البيانات المُدخلة غير صالحة. راجع الحقول وحاول مرة أخرى.");
    expect(screen.getAllByRole("alert")).toEqual([alert]);
    expect(document.body.textContent).not.toContain("must not be greater");
    expect(screen.queryByText(SAVED)).toBeNull();
    // What was typed stays, and the button is ready for another try.
    expect(numberInput("مهلة التأخير الافتراضية").value).toBe("20");
    expect((within(workday).getByRole("button", { name: SAVE_WORKDAY }) as HTMLButtonElement).disabled).toBe(false);

    const onboarding = section("الانضمام");
    fireEvent.change(numberInput("مدة صلاحية الدعوة"), { target: { value: "48" } });
    fireEvent.click(within(onboarding).getByRole("button", { name: SAVE_ONBOARDING }));
    expect(await within(onboarding).findByText(SAVED)).toBeTruthy();
    expect(within(workday).getByRole("alert").textContent).toBe("بعض البيانات المُدخلة غير صالحة. راجع الحقول وحاول مرة أخرى.");

    // The next edit of the workday section clears its error.
    fireEvent.change(numberInput("مهلة التأخير الافتراضية"), { target: { value: "25" } });
    await waitFor(() => expect(within(workday).queryByRole("alert")).toBeNull());
  });

  it("explains a refused save (403) inside the section instead of replacing the page", async () => {
    client.updateNotificationSettings.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden resource"));
    await renderSettings(OWNER_SETTINGS);
    const notifications = section("الإشعارات");

    fireEvent.click(within(notifications).getByRole("button", { name: SAVE_NOTIFICATIONS }));

    expect((await within(notifications).findByRole("alert")).textContent).toBe("ليست لديك صلاحية لتنفيذ هذا الإجراء.");
    expect(screen.queryByText("غير مصرّح بالوصول")).toBeNull();
    expect(screen.queryByText("Forbidden resource")).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(5);
  });

  it("states the fixed rules, with the forgotten-stamp penalty as ₪ 10.00, and none of them editable", async () => {
    await renderSettings(OWNER_SETTINGS);

    const rules = section("قواعد ثابتة");
    expect(within(rules).getByText("قواعد عمل ثابتة في النظام، لا يمكن تعديلها من الإعدادات.")).toBeTruthy();
    expect(fixedRules()).toEqual([STANDARD_DAY_RULE, FREE_STAMPS_RULE, "بعدها يُخصم ₪ 10.00 عن كل مخالفة.", EMERGENCY_RULE]);
    expect(within(rules).getByText("₪ 10.00").getAttribute("dir")).toBe("ltr");
    expect(rules.querySelectorAll("input, select, textarea, button")).toHaveLength(0);
  });
});

describe("Settings page: Field Manager", () => {
  beforeEach(() => {
    auth.role = "FIELD_MANAGER";
  });

  it("shows the same values read-only: the notice, every input disabled, no save button and no users link", async () => {
    await renderSettings(MANAGER_SETTINGS);

    expect(screen.getByText(READ_ONLY_NOTICE)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "المستخدمون والأجهزة" })).toBeNull();
    expect(numberFields(section("يوم العمل"))).toEqual(WORKDAY_NUMBERS);
    expect(numberFields(section("الانضمام"))).toEqual([["مدة صلاحية الدعوة", "72", "ساعة", ["للدعوات الجديدة."]]]);
    expect(notificationRows()).toEqual(NOTIFICATION_ROWS);

    const inputs = Array.from(document.body.querySelectorAll("input"));
    expect(inputs).toHaveLength(26);
    expect(inputs.filter((input) => !input.disabled)).toEqual([]);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("never shows a Field Manager money: the penalty rule is stated without an amount", async () => {
    await renderSettings(MANAGER_SETTINGS);

    expect(fixedRules()).toEqual([STANDARD_DAY_RULE, FREE_STAMPS_RULE, "بعدها يُطبَّق خصم ثابت عن كل مخالفة.", EMERGENCY_RULE]);
    expect(document.body.textContent).not.toContain("₪");
  });
});
