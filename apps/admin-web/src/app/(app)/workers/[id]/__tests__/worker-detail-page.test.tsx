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

  it("renders the Owner view in Arabic with translated labels, LTR money and Arabic dates in Western digits", async () => {
    const getWorker = withGetWorker(async () => OWNER_WORKERS[0]);
    renderWorkersPage(<WorkerDetailPage />, "ar");

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

  it("renders the Owner view in English", async () => {
    withGetWorker(async () => OWNER_WORKERS[1]);
    renderWorkersPage(<WorkerDetailPage />, "en");

    expect(await screen.findByRole("heading", { level: 1, name: "Samir Haddad" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to workers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(rowValue("Status")).toBe("Suspended");
    expect(rowValue("Role")).toBe("Worker");
    expect(rowValue("Compensation type")).toBe("Hourly rate");
    expect(rowValue("Hourly rate")).toBe("₪ 1,234.50");
    expect(rowValue("Overtime rate")).toBe("₪ 75.25/hr");
    expect(rowValue("Effective from")).toBe("Feb 1, 2026");
  });

  it("never shows compensation to a Field Manager (the API omits it) and explains why", async () => {
    withGetWorker(async () => MANAGER_WORKERS[0]);
    renderWorkersPage(<WorkerDetailPage />, "ar");

    expect(await screen.findByText("لا تظهر بيانات أجر لهذا العامل.")).toBeTruthy();
    expect(screen.queryByText("نوع الأجر")).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("explains that compensation may be hidden by role for a worker who is not active", async () => {
    withGetWorker(async () => MANAGER_WORKERS[1]);
    renderWorkersPage(<WorkerDetailPage />, "en");

    expect(await screen.findByText("Compensation is not visible to your role, or this worker has none on file.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows a translated error with a working retry", async () => {
    const getWorker = withGetWorker(async () => OWNER_WORKERS[0]);
    getWorker.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderWorkersPage(<WorkerDetailPage />, "ar");

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Eli Ramzani" })).toBeTruthy();
    expect(getWorker).toHaveBeenCalledTimes(2);
  });

  it("shows access denied on 403", async () => {
    withGetWorker(async () => {
      throw apiError(403, "FORBIDDEN");
    });
    renderWorkersPage(<WorkerDetailPage />, "ar");

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" })).toBeTruthy();
  });

  it("shows a not-found state on 404", async () => {
    withGetWorker(async () => {
      throw apiError(404, "NOT_FOUND", "Worker not found");
    });
    renderWorkersPage(<WorkerDetailPage />, "en");

    expect(await screen.findByText("Not found")).toBeTruthy();
    expect(screen.getByText("We could not find this worker. It may have been removed.")).toBeTruthy();
    expect(screen.queryByText("Worker not found")).toBeNull();
  });
});
