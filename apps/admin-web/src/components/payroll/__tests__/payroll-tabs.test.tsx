import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PayrollVersionDetail, PayrollVersionSummary } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import {
  ELI_DETAIL,
  NEW_DEDUCTION,
  OWNER_NAME,
  VERSIONS,
  WORKERS,
  apiError,
  detail,
  json,
  latinWordsOnPage,
  mockApi,
  renderPeriodPage,
  requestsTo,
  seedSession,
  textOf,
} from "./payroll-test-utils";

// The URL is state: `router.replace` changes what `useSearchParams` returns, and the page re-renders.
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { search: "" };
  const go = (url: string) => {
    const query = url.indexOf("?");
    state.search = query === -1 ? "" : url.slice(query + 1);
    for (const listener of listeners) listener();
  };
  return {
    state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace: vi.fn((url: string, _options?: { scroll?: boolean }) => go(url)),
    push: vi.fn((url: string) => go(url)),
  };
});
vi.mock("next/navigation", async () => {
  const { useMemo, useSyncExternalStore } = await import("react");
  return {
    useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
    usePathname: () => "/payroll/2026-09",
    useParams: () => ({ yearMonth: "2026-09" }),
    useSearchParams: () => {
      const search = useSyncExternalStore(
        nav.subscribe,
        () => nav.state.search,
        () => nav.state.search,
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});

const LATEST = "/payroll-periods/2026-09";

/** Opens the month page on a tab, with the latest version answering `version`. */
async function openTab(search: string, version: PayrollVersionDetail = detail(), extraRoutes: Parameters<typeof mockApi>[0] = {}) {
  seedSession(OrgRole.OWNER);
  nav.state.search = search;
  const fetchMock = mockApi({ [`GET ${LATEST}`]: () => json(200, version), ...extraRoutes });
  renderPeriodPage();
  await screen.findByRole("heading", { level: 1, name: /رواتب سبتمبر 2026/ });
  return fetchMock;
}

function cellsOf(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole("cell")
    .map((cell) => textOf(cell));
}

describe("Payroll month tabs", () => {
  beforeEach(() => {
    nav.state.search = "";
    nav.replace.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("العمال", () => {
    it("lists every worker with every figure, deductions as deductions, LTR money, a sticky worker column and the totals", async () => {
      await openTab("");

      const table = screen.getByRole("table", { name: "رواتب العمال لشهر سبتمبر 2026، الإصدار 2" });
      expect(table.parentElement?.className).toContain("overflow-x-auto");
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual([
        "العامل",
        "الورديات المعتمدة",
        "الأيام المحتسبة",
        "الساعات العادية",
        "ساعات إضافية",
        "طوارئ: قبل البدء",
        "طوارئ: بعد الإنهاء",
        "الأجر الأساسي",
        "أجر الساعات الإضافية",
        "إضافات",
        "خصم نسيان التسجيل",
        "إلغاء خصومات",
        "خصومات أخرى",
        "الصافي",
      ]);
      const [workerHeader] = within(table).getAllByRole("columnheader");
      expect(workerHeader.className).toContain("sticky");
      expect(workerHeader.className).toContain("start-0");

      const eli = screen.getByRole("button", { name: "Eli Ramzani" }).closest("tr") as HTMLElement;
      const eliHeader = within(eli).getByRole("rowheader");
      expect(eliHeader.className).toContain("sticky");
      expect(eliHeader.className).toContain("start-0");
      expect(eliHeader.className).toContain("text-start");
      expect(cellsOf(eli)).toEqual([
        "21",
        "21",
        "168 س 0 د",
        "2 س 30 د",
        "1 س 0 د",
        "0 س 15 د",
        "₪ 8,400.00",
        "₪ 123.50",
        "+₪ 50.00",
        "-₪ 25.00",
        "₪ 0.00",
        "₪ 0.00",
        "₪ 8,548.50",
      ]);
      for (const bdi of within(eli).getAllByText(/₪/)) expect(bdi.closest("bdi")?.getAttribute("dir")).toBe("ltr");
      // A penalty reads as a deduction (red), a bonus as an addition (green).
      expect(within(eli).getByText("-₪ 25.00").className).toContain("text-red-700");
      expect(within(eli).getByText("+₪ 50.00").className).toContain("text-emerald-700");

      // Sami: a reversed penalty, entries waiting for approval and an unpaid entry are flagged on the row.
      const sami = screen.getByRole("button", { name: "سامي حداد" }).closest("tr") as HTMLElement;
      expect(cellsOf(sami)).toEqual([
        "3",
        "3",
        "24 س 0 د",
        "0 س 0 د",
        "0 س 0 د",
        "0 س 0 د",
        "₪ 1,234.50",
        "₪ 0.00",
        "₪ 0.00",
        "-₪ 25.00",
        "+₪ 25.00",
        "₪ 0.00",
        "₪ 1,234.50",
      ]);
      expect(within(sami).getByText("بانتظار الموافقة — غير محسوبة: 2")).toBeTruthy();
      expect(within(sami).getByText("بلا أجر ساري — لم تُدفع: 1")).toBeTruthy();
      expect(within(eli).queryByText(/بانتظار الموافقة/)).toBeNull();

      // Totals row from the version's totals.
      const totals = within(table).getByRole("rowheader", { name: "الإجمالي (عاملان)" }).closest("tr") as HTMLElement;
      expect(totals.closest("tfoot")).toBeTruthy();
      expect(cellsOf(totals)).toEqual([
        "24",
        "24",
        "192 س 0 د",
        "2 س 30 د",
        "1 س 0 د",
        "0 س 15 د",
        "₪ 9,634.50",
        "₪ 123.50",
        "+₪ 50.00",
        "-₪ 50.00",
        "+₪ 25.00",
        "₪ 0.00",
        "₪ 9,783.00",
      ]);
      expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    });

    it("drills down into a worker: every approved entry as calculated, linked to its attendance, and the worker's adjustments", async () => {
      const fetchMock = await openTab("", detail(), { "GET /payroll-periods/2026-09/versions/2/workers/wp-1": () => json(200, ELI_DETAIL) });

      const toggle = screen.getByRole("button", { name: "Eli Ramzani" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "") as HTMLElement;
      expect(panel).toBeTruthy();

      const entries = await within(panel).findByRole("table", { name: "الورديات المعتمدة التي احتُسبت لـEli Ramzani" });
      expect(requestsTo(fetchMock, "GET", "/payroll-periods/2026-09/versions/2/workers/wp-1")).toHaveLength(1);
      expect(
        within(entries)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual([
        "يوم العمل",
        "الوردية",
        "المشروع",
        "الموقع",
        "بدء الدوام",
        "إنهاء الدوام",
        "عادية معتمدة",
        "إضافية معتمدة",
        "ملاحظات",
        "الأجر",
        "الأساسي",
        "الإضافي",
        "المجموع",
      ]);
      const [standard, emergency, fullDay] = within(entries).getAllByRole("row").slice(1);

      // A standard shift: the business date links to its attendance entry; times in Jerusalem, LTR.
      const day = within(standard).getByRole("link", { name: "1 سبتمبر 2026" });
      expect(day.getAttribute("href")).toBe("/attendance/te-1");
      expect(cellsOf(standard)).toEqual([
        "صب الأسقف",
        "برج الميناء",
        "الرصيف الشمالي",
        "07:00",
        "17:30",
        "8 س 0 د",
        "2 س 30 د",
        "",
        "أجر الساعة",
        "₪ 400.00",
        "₪ 123.50",
        "₪ 523.50",
      ]);
      expect(within(standard).getByText("07:00").closest("bdi")?.getAttribute("dir")).toBe("ltr");

      // An emergency call-out: the Arabic shift type instead of the API's English placeholder title, no project or site, -60 / +15.
      expect(within(emergency).getByRole("link", { name: "2 سبتمبر 2026" }).getAttribute("href")).toBe("/attendance/te-2");
      expect(cellsOf(emergency)).toEqual([
        "استدعاء طوارئ",
        "بدون مشروع",
        "بدون موقع",
        "22:00",
        "00:00",
        "3 س 15 د",
        "0 س 0 د",
        "استدعاء طوارئ -60 / +15 د",
        "أجر الساعة",
        "₪ 162.50",
        "₪ 0.00",
        "₪ 162.50",
      ]);
      expect(within(emergency).getByText("-60 / +15").closest("bdi")?.getAttribute("dir")).toBe("ltr");
      expect(screen.queryByText(/Emergency Call-out/)).toBeNull();

      // Full-day credit without a compensation profile: not paid.
      expect(cellsOf(fullDay)).toEqual([
        "تركيب النوافذ",
        "برج الميناء",
        "الرصيف الشمالي",
        "07:00",
        "11:00",
        "9 س 0 د",
        "0 س 0 د",
        "احتساب يوم كامل",
        "بلا أجر ساري — لم يُحتسب",
        "₪ 0.00",
        "₪ 0.00",
        "₪ 0.00",
      ]);

      // The worker's adjustments, without a worker column.
      const adjustments = within(panel).getByRole("table", { name: "تعديلات Eli Ramzani في هذا الإصدار" });
      expect(
        within(adjustments)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual(["النوع", "المصدر", "المبلغ", "السبب", "الإضافة", "روابط"]);
      expect(within(adjustments).getByText("مكافأة يدوية")).toBeTruthy();
      expect(within(adjustments).getByText("خصم نسيان تسجيل")).toBeTruthy();

      // Activating the name again closes the drill-down.
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("table", { name: /الورديات المعتمدة التي احتُسبت/ })).toBeNull();
      expect(latinWordsOnPage().text).toEqual(["CSV", "Eli", "Ramzani"]);
    });

    it("says the entries are not available for a version that did not store them", async () => {
      await openTab("", detail({ legacy: true }), {
        "GET /payroll-periods/2026-09/versions/2/workers/wp-1": () => json(200, { ...ELI_DETAIL, entries: null, adjustments: [] }),
      });

      fireEvent.click(screen.getByRole("button", { name: "Eli Ramzani" }));
      expect(await screen.findByText("غير متوفر لهذا الإصدار")).toBeTruthy();
      expect(screen.getByText("لا توجد تعديلات لهذا العامل في هذا الإصدار.")).toBeTruthy();
      expect(screen.queryByRole("table", { name: /الورديات المعتمدة/ })).toBeNull();
    });

    it("shows a translated error in the drill-down when the worker cannot be loaded", async () => {
      await openTab("", detail(), { "GET /payroll-periods/2026-09/versions/2/workers/wp-1": () => apiError(500, "INTERNAL_ERROR") });

      fireEvent.click(screen.getByRole("button", { name: "Eli Ramzani" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
      expect(within(alert).getByRole("button", { name: "إعادة المحاولة" })).toBeTruthy();
    });

    it("shows an empty state, without a table, when the calculation found no worker to pay", async () => {
      const zero = { workers: 0, approvedShifts: 0, standardDaysCredited: 0, regularMinutes: 0, overtimeMinutes: 0, emergencyRetroactiveMinutes: 0 };
      const noMoney = { emergencyReturnMinutes: 0, grossBaseAgorot: 0, overtimeAgorot: 0, positiveAdjustmentsAgorot: 0, forgottenStampPenaltiesAgorot: 0 };
      await openTab(
        "",
        detail({ workers: [], totals: { ...zero, ...noMoney, reversalsAgorot: 0, otherDeductionsAgorot: 0, netPayableAgorot: 0 }, adjustments: [] }),
      );

      expect(screen.getByText("لا يوجد عمال في هذا الإصدار")).toBeTruthy();
      expect(screen.getByText("لم تكن هناك إدخالات معتمدة لهذا الشهر عند الاحتساب.")).toBeTruthy();
      expect(screen.queryByRole("table")).toBeNull();
    });

    it("shows a legacy version's stored net per worker, and nothing invented for what it did not store", async () => {
      await openTab(
        "",
        detail({
          legacy: true,
          totals: null,
          workers: [],
          projects: null,
          sites: null,
          adjustments: [],
          pending: null,
          legacyNetByWorker: [
            { workerProfileId: "wp-1", fullLegalName: "Eli Ramzani", netPayableAgorot: 854850 },
            { workerProfileId: "wp-2", fullLegalName: "سامي حداد", netPayableAgorot: 123450 },
          ],
        }),
      );

      expect(screen.getByText("إصدار من قبل حفظ التفاصيل: تُعرض البيانات المحفوظة فقط")).toBeTruthy();
      const table = screen.getByRole("table", { name: "صافي الرواتب المحفوظ لكل عامل في الإصدار 2" });
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual(["العامل", "الصافي"]);
      expect(within(table).getAllByRole("row").slice(1).map(textOf)).toEqual(["Eli Ramzani₪ 8,548.50", "سامي حداد₪ 1,234.50"]);
      expect(screen.getByText("إجمالي الصافي:", { exact: false }).textContent).toBe("إجمالي الصافي: ₪ 9,783.00");
      expect(screen.queryByRole("button", { name: "Eli Ramzani" })).toBeNull();

      fireEvent.click(screen.getByRole("tab", { name: "المشاريع" }));
      expect(await screen.findByText("غير متوفر لهذا الإصدار")).toBeTruthy();
      fireEvent.click(screen.getByRole("tab", { name: "المواقع" }));
      expect(await screen.findByText("غير متوفر لهذا الإصدار")).toBeTruthy();
    });
  });

  describe("المشاريع / المواقع", () => {
    it("shows the labor cost per project, with shifts without a project as «بدون مشروع»", async () => {
      await openTab("tab=projects");

      expect(screen.getByRole("tab", { name: "المشاريع" }).getAttribute("aria-selected")).toBe("true");
      const table = screen.getByRole("table", { name: "تكلفة العمل لكل مشروع في الإصدار 2" });
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual(["المشروع", "الورديات", "العمال", "الساعات العادية", "ساعات إضافية", "الأجر الأساسي", "أجر الساعات الإضافية", "الإجمالي"]);
      const harbor = within(table).getByRole("rowheader", { name: "برج الميناء" }).closest("tr") as HTMLElement;
      expect(cellsOf(harbor)).toEqual(["23", "2", "187 س 0 د", "2 س 30 د", "₪ 9,384.50", "₪ 123.50", "₪ 9,508.00"]);
      const none = within(table).getByRole("rowheader", { name: "بدون مشروع" }).closest("tr") as HTMLElement;
      expect(cellsOf(none)).toEqual(["1", "1", "5 س 0 د", "0 س 0 د", "₪ 250.00", "₪ 0.00", "₪ 250.00"]);
      expect(screen.getByText("تكلفة العمل فقط: الأجر الأساسي وأجر الساعات الإضافية. التعديلات تُسجَّل لكل عامل، فلا تظهر هنا.")).toBeTruthy();
    });

    it("shows the labor cost per site with its project, and «بدون موقع» for shifts without a site", async () => {
      await openTab("tab=sites");

      const table = screen.getByRole("table", { name: "تكلفة العمل لكل موقع في الإصدار 2" });
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual(["الموقع", "المشروع", "الورديات", "العمال", "الساعات العادية", "ساعات إضافية", "الأجر الأساسي", "أجر الساعات الإضافية", "الإجمالي"]);
      const north = within(table).getByRole("rowheader", { name: "الرصيف الشمالي" }).closest("tr") as HTMLElement;
      expect(cellsOf(north)).toEqual(["برج الميناء", "23", "2", "187 س 0 د", "2 س 30 د", "₪ 9,384.50", "₪ 123.50", "₪ 9,508.00"]);
      const none = within(table).getByRole("rowheader", { name: "بدون موقع" }).closest("tr") as HTMLElement;
      expect(cellsOf(none)[0]).toBe("بدون مشروع");
    });

    it("switches tabs through the URL", async () => {
      await openTab("");

      fireEvent.click(screen.getByRole("tab", { name: "المواقع" }));
      expect(nav.replace).toHaveBeenLastCalledWith("/payroll/2026-09?tab=sites", { scroll: false });
      expect(await screen.findByRole("table", { name: "تكلفة العمل لكل موقع في الإصدار 2" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "المواقع" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "العمال" }).getAttribute("aria-selected")).toBe("false");

      fireEvent.click(screen.getByRole("tab", { name: "العمال" }));
      expect(nav.replace).toHaveBeenLastCalledWith("/payroll/2026-09", { scroll: false });
      expect(await screen.findByRole("table", { name: "رواتب العمال لشهر سبتمبر 2026، الإصدار 2" })).toBeTruthy();
    });
  });

  describe("التعديلات", () => {
    it("lists the included adjustments with signed amounts, sources, reasons, who added them, and links between penalties and reversals", async () => {
      await openTab(
        "tab=adjustments",
        detail({ adjustmentsNotIncluded: [NEW_DEDUCTION], allowedActions: { calculate: true, finalize: true, reopen: false, addAdjustment: false } }),
      );

      const included = screen.getByRole("table", { name: "التعديلات المحتسبة في الإصدار 2" });
      expect(
        within(included)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual(["العامل", "النوع", "المصدر", "المبلغ", "السبب", "الإضافة", "روابط"]);
      const rows = within(included).getAllByRole("row").slice(1);
      expect(rows.map((row) => textOf(within(row).getByRole("rowheader")))).toEqual(["Eli Ramzani", "Eli Ramzani", "سامي حداد", "سامي حداد"]);
      const [bonus, eliPenalty, samiPenalty, reversal] = rows;

      // A manual bonus: positive, green, with its reason and who added it.
      expect(cellsOf(bonus).slice(0, 5)).toEqual(["مكافأة يدوية", "يدوي", "+₪ 50.00", "مكافأة إنهاء الطابق", `20 سبتمبر 2026 في 12:00 بواسطة ${OWNER_NAME}`]);
      expect(within(bonus).getByText("+₪ 50.00").className).toContain("text-emerald-700");
      expect(cellsOf(bonus)[5]).toBe("—");

      // A forgotten-stamp penalty: negative, red, links to its attendance entry and to the month's forgotten stamps.
      expect(cellsOf(eliPenalty).slice(0, 4)).toEqual(["خصم نسيان تسجيل", "النظام", "-₪ 25.00", "—"]);
      expect(within(eliPenalty).getByText("-₪ 25.00").className).toContain("text-red-700");
      expect(within(eliPenalty).getByRole("link", { name: "عرض الحضور" }).getAttribute("href")).toBe("/attendance/te-7");
      expect(within(eliPenalty).getByRole("link", { name: "نسيان التسجيل" }).getAttribute("href")).toBe("/attendance/forgotten-stamps?month=2026-09");
      expect(within(eliPenalty).queryByText("أُلغي هذا الخصم")).toBeNull();

      // A reversed penalty says so and links to its reversal; the reversal links back to the penalty it cancels.
      expect(within(samiPenalty).getByText("أُلغي هذا الخصم")).toBeTruthy();
      expect(within(samiPenalty).getByRole("link", { name: "عرض الإلغاء" }).getAttribute("href")).toBe("#adjustment-adj-rev-sami");
      expect(within(samiPenalty).getByRole("link", { name: "عرض الحضور" }).getAttribute("href")).toBe("/attendance/te-9");
      expect(cellsOf(reversal).slice(0, 4)).toEqual(["إلغاء خصم نسيان تسجيل", "يدوي", "+₪ 25.00", "عطل في الهاتف أثناء التسجيل"]);
      expect(within(reversal).getByRole("link", { name: "يلغي خصم نسيان التسجيل" }).getAttribute("href")).toBe("#adjustment-adj-pen-sami");
      expect(document.getElementById("adjustment-adj-pen-sami")).toBe(samiPenalty);
      expect(document.getElementById("adjustment-adj-rev-sami")).toBe(reversal);

      // Added after the calculation: not included yet.
      const notIncluded = screen.getByRole("table", { name: "التعديلات التي لم تُحتسب بعد" });
      const [deduction] = within(notIncluded).getAllByRole("row").slice(1);
      expect(within(deduction).getByText("لم يُحتسب بعد — أعد الاحتساب")).toBeTruthy();
      expect(cellsOf(deduction).slice(1, 4)).toEqual(["يدوي", "-₪ 10.00", "سلفة على الراتب"]);
      expect(within(included).queryByText("لم يُحتسب بعد — أعد الاحتساب")).toBeNull();

      // Not allowed to add: no form.
      expect(screen.queryByRole("heading", { name: "إضافة تعديل يدوي" })).toBeNull();
      expect(latinWordsOnPage()).toEqual({ text: ["CSV", "Eli", "Ramzani"], attributes: [] });
    });

    it("validates the manual adjustment, reads shekels as exact agorot and sends it, then asks to recalculate", async () => {
      let added = false;
      const fetchMock = await openTab("tab=adjustments", detail(), {
        // After adding, the month is refetched and shows the adjustment as not included yet.
        [`GET ${LATEST}`]: () => json(200, added ? detail({ adjustmentsNotIncluded: [NEW_DEDUCTION] }) : detail()),
        "GET /workers": () => json(200, WORKERS),
        [`POST ${LATEST}/adjustments`]: () => {
          added = true;
          return json(201, NEW_DEDUCTION);
        },
      });

      expect(screen.getByRole("heading", { name: "إضافة تعديل يدوي" })).toBeTruthy();
      const worker = screen.getByLabelText("العامل") as HTMLSelectElement;
      // The version's workers and the organization's active workers (not a suspended one), in Arabic name order.
      await waitFor(() => expect(within(worker).getAllByRole("option")).toHaveLength(4));
      expect(
        within(worker)
          .getAllByRole("option")
          .map((option) => [(option as HTMLOptionElement).value, option.textContent]),
      ).toEqual([
        ["", "اختر العامل"],
        ["wp-2", "سامي حداد"],
        ["wp-3", "ليلى خوري"],
        ["wp-1", "Eli Ramzani"],
      ]);
      expect(screen.getByRole("radio", { name: "إضافة" })).toHaveProperty("checked", true);
      const amount = screen.getByLabelText("المبلغ بالشيكل");
      const reason = screen.getByLabelText("السبب");
      const submit = screen.getByRole("button", { name: "إضافة التعديل" });

      // Everything missing: three messages, nothing sent.
      fireEvent.click(submit);
      expect(screen.getByText("اختر العامل.")).toBeTruthy();
      expect(screen.getByText("اكتب المبلغ.")).toBeTruthy();
      expect(screen.getByText("اكتب سبب التعديل.")).toBeTruthy();
      expect(amount.getAttribute("aria-invalid")).toBe("true");
      expect(amount.getAttribute("aria-describedby")).toContain(screen.getByText("اكتب المبلغ.").id);

      // Amounts that are refused, each with its own message (linked to the field after its hint).
      const amountError = (value: string) => {
        fireEvent.change(amount, { target: { value } });
        const [, errorId] = (amount.getAttribute("aria-describedby") ?? "").split(" ");
        return textOf(document.getElementById(errorId));
      };
      expect(amountError("0")).toBe("يجب أن يكون المبلغ أكبر من صفر.");
      expect(amountError("-5")).toBe("اكتب المبلغ دون إشارة سالبة، واختر «خصم» لخصمه.");
      expect(amountError("12.345")).toBe("اكتب خانتين عشريتين على الأكثر (الأغورات).");
      expect(amountError("12,5")).toBe("اكتب المبلغ بالأرقام فقط، مثل 12.50.");
      expect(amountError("abc")).toBe("اكتب المبلغ بالأرقام فقط، مثل 12.50.");
      expect(requestsTo(fetchMock, "POST", `${LATEST}/adjustments`)).toHaveLength(0);

      // A deduction of ₪ 12.50 for Layla, with the reason trimmed.
      fireEvent.change(worker, { target: { value: "wp-3" } });
      fireEvent.click(screen.getByRole("radio", { name: "خصم" }));
      fireEvent.change(amount, { target: { value: "12.5" } });
      fireEvent.change(reason, { target: { value: "  سلفة على الراتب  " } });
      expect(screen.queryByText("اختر العامل.")).toBeNull();
      fireEvent.click(submit);

      const success = await screen.findByText("أُضيف التعديل. أعد الاحتساب ليدخل في الرواتب.");
      expect(success.getAttribute("role")).toBe("status");
      expect(requestsTo(fetchMock, "POST", `${LATEST}/adjustments`).map((request) => request.body)).toEqual([
        { workerProfileId: "wp-3", type: "MANUAL_DEDUCTION", amountAgorot: 1250, reason: "سلفة على الراتب" },
      ]);
      // The form is cleared and the month refetched: the new adjustment waits for the next calculation.
      expect((worker as HTMLSelectElement).value).toBe("");
      expect((amount as HTMLInputElement).value).toBe("");
      expect(await screen.findByRole("table", { name: "التعديلات التي لم تُحتسب بعد" })).toBeTruthy();

      // A bonus of 7 agorot ("0.07"): exact, no floating-point rounding.
      fireEvent.change(worker, { target: { value: "wp-1" } });
      fireEvent.change(amount, { target: { value: "0.07" } });
      fireEvent.change(reason, { target: { value: "فرق تقريب" } });
      fireEvent.click(submit);
      await waitFor(() => expect(requestsTo(fetchMock, "POST", `${LATEST}/adjustments`)).toHaveLength(2));
      expect(requestsTo(fetchMock, "POST", `${LATEST}/adjustments`)[1].body).toEqual({
        workerProfileId: "wp-1",
        type: "MANUAL_BONUS",
        amountAgorot: 7,
        reason: "فرق تقريب",
      });
    });

    it("translates a refused adjustment", async () => {
      await openTab("tab=adjustments", detail(), {
        "GET /workers": () => json(200, WORKERS),
        [`POST ${LATEST}/adjustments`]: () => apiError(409, "PAYROLL_PERIOD_FINALIZED", "This payroll is finalized."),
      });

      fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-2" } });
      fireEvent.change(screen.getByLabelText("المبلغ بالشيكل"), { target: { value: "100" } });
      fireEvent.change(screen.getByLabelText("السبب"), { target: { value: "مكافأة" } });
      fireEvent.click(screen.getByRole("button", { name: "إضافة التعديل" }));

      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("رواتب هذا الشهر معتمدة نهائياً. أعد فتحها لإجراء التعديلات."));
      expect(screen.queryByText("This payroll is finalized.")).toBeNull();
      expect(screen.queryByText("أُضيف التعديل. أعد الاحتساب ليدخل في الرواتب.")).toBeNull();
    });
  });

  describe("الإصدارات", () => {
    it("shows the version history: who started each version, when and why, its calculation, finalization, workers and net", async () => {
      const history: PayrollVersionSummary[] = [
        { ...VERSIONS[0], legacy: true, createdByName: null },
        {
          ...VERSIONS[1],
          status: "FINALIZED",
          isCurrent: false,
          reopenedByName: null,
          // Reopened before the web app was Arabic only: the stored English default is shown in Arabic.
          reopenReason: "Correction needed after review",
          finalizedAt: "2026-10-03T12:00:00.000Z",
          finalizedByName: OWNER_NAME,
        },
        {
          ...VERSIONS[1],
          id: "pv-3",
          version: 3,
          createdAt: "2026-10-13T09:00:00.000Z",
          reopenedAt: "2026-10-13T09:00:00.000Z",
          reopenReason: "إضافة ورديات منسية",
          calculatedAt: null,
          calculatedByName: null,
          workers: null,
          netPayableAgorot: null,
        },
      ];
      const fetchMock = await openTab("tab=versions", detail({ id: "pv-3", version: 3, previousVersion: 2 }), {
        "GET /payroll-periods/2026-09/versions": () => json(200, history),
      });

      const table = await screen.findByRole("table", { name: "إصدارات رواتب سبتمبر 2026: كيف بدأ كل إصدار ومتى ولماذا، واحتسابه واعتماده النهائي" });
      expect(requestsTo(fetchMock, "GET", "/payroll-periods/2026-09/versions")).toHaveLength(1);
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((th) => th.textContent),
      ).toEqual(["الإصدار", "الحالة", "البداية", "آخر احتساب", "الاعتماد النهائي", "العمال", "الصافي", "العرض"]);
      // Newest first.
      const [v3, v2, v1] = within(table).getAllByRole("row").slice(1);

      expect(textOf(within(v3).getByRole("rowheader"))).toBe("3الحالي");
      expect(cellsOf(v3)).toEqual([
        "قيد المراجعة",
        `أُعيد فتحه بواسطة ${OWNER_NAME} في 13 أكتوبر 2026 في 12:00 — السبب: إضافة ورديات منسية`,
        "—",
        "—",
        "—",
        "—",
        "المعروض الآن",
      ]);
      expect(within(v3).getByText("المعروض الآن").getAttribute("aria-current")).toBe("page");

      expect(textOf(within(v2).getByRole("rowheader"))).toBe("2");
      expect(cellsOf(v2)).toEqual([
        "معتمدة نهائياً",
        "أُعيد فتحه في 1 أكتوبر 2026 في 10:00 — السبب: يلزم تصحيح بعد المراجعة",
        `2 أكتوبر 2026 في 11:30 بواسطة ${OWNER_NAME}`,
        `3 أكتوبر 2026 في 15:00 بواسطة ${OWNER_NAME}`,
        "2",
        "₪ 9,783.00",
        "عرض",
      ]);
      expect(within(v2).getByRole("link", { name: "عرض الإصدار 2" }).getAttribute("href")).toBe("/payroll/2026-09?version=2");

      expect(textOf(within(v1).getByRole("rowheader"))).toBe("1قبل حفظ التفاصيل");
      expect(cellsOf(v1)).toEqual([
        "معتمدة نهائياً",
        "أُنشئ في 30 سبتمبر 2026 في 18:00",
        `30 سبتمبر 2026 في 18:05 بواسطة ${OWNER_NAME}`,
        `30 سبتمبر 2026 في 19:00 بواسطة ${OWNER_NAME}`,
        "2",
        "₪ 9,500.00",
        "عرض",
      ]);
      expect(within(v1).getByRole("link", { name: "عرض الإصدار 1" }).getAttribute("href")).toBe("/payroll/2026-09?version=1");

      // No English leftovers from the stored reason.
      expect(screen.queryByText(/Correction needed/)).toBeNull();
      expect(latinWordsOnPage()).toEqual({ text: ["CSV"], attributes: [] });
    });

    it("links the current version to the month's page and names who created version 1", async () => {
      nav.state.search = "version=1&tab=versions";
      seedSession(OrgRole.OWNER);
      mockApi({
        "GET /payroll-periods/2026-09/versions/1": () =>
          json(200, detail({ id: "pv-1", version: 1, isCurrent: false, status: "FINALIZED", reopenedAt: null, reopenedByName: null, reopenReason: null })),
        "GET /payroll-periods/2026-09/versions": () => json(200, VERSIONS),
      });
      renderPeriodPage();

      const table = await screen.findByRole("table", { name: /^إصدارات رواتب سبتمبر 2026/ });
      const [current, first] = within(table).getAllByRole("row").slice(1);
      expect(within(current).getByText("الحالي")).toBeTruthy();
      expect(within(current).getByRole("link", { name: "عرض الإصدار 2" }).getAttribute("href")).toBe("/payroll/2026-09");
      expect(cellsOf(first)[1]).toBe(`أُنشئ بواسطة ${OWNER_NAME} في 30 سبتمبر 2026 في 18:00`);
      expect(within(first).getByText("المعروض الآن")).toBeTruthy();
    });

    it("shows a translated error with retry when the history cannot be loaded", async () => {
      let calls = 0;
      await openTab("tab=versions", detail(), {
        "GET /payroll-periods/2026-09/versions": () => (++calls === 1 ? apiError(500, "INTERNAL_ERROR") : json(200, VERSIONS)),
      });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
      fireEvent.click(within(alert).getByRole("button", { name: "إعادة المحاولة" }));
      expect(await screen.findByRole("table", { name: /^إصدارات رواتب سبتمبر 2026/ })).toBeTruthy();
    });
  });
});
