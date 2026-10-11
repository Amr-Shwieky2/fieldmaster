import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import WorkersPage from "../page";
import { MANAGER_WORKERS, OWNER_WORKERS, PENDING, apiError, hasArabicIndicDigits, renderWorkersPage } from "./workers-test-utils";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/workers",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

const auth = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ client: auth.client, session: null, isAuthenticated: true, isReady: true, login: () => {}, logout: () => {} }),
}));

function setClient(client: { listWorkers: () => Promise<unknown>; listPendingApproval: () => Promise<unknown> }) {
  auth.client = client;
  return client;
}

describe("Workers list page", () => {
  beforeEach(() => {
    nav.replace.mockClear();
    auth.client = {};
  });

  it("renders the pending list, translated statuses and Western-digit money", async () => {
    setClient({ listWorkers: vi.fn().mockResolvedValue(OWNER_WORKERS), listPendingApproval: vi.fn().mockResolvedValue(PENDING) });
    renderWorkersPage(<WorkersPage />);

    expect(screen.getByRole("heading", { level: 1, name: "العمال" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "بانتظار الموافقة (1)" })).toBeTruthy();
    const review = screen.getByRole("link", { name: "مراجعة الطلب: Nadia Khoury" });
    expect(review.getAttribute("href")).toBe("/workers/w-pending/approve");
    expect(screen.getByText("+972500010009").closest("bdi")?.getAttribute("dir")).toBe("ltr");

    const table = await screen.findByRole("table", { name: "جميع العمال" });
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["الاسم", "رقم الهاتف", "الحالة", "الأجر"]);
    expect(within(table).getByText("نشط")).toBeTruthy();
    expect(within(table).getByText("موقوف")).toBeTruthy();
    expect(within(table).queryByText("ACTIVE")).toBeNull();

    const daily = within(table).getByText("₪ 400.00");
    expect(daily.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(daily.closest("td")?.textContent).toBe("₪ 400.00 يوميًا");
    const hourly = within(table).getByText("₪ 1,234.50");
    expect(hourly.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(hourly.closest("td")?.textContent).toBe("₪ 1,234.50 للساعة");
    expect(within(table).getByRole("link", { name: "Eli Ramzani" }).getAttribute("href")).toBe("/workers/w-daily");
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("shows an em dash instead of compensation for a Field Manager (the API omits it)", async () => {
    setClient({ listWorkers: vi.fn().mockResolvedValue(MANAGER_WORKERS), listPendingApproval: vi.fn().mockResolvedValue([]) });
    renderWorkersPage(<WorkersPage />);

    const table = await screen.findByRole("table", { name: "جميع العمال" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getAllByRole("cell")[3].textContent).toBe("—");
    expect(table.textContent).not.toContain("₪");
  });

  it("shows the empty state and hides the pending card when there is nothing to show", async () => {
    setClient({ listWorkers: vi.fn().mockResolvedValue([]), listPendingApproval: vi.fn().mockResolvedValue([]) });
    renderWorkersPage(<WorkersPage />);

    expect(await screen.findByText("لا يوجد عمال بعد")).toBeTruthy();
    expect(screen.getByText("أرسل دعوة إلى عامل للبدء.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/بانتظار الموافقة/)).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    const listWorkers = vi
      .fn()
      .mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"))
      .mockResolvedValue(OWNER_WORKERS);
    setClient({ listWorkers, listPendingApproval: vi.fn().mockResolvedValue([]) });
    renderWorkersPage(<WorkersPage />);

    expect(await screen.findByText("حدث خطأ ما")).toBeTruthy();
    expect(screen.getByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("table", { name: "جميع العمال" })).toBeTruthy();
    expect(listWorkers).toHaveBeenCalledTimes(2);
  });

  it("shows access denied when the API answers 403", async () => {
    setClient({ listWorkers: vi.fn().mockRejectedValue(apiError(403, "FORBIDDEN")), listPendingApproval: vi.fn().mockRejectedValue(apiError(403, "FORBIDDEN")) });
    renderWorkersPage(<WorkersPage />);

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("table")).toBeNull();
    // A forbidden pending list is simply hidden, not a second error.
    expect(screen.queryByText(/بانتظار الموافقة/)).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("shows an error with retry for the pending list without hiding the roster", async () => {
    const listPendingApproval = vi.fn().mockRejectedValueOnce(apiError(503, "SERVICE_UNAVAILABLE")).mockResolvedValue(PENDING);
    setClient({ listWorkers: vi.fn().mockResolvedValue(OWNER_WORKERS), listPendingApproval });
    renderWorkersPage(<WorkersPage />);

    expect(await screen.findByText("الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.")).toBeTruthy();
    expect(screen.getByText("بانتظار الموافقة")).toBeTruthy();
    expect(await screen.findByRole("table", { name: "جميع العمال" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "بانتظار الموافقة (1)" })).toBeTruthy());
    expect(listPendingApproval).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
