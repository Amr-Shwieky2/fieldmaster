import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { Worker } from "@fieldmaster/api-client";
import WorkerDetailPage from "../page";
import { MANAGER_WORKERS, OWNER_WORKERS, apiError, hasArabicIndicDigits, renderWorkersPage } from "../../__tests__/workers-test-utils";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/workers/w-daily",
  useParams: () => ({ id: "w-daily" }),
  useSearchParams: () => new URLSearchParams(),
}));

const auth = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ client: auth.client, session: null, isAuthenticated: true, isReady: true, login: () => {}, logout: () => {} }),
}));

function withGetWorker(getWorker: (id: string) => Promise<Worker>) {
  const mock = vi.fn(getWorker);
  auth.client = { getWorker: mock };
  return mock;
}

/** The value next to a row label in a description list. */
function rowValue(label: string): string | null | undefined {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

describe("Worker detail page", () => {
  beforeEach(() => {
    auth.client = {};
  });

  it("renders the Owner view with translated labels, LTR money and dates in Western digits", async () => {
    const getWorker = withGetWorker(async () => OWNER_WORKERS[0]);
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Eli Ramzani" })).toBeTruthy();
    expect(getWorker).toHaveBeenCalledWith("w-daily");
    expect(screen.getByRole("link", { name: "العودة إلى قائمة العمال" }).getAttribute("href")).toBe("/workers");
    expect(screen.getByText("+972500010001").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("heading", { name: "الملف الشخصي" })).toBeTruthy();
    expect(rowValue("الحالة")).toBe("نشط");
    expect(rowValue("الدور")).toBe("عامل");
    expect(screen.getByRole("heading", { name: "الأجر" })).toBeTruthy();
    expect(rowValue("نوع الأجر")).toBe("أجر اليوم");
    expect(rowValue("أجر اليوم")).toBe("₪ 400.00");
    expect(screen.getByText("₪ 400.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(rowValue("أجر الساعات الإضافية")).toBe("₪ 60.00 للساعة");
    // The date-only column arrives as an ISO timestamp at UTC midnight and must not shift a day.
    expect(rowValue("يسري من")).toBe("15 يناير 2026");
    expect(rowValue("تاريخ الانضمام")).toContain("10 يناير 2026");
    expect(rowValue("تاريخ الانضمام")).toContain("10:30");
    expect(screen.queryByText("DAILY")).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("renders the Owner view of an hourly, suspended worker with the hourly rate and LTR money", async () => {
    withGetWorker(async () => OWNER_WORKERS[1]);
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Samir Haddad" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى قائمة العمال" }).getAttribute("href")).toBe("/workers");
    expect(screen.getByRole("heading", { name: "الملف الشخصي" })).toBeTruthy();
    expect(rowValue("الحالة")).toBe("موقوف");
    expect(rowValue("الدور")).toBe("عامل");
    expect(rowValue("نوع الأجر")).toBe("أجر الساعة");
    expect(rowValue("أجر الساعة")).toBe("₪ 1,234.50");
    expect(screen.getByText("₪ 1,234.50").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // An hourly worker has no daily-rate row.
    expect(screen.queryByText("أجر اليوم", { selector: "dt" })).toBeNull();
    expect(rowValue("أجر الساعات الإضافية")).toBe("₪ 75.25 للساعة");
    expect(rowValue("يسري من")).toBe("1 فبراير 2026");
    expect(screen.queryByText("HOURLY")).toBeNull();
    expect(screen.queryByText("SUSPENDED")).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("never shows compensation to a Field Manager (the API omits it) and explains why", async () => {
    withGetWorker(async () => MANAGER_WORKERS[0]);
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByText("لا تظهر بيانات أجر لهذا العامل.")).toBeTruthy();
    expect(screen.queryByText("نوع الأجر")).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("explains that compensation may be hidden by role for a worker who is not active", async () => {
    withGetWorker(async () => MANAGER_WORKERS[1]);
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByText("صلاحياتك لا تسمح بعرض الأجر، أو لا يوجد أجر مسجّل لهذا العامل.")).toBeTruthy();
    expect(screen.queryByText("لا تظهر بيانات أجر لهذا العامل.")).toBeNull();
    expect(screen.queryByText("نوع الأجر")).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows a translated error with a working retry", async () => {
    const getWorker = withGetWorker(async () => OWNER_WORKERS[0]);
    getWorker.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Internal server error")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Eli Ramzani" })).toBeTruthy();
    expect(getWorker).toHaveBeenCalledTimes(2);
  });

  it("shows access denied on 403", async () => {
    withGetWorker(async () => {
      throw apiError(403, "FORBIDDEN");
    });
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
  });

  it("shows a not-found state on 404 instead of the API's English message", async () => {
    withGetWorker(async () => {
      throw apiError(404, "NOT_FOUND", "Worker not found");
    });
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByText("غير موجود")).toBeTruthy();
    expect(screen.getByText("لم نعثر على هذا العامل. ربما تمت إزالته.")).toBeTruthy();
    expect(screen.queryByText("Worker not found")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "العودة إلى قائمة العمال" }).getAttribute("href")).toBe("/workers");
  });
});
