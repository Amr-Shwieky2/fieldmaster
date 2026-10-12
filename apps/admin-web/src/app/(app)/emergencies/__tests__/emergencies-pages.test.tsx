import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { EmergencyCalloutRecord, Paginated } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";
import { CALLOUT_FOR_MANAGER, CALLOUT_FOR_OWNER, apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import EmergenciesPage from "../page";
import EmergencyDetailPage from "../[id]/page";

// ── Mocks ───────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listEmergencyCallouts: vi.fn(),
  listWorkers: vi.fn(),
  getEmergencyCallout: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "FIELD_MANAGER" }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => "/emergencies",
  useSearchParams: () => nav.search,
  useParams: () => ({ id: "co-1" }),
}));

// Leaflet stays out of jsdom: the map is a stub, the text legend under it is real.
vi.mock("next/dynamic", () => ({
  default: () =>
    function EvidenceMapStub({ ariaLabel, points }: { ariaLabel?: string; points?: unknown[] }) {
      return <div data-testid="evidence-map" aria-label={ariaLabel} data-points={points?.length ?? 0} />;
    },
}));

// ── Helpers ─────────────────────────────────────────────────────────────
const WORKER = "خالد ناصر";
const WORKER_ID = "3f9a1c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const COST_TITLE = "التكلفة التقديرية";
const NOT_ENDED = "لم ينتهِ بعد";

/** An ongoing call-out (the worker has not pressed "end" yet) as an Owner receives it. */
const ONGOING: EmergencyCalloutRecord = {
  ...CALLOUT_FOR_OWNER,
  actualEndClick: null,
  compensatedEnd: null,
  actualWorkedMinutes: null,
  returnBufferMinutes: null,
  compensatedDurationMinutes: null,
  end: null,
  status: "ACTIVE",
  summary: null,
  estimatedCostAgorot: null,
};

function listOf(items: EmergencyCalloutRecord[], overrides: Partial<Paginated<EmergencyCalloutRecord>> = {}): Paginated<EmergencyCalloutRecord> {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}

function renderList() {
  return renderWithIntl(<EmergenciesPage />, { queryClient: true });
}

function renderDetail() {
  return renderWithIntl(<EmergencyDetailPage />, { queryClient: true });
}

/** Text of each cell of the list's first call-out row. */
async function firstRowCells(): Promise<(string | null)[]> {
  const table = await screen.findByRole("table", { name: "استدعاءات الطوارئ" });
  const [, firstRow] = within(table).getAllByRole("row");
  return within(firstRow)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

function columnHeaders(): (string | null)[] {
  return within(screen.getByRole("table"))
    .getAllByRole("columnheader")
    .map((header) => header.textContent);
}

/** The card with this title (a card is its header, holding the title, followed by its content). */
function card(title: string): HTMLElement {
  const element = screen.getByRole("heading", { level: 2, name: title }).parentElement?.parentElement;
  if (!element) throw new Error(`no card titled ${title}`);
  return element;
}

/** The value next to a label of a description list. */
function valueOf(container: HTMLElement, label: string): string | null | undefined {
  return within(container).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

/** Matches the innermost element whose whole text (nested elements included) is exactly `text`. */
function fullText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text && ![...element.children].some((child) => child.textContent === text);
}

/** Starts recording whether `text` is ever added to the page, even if it is removed right after; the returned function stops and answers. */
function watchForText(text: string): () => boolean {
  let seen = false;
  const check = (records: MutationRecord[]) => {
    for (const record of records) for (const node of record.addedNodes) if (node.textContent?.includes(text)) seen = true;
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    check(observer.takeRecords());
    observer.disconnect();
    return seen;
  };
}

function legendLines(): (string | null)[] {
  return within(screen.getByRole("list", { name: "ما يظهر على الخريطة" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "FIELD_MANAGER";
  nav.search = new URLSearchParams();
  client.listEmergencyCallouts.mockResolvedValue(listOf([CALLOUT_FOR_MANAGER]));
  client.listWorkers.mockResolvedValue([{ id: WORKER_ID, fullLegalName: WORKER }]);
  client.getEmergencyCallout.mockResolvedValue(CALLOUT_FOR_MANAGER);
});

describe("Emergency call-outs list", () => {
  it("shows the loading state while the call-outs load", () => {
    client.listEmergencyCallouts.mockReturnValue(new Promise(() => {}));
    renderList();

    expect(screen.getByRole("heading", { level: 1, name: "استدعاءات الطوارئ" })).toBeTruthy();
    expect(screen.getByText("جارٍ التحميل…").closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a Field Manager the four times and both durations, without any cost", async () => {
    renderList();

    // Actual start 21:26Z is 00:26 on the next day in Asia/Jerusalem (IDT); compensated = 60 min before / 15 min after.
    expect(await firstRowCells()).toEqual([
      WORKER,
      "تكليف بمناوبة ليلية",
      "5 أكتوبر 2026 في 00:26",
      "4 أكتوبر 2026 في 23:26",
      "5 أكتوبر 2026 في 01:26",
      "5 أكتوبر 2026 في 01:41",
      "1 س 0 د",
      "2 س 15 د",
      "بانتظار الموافقة",
      "التفاصيل",
    ]);
    expect(client.listEmergencyCallouts).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(
      within(screen.getByRole("table"))
        .getByRole("link", { name: `عرض تفاصيل استدعاء ${WORKER}` })
        .getAttribute("href"),
    ).toBe("/emergencies/co-1");

    expect(columnHeaders()).not.toContain(COST_TITLE);
    expect(screen.queryByText(COST_TITLE)).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("adds the estimated cost column for the Owner", async () => {
    auth.role = "OWNER";
    client.listEmergencyCallouts.mockResolvedValue(listOf([CALLOUT_FOR_OWNER]));
    renderList();

    const cells = await firstRowCells();
    expect(cells[9]).toBe("₪ 111.11");
    expect(columnHeaders()[9]).toBe(COST_TITLE);
    expect(within(screen.getByRole("table")).getByText("₪ 111.11").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("sends the filters from the URL and shows them in the filter controls", async () => {
    nav.search = new URLSearchParams(`workerProfileId=${WORKER_ID}&status=APPROVED&from=2026-10-01&to=2026-10-31&page=2`);
    client.listEmergencyCallouts.mockResolvedValue(listOf([CALLOUT_FOR_MANAGER], { page: 2, total: 21 }));
    renderList();

    await waitFor(() =>
      expect(client.listEmergencyCallouts).toHaveBeenCalledWith({
        workerProfileId: WORKER_ID,
        status: "APPROVED",
        from: "2026-10-01",
        to: "2026-10-31",
        page: 2,
        pageSize: 20,
      }),
    );
    expect((screen.getByLabelText("حالة الموافقة") as HTMLSelectElement).value).toBe("APPROVED");
    expect((screen.getByLabelText("من تاريخ") as HTMLInputElement).value).toBe("2026-10-01");
    expect((screen.getByLabelText("إلى تاريخ") as HTMLInputElement).value).toBe("2026-10-31");
    await waitFor(() => expect((screen.getByLabelText("العامل") as HTMLSelectElement).value).toBe(WORKER_ID));
    expect(screen.getByRole("button", { name: "مسح التصفية" })).toBeTruthy();
    expect(await screen.findByText("صفحة 2 من 2")).toBeTruthy();
  });

  it("changes the status through the URL and goes back to the first page", async () => {
    nav.search = new URLSearchParams("status=APPROVED&page=3");
    renderList();
    await screen.findByRole("table");

    fireEvent.change(screen.getByLabelText("حالة الموافقة"), { target: { value: "REJECTED" } });
    expect(nav.replace).toHaveBeenLastCalledWith("/emergencies?status=REJECTED");

    fireEvent.change(screen.getByLabelText("حالة الموافقة"), { target: { value: "" } });
    expect(nav.replace).toHaveBeenLastCalledWith("/emergencies");
    expect(nav.replace.mock.calls.some(([url]) => String(url).includes("page="))).toBe(false);
  });

  it("drops invalid values from the URL instead of sending them", async () => {
    nav.search = new URLSearchParams("workerProfileId=wp-1&status=DONE&from=2026-10-32&to=yesterday&page=0");
    renderList();
    await screen.findByRole("table");

    expect(client.listEmergencyCallouts).toHaveBeenCalledTimes(1);
    const [filters] = client.listEmergencyCallouts.mock.calls[0];
    expect(Object.entries(filters).filter(([, value]) => value !== undefined)).toEqual([
      ["page", 1],
      ["pageSize", 20],
    ]);
    expect((screen.getByLabelText("حالة الموافقة") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("العامل") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("من تاريخ") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "مسح التصفية" })).toBeNull();
  });

  it("shows the page's empty state", async () => {
    client.listEmergencyCallouts.mockResolvedValue(listOf([]));
    renderList();

    expect(await screen.findByText("لا توجد استدعاءات طوارئ")).toBeTruthy();
    expect(screen.getByText("تظهر هنا الاستدعاءات التي تبدأ من مناوبة ليلية أو بإذن من المدير.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    client.listEmergencyCallouts.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderList();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(client.listEmergencyCallouts).toHaveBeenCalledTimes(2);
  });

  it("shows access denied when the API answers 403", async () => {
    client.listEmergencyCallouts.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden"));
    renderList();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
  });
});

describe("Emergency call-outs list: a page past the end", () => {
  const EMPTY_TITLE = "لا توجد استدعاءات طوارئ";

  it("sends a page past the end to the last page, showing the loading state instead of the empty state meanwhile", async () => {
    nav.search = new URLSearchParams("page=3");
    client.listEmergencyCallouts.mockImplementation(async ({ page }: { page: number }) =>
      page === 3 ? listOf([], { page: 3, total: 25 }) : listOf([CALLOUT_FOR_MANAGER], { page, total: 25 }),
    );
    const emptyStateShown = watchForText(EMPTY_TITLE);
    const { rerender } = renderList();

    // 25 call-outs at 20 per page: page 2 is the last one.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/emergencies?page=2"));
    expect(screen.getByText("جارٍ التحميل…").closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();

    // The router opens page 2: its rows replace the loading state, without another redirect.
    nav.search = new URLSearchParams("page=2");
    rerender(<EmergenciesPage />);
    expect(await screen.findByText("صفحة 2 من 2")).toBeTruthy();
    expect(screen.queryByText("جارٍ التحميل…")).toBeNull();
    expect(client.listEmergencyCallouts).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(emptyStateShown()).toBe(false);
  });

  it("keeps the other filters and drops the page from the URL when the last page is the first", async () => {
    nav.search = new URLSearchParams("status=APPROVED&page=3");
    client.listEmergencyCallouts.mockResolvedValue(listOf([], { page: 3, total: 5 }));
    renderList();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/emergencies?status=APPROVED"));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(screen.getByText("جارٍ التحميل…")).toBeTruthy();
    expect(screen.queryByText(EMPTY_TITLE)).toBeNull();
  });

  it("does nothing when there are no call-outs at all", async () => {
    client.listEmergencyCallouts.mockResolvedValue(listOf([]));
    renderList();

    expect(await screen.findByText(EMPTY_TITLE)).toBeTruthy();
    expect(screen.queryByText("جارٍ التحميل…")).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("does nothing for a page within range", async () => {
    nav.search = new URLSearchParams("page=2");
    client.listEmergencyCallouts.mockResolvedValue(listOf([CALLOUT_FOR_MANAGER], { page: 2, total: 25 }));
    renderList();

    expect(await screen.findByText("صفحة 2 من 2")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByText("جارٍ التحميل…")).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("Emergency call-out detail", () => {
  it("shows the times, authorization, start and end locations, summary and approval", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { level: 1, name: WORKER })).toBeTruthy();
    expect(client.getEmergencyCallout).toHaveBeenCalledWith("co-1");
    expect(screen.getByText("استدعاء طوارئ")).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى استدعاءات الطوارئ" }).getAttribute("href")).toBe("/emergencies");

    const times = card("الأوقات");
    expect(valueOf(times, "البداية الفعلية (الضغط على البدء)")).toBe("5 أكتوبر 2026 في 00:26");
    expect(valueOf(times, "البداية المحتسبة (قبل 60 دقيقة)")).toBe("4 أكتوبر 2026 في 23:26");
    expect(valueOf(times, "النهاية الفعلية (الضغط على الإنهاء)")).toBe("5 أكتوبر 2026 في 01:26");
    expect(valueOf(times, "النهاية المحتسبة (بعد 15 دقيقة)")).toBe("5 أكتوبر 2026 في 01:41");
    expect(valueOf(times, "مدة العمل الفعلية")).toBe("1 س 0 د");
    expect(valueOf(times, "إجمالي المدة المحتسبة")).toBe("2 س 15 د");

    const authorization = card("الإذن");
    expect(within(authorization).getByText("تكليف بمناوبة ليلية")).toBeTruthy();
    expect(within(authorization).getByText(fullText("مناوبة ليلية: من 4 أكتوبر 2026 في 20:00 إلى 5 أكتوبر 2026 في 08:00"))).toBeTruthy();
    expect(within(authorization).queryByText(/بإذن من/)).toBeNull();

    expect(screen.getByTestId("evidence-map").getAttribute("aria-label")).toBe("خريطة موقعي بدء استدعاء الطوارئ وإنهائه");
    expect(screen.getByTestId("evidence-map").getAttribute("data-points")).toBe("2");
    expect(legendLines()).toEqual(["موقع البدء: الدقة 12 م", "موقع الإنهاء: الدقة 8 م"]);
    expect(screen.queryByText("لم ينتهِ الاستدعاء بعد، فلا يوجد موقع إنهاء.")).toBeNull();

    const summary = card("ملخص العمل اليومي");
    expect(within(summary).getByText("إصلاح طارئ")).toBeTruthy();
    expect(within(summary).getByText("أعدت تشغيل وحدة التحكم بالإشارة.").getAttribute("dir")).toBe("auto");

    const approval = card("حالة الموافقة");
    expect(within(approval).getByText("بانتظار الموافقة")).toBeTruthy();
    expect(within(approval).getByRole("link", { name: "عرض سجل الحضور" }).getAttribute("href")).toBe("/attendance/te-9");
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("never shows a cost to a Field Manager", async () => {
    const { unmount } = renderDetail();
    await screen.findByRole("heading", { level: 1, name: WORKER });
    expect(screen.queryByText(COST_TITLE)).toBeNull();
    expect(screen.queryByText("للمالك فقط")).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
    unmount();

    // The role is checked too: an Owner-shaped response still shows no cost to a Field Manager.
    client.getEmergencyCallout.mockResolvedValue(CALLOUT_FOR_OWNER);
    renderDetail();
    await screen.findByRole("heading", { level: 1, name: WORKER });
    expect(screen.queryByText(COST_TITLE)).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows the Owner the estimated cost card", async () => {
    auth.role = "OWNER";
    client.getEmergencyCallout.mockResolvedValue(CALLOUT_FOR_OWNER);
    renderDetail();

    await screen.findByRole("heading", { level: 1, name: WORKER });
    const cost = card(COST_TITLE);
    expect(within(cost).getByText("للمالك فقط")).toBeTruthy();
    expect(within(cost).getByText("₪ 111.11").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("shows a call-out that has not ended yet, with no end location and no cost estimate", async () => {
    auth.role = "OWNER";
    client.getEmergencyCallout.mockResolvedValue(ONGOING);
    renderDetail();

    await screen.findByRole("heading", { level: 1, name: WORKER });
    const times = card("الأوقات");
    expect(valueOf(times, "البداية الفعلية (الضغط على البدء)")).toBe("5 أكتوبر 2026 في 00:26");
    expect(valueOf(times, "البداية المحتسبة (قبل 60 دقيقة)")).toBe("4 أكتوبر 2026 في 23:26");
    expect(valueOf(times, "النهاية الفعلية (الضغط على الإنهاء)")).toBe(NOT_ENDED);
    expect(valueOf(times, "النهاية المحتسبة (بعد 15 دقيقة)")).toBe(NOT_ENDED);
    expect(valueOf(times, "مدة العمل الفعلية")).toBe(NOT_ENDED);
    expect(valueOf(times, "إجمالي المدة المحتسبة")).toBe(NOT_ENDED);

    expect(screen.getByText("لم ينتهِ الاستدعاء بعد، فلا يوجد موقع إنهاء.")).toBeTruthy();
    expect(legendLines()).toEqual(["موقع البدء: الدقة 12 م"]);
    expect(screen.getByTestId("evidence-map").getAttribute("data-points")).toBe("1");
    expect(within(card("ملخص العمل اليومي")).getByText("لم يُرسل الملخص بعد.")).toBeTruthy();
    expect(within(card("حالة الموافقة")).getByText("جارٍ")).toBeTruthy();

    const cost = card(COST_TITLE);
    expect(within(cost).getByText("لا يوجد تقدير بعد (الاستدعاء جارٍ أو لا يوجد أجر مسجّل).")).toBeTruthy();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows a not-found state on 404 instead of the API's English message", async () => {
    client.getEmergencyCallout.mockRejectedValue(apiError(404, "NOT_FOUND", "Emergency call-out not found."));
    renderDetail();

    expect(await screen.findByText("غير موجود")).toBeTruthy();
    expect(screen.getByText("لم نعثر على استدعاء الطوارئ هذا.")).toBeTruthy();
    expect(screen.queryByText("Emergency call-out not found.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "العودة إلى استدعاءات الطوارئ" }).getAttribute("href")).toBe("/emergencies");
  });

  it("shows a translated error with a working retry", async () => {
    client.getEmergencyCallout.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderDetail();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 1, name: WORKER })).toBeTruthy();
    expect(client.getEmergencyCallout).toHaveBeenCalledTimes(2);
  });
});
