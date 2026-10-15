import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { WorkRuleVersionView, WorkRulesImpact, WorkRulesView } from "@fieldmaster/api-client";
import { DEFAULT_WORK_RULES, Permission, SystemRoleKey, WORK_RULE_LIMITS, type WorkRules } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import { ACCOUNTANT, authWithAccess, builtInAccess, myAccess } from "@/test/access-fixtures";
import WorkRulesPage from "../page";

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  getWorkRules: vi.fn(),
  getWorkRulesImpact: vi.fn(),
  createWorkRuleVersion: vi.fn(),
}));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/settings/work-rules",
  useSearchParams: () => new URLSearchParams(),
}));

// ── Test data (today is 14 October 2026 in Jerusalem, as the API says) ──
const TODAY = "2026-10-14";

function version(fields: Pick<WorkRuleVersionView, "id" | "version" | "effectiveFrom" | "rules" | "reason" | "createdAt">): WorkRuleVersionView {
  return { createdByUserId: "u-owner", ...fields };
}

/** The original values, kept as version 1 by the first change. */
const V1 = version({ id: "v-1", version: 1, effectiveFrom: "2000-01-01", rules: { ...DEFAULT_WORK_RULES }, reason: "القيم الأصلية", createdAt: "2026-08-20T09:00:00.000Z" });
/** In force today: an 8½-hour day since 1 September. */
const V2 = version({
  id: "v-2",
  version: 2,
  effectiveFrom: "2026-09-01",
  rules: { ...DEFAULT_WORK_RULES, standardDayMinutes: 510, overtimeThresholdMinutes: 510 },
  reason: "اتفاق عمل جديد",
  createdAt: "2026-08-20T09:00:00.000Z",
});
/** Not started yet: from 1 November, three free infractions and a ₪ 15.00 penalty. */
const V3 = version({
  id: "v-3",
  version: 3,
  effectiveFrom: "2026-11-01",
  rules: { ...V2.rules, freeForgottenStampsPerMonth: 3, forgottenStampPenaltyAgorot: 1500 },
  reason: "تشديد نسيان التسجيل",
  createdAt: "2026-10-10T09:00:00.000Z",
});

/** What a member who may see money gets. */
const MONEY_VIEW: WorkRulesView = {
  canEdit: true,
  canSeeMoney: true,
  current: V2.rules,
  defaults: { ...DEFAULT_WORK_RULES },
  limits: { ...WORK_RULE_LIMITS },
  versions: [V1, V2, V3],
  today: TODAY,
};

/** The API leaves the money rule out (values and limits) for a member who may not see money. */
function withoutMoney<T extends Partial<WorkRules>>(rules: T): Partial<WorkRules> {
  const copy: Partial<WorkRules> = { ...rules };
  delete copy.forgottenStampPenaltyAgorot;
  return copy;
}
const NO_MONEY_VIEW: WorkRulesView = {
  canEdit: false,
  canSeeMoney: false,
  current: withoutMoney(V2.rules),
  defaults: withoutMoney(DEFAULT_WORK_RULES),
  limits: Object.fromEntries(Object.entries(WORK_RULE_LIMITS).filter(([key]) => key !== "forgottenStampPenaltyAgorot")),
  versions: [V1, V2, V3].map((candidate) => ({ ...candidate, rules: withoutMoney(candidate.rules) })),
  today: TODAY,
};

function impact(effectiveFrom: string): WorkRulesImpact {
  return effectiveFrom >= "2026-12-01"
    ? { effectiveFrom, openMonths: [], finalizedMonths: [{ yearMonth: "2026-12", version: 1 }] }
    : { effectiveFrom, openMonths: [{ yearMonth: "2026-10", status: "REVIEW", version: 2 }], finalizedMonths: [] };
}

const RULE_LABELS = [
  "يوم العمل العادي",
  "تبدأ الساعات الإضافية بعد",
  "مخالفات نسيان التسجيل دون خصم في الشهر",
  "الخصم عن كل مخالفة بعدها",
  "احتساب الطوارئ قبل الضغط على البدء",
  "احتساب الطوارئ بعد الضغط على الإنهاء",
  "أقرب وقت لبدء الدوام قبل الوردية",
];
const PAST_NEVER_CHANGES = "لا يُعاد حساب الماضي أبدًا: الأيام التي قبل تاريخ البدء تبقى بالقواعد التي كانت سارية فيها، والرواتب المعتمدة تحتفظ بأرقامها.";
const REASON = "اتفاق مع ممثلي العمال";

// ── Helpers ─────────────────────────────────────────────────────────────
/** Matches the innermost element whose whole text (nested elements included) is exactly `text`. */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text);
}

function renderPage() {
  return renderWithIntl(<WorkRulesPage />, { queryClient: true });
}

function card(title: string): HTMLElement {
  const element = screen.getByRole("heading", { level: 2, name: title }).closest(".rounded-lg");
  if (!element) throw new Error(`no card ${title}`);
  return element as HTMLElement;
}

/** Each current rule: label, value and what it means. */
function currentRules() {
  return Array.from(card("القواعد السارية اليوم").querySelectorAll("dl > div"), (row) => {
    const [value, hint] = Array.from(row.querySelectorAll("dd > p"), (p) => p.textContent);
    return [row.querySelector("dt")?.textContent, value, hint];
  });
}

/** The history rows, newest first: version cell, date cell, reason, changes. */
function historyRows() {
  return within(card("سجل الإصدارات"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()));
}

async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: "تغيير القواعد" }));
  return card("تغيير القواعد");
}

function ruleBox(form: HTMLElement, label: string) {
  return within(form).getByRole("checkbox", { name: label }) as HTMLInputElement;
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.value = authWithAccess(builtInAccess(SystemRoleKey.OWNER), client);
  client.getWorkRules.mockResolvedValue(MONEY_VIEW);
  client.getWorkRulesImpact.mockImplementation(async (effectiveFrom: string) => impact(effectiveFrom));
});

describe("Work rules page: what is in force, and the history", () => {
  it("states the seven rules in force today in plain Arabic, the money one as ₪ for a member who may see money", async () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "قواعد العمل" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "الإعدادات" }).getAttribute("href")).toBe("/settings");
    expect(await screen.findByText(fullText("الإصدار 2، ساري منذ 1 سبتمبر 2026."))).toBeTruthy();
    expect(currentRules()).toEqual([
      [RULE_LABELS[0], "8 ساعات و30 دقيقة", "طول يوم العمل الكامل: به يُحتسب «احتساب يوم كامل»، وعليه يُقسَم الأجر اليومي عند احتساب جزء من يوم."],
      [RULE_LABELS[1], "8 ساعات و30 دقيقة", "ما يزيد على هذه المدة في اليوم يُحسب ساعات إضافية. لا تقل عن يوم العمل العادي."],
      [RULE_LABELS[2], "مخالفتان", "لكل عامل في كل شهر، ويُخصم عن كل مخالفة بعدها."],
      [RULE_LABELS[3], "₪ 10.00", "يُخصم من راتب العامل عن كل مخالفة نسيان تسجيل بعد المخالفات المسموحة."],
      [RULE_LABELS[4], "ساعة واحدة", "يُحتسب استدعاء الطوارئ من هذه المدة قبل ضغط العامل على البدء."],
      [RULE_LABELS[5], "15 دقيقة", "طريق العودة: يُحتسب الاستدعاء حتى هذه المدة بعد الضغط على الإنهاء."],
      [RULE_LABELS[6], "ساعة واحدة", "لا يستطيع العامل بدء الدوام قبل موعد ورديته بأكثر من هذه المدة."],
    ]);
    expect(within(card("القواعد السارية اليوم")).getByText("₪ 10.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // The version that has not started yet is announced.
    const upcoming = within(card("القواعد السارية اليوم")).getByText(fullText("لم يبدأ بعديبدأ الإصدار 3 في 1 نوفمبر 2026."));
    expect(within(upcoming).getByText("لم يبدأ بعد")).toBeTruthy();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("lists every version newest first: when it starts, why, what it changed, and which has not started yet", async () => {
    renderPage();
    await screen.findByText(fullText("الإصدار 2، ساري منذ 1 سبتمبر 2026."));

    expect(
      within(card("سجل الإصدارات"))
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["الإصدار", "يبدأ من", "السبب", "ما تغيّر"]);
    expect(historyRows()).toEqual([
      [
        "الإصدار 3لم يبدأ بعد",
        "1 نوفمبر 2026أُضيف في 10 أكتوبر 2026 في 12:00",
        "تشديد نسيان التسجيل",
        "مخالفات نسيان التسجيل دون خصم في الشهر: القيمة السابقة مخالفتان، والجديدة 3 مخالفات.الخصم عن كل مخالفة بعدها: القيمة السابقة ₪ 10.00، والجديدة ₪ 15.00.",
      ],
      [
        "الإصدار 2سارٍ الآن",
        "1 سبتمبر 2026أُضيف في 20 أغسطس 2026 في 12:00",
        "اتفاق عمل جديد",
        "يوم العمل العادي: القيمة السابقة 9 ساعات، والجديدة 8 ساعات و30 دقيقة.تبدأ الساعات الإضافية بعد: القيمة السابقة 9 ساعات، والجديدة 8 ساعات و30 دقيقة.",
      ],
      ["الإصدار 1", "منذ البداية", "القيم الأصلية", "القيم الأولى"],
    ]);
  });

  it("never renders money for a member who may not see it: no penalty rule, no amount in the history, read-only", async () => {
    auth.value = authWithAccess(builtInAccess(SystemRoleKey.FIELD_MANAGER), client);
    client.getWorkRules.mockResolvedValue(NO_MONEY_VIEW);
    renderPage();

    expect(await screen.findByText("للاطلاع فقط: يغيّر القواعد من يملك صلاحية تعديل إعدادات المؤسسة.")).toBeTruthy();
    expect(currentRules().map(([label]) => label)).toEqual(RULE_LABELS.filter((label) => label !== "الخصم عن كل مخالفة بعدها"));
    expect(historyRows()[0][3]).toBe("مخالفات نسيان التسجيل دون خصم في الشهر: القيمة السابقة مخالفتان، والجديدة 3 مخالفات.");
    expect(document.body.textContent).not.toContain("₪");
    expect(screen.queryByText("الخصم عن كل مخالفة بعدها")).toBeNull();
    expect(screen.queryByRole("button", { name: "تغيير القواعد" })).toBeNull();
  });

  it("does not render the money even if the API sent it to a member without VIEW_FINANCIALS", async () => {
    auth.value = authWithAccess(builtInAccess(SystemRoleKey.FIELD_MANAGER), client);
    client.getWorkRules.mockResolvedValue({ ...MONEY_VIEW, canEdit: false });
    renderPage();

    await screen.findByText(fullText("الإصدار 2، ساري منذ 1 سبتمبر 2026."));
    expect(document.body.textContent).not.toContain("₪");
    expect(screen.queryByText("الخصم عن كل مخالفة بعدها")).toBeNull();
  });

  it("is for whoever reads the settings: a member without VIEW_ORG_SETTINGS is sent to the dashboard", async () => {
    auth.value = authWithAccess(ACCOUNTANT, client);
    renderPage();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(client.getWorkRules).not.toHaveBeenCalled();
  });
});

describe("Work rules page: «تغيير القواعد»", () => {
  it("starts tomorrow at the earliest, from the values in force then, and shows which payroll months the change reaches", async () => {
    renderPage();
    const form = await openForm();

    expect(within(form).getByText(PAST_NEVER_CHANGES)).toBeTruthy();
    const date = within(form).getByLabelText("يبدأ الإصدار الجديد في") as HTMLInputElement;
    expect(date.value).toBe("2026-10-15");
    expect(date.min).toBe("2026-10-15");
    expect(date.getAttribute("dir")).toBe("ltr");
    expect(within(form).getByText(fullText("تُطبَّق القواعد الجديدة على الأيام من 15 أكتوبر 2026 فصاعدًا."))).toBeTruthy();

    // The impact of that date.
    expect(await within(form).findByText(fullText("أكتوبر 2026 — قيد المراجعة"))).toBeTruthy();
    expect(client.getWorkRulesImpact).toHaveBeenCalledWith("2026-10-15");
    expect(within(form).getByText("الأشهر المفتوحة التي ستُحسب بالقواعد الجديدة (للأيام من تاريخ البدء) عند حسابها التالي:")).toBeTruthy();
    expect(within(form).getByText("الأشهر المعتمدة لا تتغيّر:")).toBeTruthy();
    expect(within(form).getByText("لا توجد أشهر معتمدة من تاريخ البدء فصاعدًا.")).toBeTruthy();

    // Another date: its own impact; a finalized month is listed as unchanged.
    fireEvent.change(date, { target: { value: "2026-12-01" } });
    expect(await within(form).findByText(fullText("ديسمبر 2026 (الإصدار 1)"))).toBeTruthy();
    expect(within(form).getByText("لا توجد أشهر رواتب مفتوحة يصلها هذا التغيير.")).toBeTruthy();

    // A rule starts from the value in force on the chosen date (here the version of 1 November).
    fireEvent.click(ruleBox(form, "مخالفات نسيان التسجيل دون خصم في الشهر"));
    expect((within(form).getByLabelText("القيمة الجديدة (عدد المخالفات)") as HTMLInputElement).value).toBe("3");
    expect(within(form).getByText(fullText("القيمة السارية في ذلك التاريخ: 3 مخالفات"))).toBeTruthy();
  });

  it("refuses today or an earlier day, out-of-range values, an overtime start before the end of the day, and a missing reason", async () => {
    renderPage();
    const form = await openForm();
    const save = within(form).getByRole("button", { name: "حفظ الإصدار الجديد" });

    // Nothing chosen yet.
    fireEvent.change(within(form).getByLabelText("يبدأ الإصدار الجديد في"), { target: { value: TODAY } });
    fireEvent.click(save);
    expect(within(form).getByText("اختر تاريخًا بعد اليوم (من 15 أكتوبر 2026).")).toBeTruthy();
    expect(within(form).getByText("اختر قاعدة واحدة على الأقل وغيّر قيمتها.")).toBeTruthy();
    expect(within(form).getByText("اكتب سبب التغيير.")).toBeTruthy();
    // No impact is asked for a day that cannot be chosen.
    expect(client.getWorkRulesImpact).not.toHaveBeenCalledWith(TODAY);

    fireEvent.change(within(form).getByLabelText("يبدأ الإصدار الجديد في"), { target: { value: "2026-10-20" } });
    fireEvent.click(ruleBox(form, "يوم العمل العادي"));
    const standard = within(form).getByLabelText("القيمة الجديدة (بالدقائق)") as HTMLInputElement;
    expect(standard.value).toBe("510");
    fireEvent.change(standard, { target: { value: "30" } });
    expect(within(form).getByText("أدخل عددًا صحيحًا من 60 إلى 1440.")).toBeTruthy();
    expect(standard.getAttribute("aria-invalid")).toBe("true");

    // A longer day than the overtime start.
    fireEvent.change(standard, { target: { value: "600" } });
    expect(within(form).getByText("= 10 ساعات")).toBeTruthy();
    expect(within(form).getByText("لا يمكن أن تبدأ الساعات الإضافية قبل نهاية يوم العمل العادي (10 ساعات).")).toBeTruthy();

    fireEvent.click(ruleBox(form, "الخصم عن كل مخالفة بعدها"));
    const penalty = within(form).getByLabelText("القيمة الجديدة (₪)") as HTMLInputElement;
    expect(penalty.value).toBe("10.00");
    fireEvent.change(penalty, { target: { value: "12.505" } });
    expect(within(form).getByText("أدخل مبلغًا من ₪ 0.00 إلى ₪ 10,000.00 (حتى منزلتين عشريتين).")).toBeTruthy();
    expect(client.createWorkRuleVersion).not.toHaveBeenCalled();
  });

  it("saves only the rules that change, with the date and the reason, then shows the new history", async () => {
    const saved: WorkRulesView = { ...MONEY_VIEW, versions: [...MONEY_VIEW.versions, version({ ...V3, id: "v-4", version: 4, effectiveFrom: "2026-10-20", reason: REASON, createdAt: "2026-10-14T09:00:00.000Z" })] };
    client.createWorkRuleVersion.mockResolvedValue(saved);
    renderPage();
    const form = await openForm();

    fireEvent.change(within(form).getByLabelText("يبدأ الإصدار الجديد في"), { target: { value: "2026-10-20" } });
    fireEvent.click(ruleBox(form, "تبدأ الساعات الإضافية بعد"));
    fireEvent.change(within(form).getByLabelText("القيمة الجديدة (بالدقائق)"), { target: { value: "540" } });
    fireEvent.click(ruleBox(form, "الخصم عن كل مخالفة بعدها"));
    fireEvent.change(within(form).getByLabelText("القيمة الجديدة (₪)"), { target: { value: "12.5" } });
    // Ticked but left as it is: not sent.
    fireEvent.click(ruleBox(form, "احتساب الطوارئ بعد الضغط على الإنهاء"));
    fireEvent.change(within(form).getByLabelText("سبب التغيير"), { target: { value: `  ${REASON}  ` } });
    fireEvent.click(within(form).getByRole("button", { name: "حفظ الإصدار الجديد" }));

    await waitFor(() => expect(client.createWorkRuleVersion).toHaveBeenCalledTimes(1));
    expect(client.createWorkRuleVersion).toHaveBeenCalledWith({
      effectiveFrom: "2026-10-20",
      reason: REASON,
      overtimeThresholdMinutes: 540,
      forgottenStampPenaltyAgorot: 1250,
    });
    const done = await screen.findByText("تم حفظ الإصدار الجديد من قواعد العمل، ويبدأ في 20 أكتوبر 2026.");
    expect(done.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "تغيير القواعد" })).toBeNull();
    expect(historyRows()[0][0]).toBe("الإصدار 4لم يبدأ بعد");
  });

  it("never offers or sends the money rule to a member who may change the rules but not see money", async () => {
    auth.value = authWithAccess(myAccess({ roleName: "منسق الإعدادات", permissions: [Permission.VIEW_ORG_SETTINGS, Permission.MANAGE_ORG_SETTINGS] }), client);
    client.getWorkRules.mockResolvedValue({ ...NO_MONEY_VIEW, canEdit: true });
    client.createWorkRuleVersion.mockResolvedValue({ ...NO_MONEY_VIEW, canEdit: true });
    renderPage();
    const form = await openForm();

    expect(within(form).queryByRole("checkbox", { name: "الخصم عن كل مخالفة بعدها" })).toBeNull();
    expect(within(form).getAllByRole("checkbox")).toHaveLength(6);
    fireEvent.click(ruleBox(form, "مخالفات نسيان التسجيل دون خصم في الشهر"));
    fireEvent.change(within(form).getByLabelText("القيمة الجديدة (عدد المخالفات)"), { target: { value: "1" } });
    fireEvent.change(within(form).getByLabelText("سبب التغيير"), { target: { value: REASON } });
    fireEvent.click(within(form).getByRole("button", { name: "حفظ الإصدار الجديد" }));

    await waitFor(() => expect(client.createWorkRuleVersion).toHaveBeenCalledTimes(1));
    expect(client.createWorkRuleVersion).toHaveBeenCalledWith({ effectiveFrom: "2026-10-15", reason: REASON, freeForgottenStampsPerMonth: 1 });
    expect(document.body.textContent).not.toContain("₪");
  });

  it.each([
    { code: "WORK_RULES_EFFECTIVE_DATE_PAST", status: 400, message: "يجب أن يبدأ سريان التغيير بعد اليوم. لا تُعدَّل الأيام الماضية." },
    { code: "WORK_RULES_INVALID", status: 400, message: "قيم قواعد العمل غير صالحة. راجع الحدود المسموحة لكل قاعدة." },
    { code: "FORBIDDEN", status: 403, message: "ليست لديك صلاحية لتنفيذ هذا الإجراء." },
  ])("shows the API's $code in Arabic and keeps the form", async ({ code, status, message }) => {
    client.createWorkRuleVersion.mockRejectedValue(apiError(status, code, "English API message"));
    renderPage();
    const form = await openForm();
    fireEvent.click(ruleBox(form, "احتساب الطوارئ قبل الضغط على البدء"));
    fireEvent.change(within(form).getByLabelText("القيمة الجديدة (بالدقائق)"), { target: { value: "90" } });
    expect(within(form).getByText("= ساعة واحدة و30 دقيقة")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("سبب التغيير"), { target: { value: REASON } });
    fireEvent.click(within(form).getByRole("button", { name: "حفظ الإصدار الجديد" }));

    expect((await within(form).findByRole("alert")).textContent).toBe(message);
    expect(screen.queryByText("English API message")).toBeNull();
    expect(client.createWorkRuleVersion).toHaveBeenCalledWith({ effectiveFrom: "2026-10-15", reason: REASON, emergencyMinutesBefore: 90 });
    expect(screen.getByRole("heading", { name: "تغيير القواعد" })).toBeTruthy();
  });
});
