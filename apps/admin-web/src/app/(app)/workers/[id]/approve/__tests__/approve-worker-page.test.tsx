import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ApproveWorkerPage from "../page";
import { apiError, renderWorkersPage } from "../../../__tests__/workers-test-utils";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/workers/w-pending/approve",
  useParams: () => ({ id: "w-pending" }),
  useSearchParams: () => new URLSearchParams(),
}));

const auth = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ client: auth.client, session: null, isAuthenticated: true, isReady: true, login: () => {}, logout: () => {} }),
}));

function setClient(overrides: { approveWorker?: ReturnType<typeof vi.fn>; rejectWorker?: ReturnType<typeof vi.fn> } = {}) {
  const client = {
    approveWorker: overrides.approveWorker ?? vi.fn().mockResolvedValue({}),
    rejectWorker: overrides.rejectWorker ?? vi.fn().mockResolvedValue({}),
  };
  auth.client = client;
  return client;
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Approve worker page", () => {
  beforeEach(() => {
    nav.replace.mockClear();
    auth.client = {};
  });

  it("renders the approval form with LTR amount inputs", () => {
    setClient();
    renderWorkersPage(<ApproveWorkerPage />);

    expect(screen.getByRole("heading", { level: 1, name: "الموافقة على العامل" })).toBeTruthy();
    expect(screen.getByText("حدّد الأجر لتفعيل حساب هذا العامل.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى قائمة العمال" }).getAttribute("href")).toBe("/workers");
    const type = screen.getByLabelText("نوع الأجر") as HTMLSelectElement;
    expect([...type.options].map((o) => o.textContent)).toEqual(["أجر اليوم", "أجر الساعة"]);
    const daily = screen.getByLabelText("أجر اليوم (بالشيكل)");
    expect(daily.getAttribute("dir")).toBe("ltr");
    expect(screen.getByLabelText("أجر الساعات الإضافية (بالشيكل للساعة)").getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("أدخل المبالغ بالشيكل، مثل 400 أو 45.50.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "الموافقة على العامل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "رفض" })).toBeTruthy();
  });

  it("sends a daily rate entered in shekels as integer agorot, then returns to the list", async () => {
    const client = setClient();
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.change(screen.getByLabelText("أجر اليوم (بالشيكل)"), { target: { value: "450.5" } });
    fireEvent.change(screen.getByLabelText("أجر الساعات الإضافية (بالشيكل للساعة)"), { target: { value: "62.25" } });
    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
    expect(client.approveWorker).toHaveBeenCalledTimes(1);
    const [id, body] = client.approveWorker.mock.calls[0];
    expect(id).toBe("w-pending");
    expect(body).toEqual({
      compensationType: "DAILY",
      dailyBaseRateAgorot: 45050,
      baseHourlyRateAgorot: undefined,
      overtimeHourlyRateAgorot: 6225,
      effectiveStartDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      changeReason: "موافقة أولية عند الانضمام",
    });
    expect(screen.getByRole("status").textContent).toBe("تمت الموافقة على العامل.");
  });

  it("sends an hourly rate as integer agorot when hourly is chosen", async () => {
    const client = setClient();
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.change(screen.getByLabelText("نوع الأجر"), { target: { value: "HOURLY" } });
    expect(screen.queryByLabelText("أجر اليوم (بالشيكل)")).toBeNull();
    const hourly = screen.getByLabelText("أجر الساعة (بالشيكل)");
    expect(hourly.getAttribute("dir")).toBe("ltr");
    fireEvent.change(hourly, { target: { value: "52.5" } });
    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));

    await waitFor(() => expect(client.approveWorker).toHaveBeenCalledTimes(1));
    const [id, body] = client.approveWorker.mock.calls[0];
    expect(id).toBe("w-pending");
    expect(body).toEqual({
      compensationType: "HOURLY",
      dailyBaseRateAgorot: undefined,
      baseHourlyRateAgorot: 5250,
      overtimeHourlyRateAgorot: 6000,
      effectiveStartDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      changeReason: "موافقة أولية عند الانضمام",
    });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
  });

  it("disables both actions and shows a pending label while approving", async () => {
    const pending = deferred();
    setClient({ approveWorker: vi.fn().mockReturnValue(pending.promise) });
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    const approving = await screen.findByRole("button", { name: "جارٍ الموافقة…" });
    expect((approving as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "رفض" }) as HTMLButtonElement).disabled).toBe(true);
    pending.resolve({});
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
  });

  it("shows a translated 403 (for example a Field Manager approving compensation) and stays on the page", async () => {
    setClient({ approveWorker: vi.fn().mockRejectedValue(apiError(403, "FORBIDDEN", "Missing permission MANAGE_COMPENSATION")) });
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّرت الموافقة على العامل.");
    expect(alert.textContent).toContain("ليست لديك صلاحية لتنفيذ هذا الإجراء.");
    expect(alert.textContent).not.toContain("MANAGE_COMPENSATION");
    expect(nav.replace).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "الموافقة على العامل" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the generic Arabic message, never the API's English message, for an unknown error code", async () => {
    setClient({ approveWorker: vi.fn().mockRejectedValue(apiError(422, "SOME_NEW_CODE", "Effective date is in a closed period")) });
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّرت الموافقة على العامل.");
    // 422 has no status-level message, so the unknown-error text is shown.
    expect(alert.textContent).toContain("حدث خطأ غير متوقع. يُرجى المحاولة مرة أخرى.");
    expect(alert.textContent).not.toContain("Effective date is in a closed period");
    expect(alert.textContent).not.toContain("SOME_NEW_CODE");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("translates a known API error such as an overlapping compensation profile", async () => {
    setClient({ approveWorker: vi.fn().mockRejectedValue(apiError(409, "OVERLAPPING_COMPENSATION_PROFILE", "overlap")) });
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    expect((await screen.findByRole("alert")).textContent).toContain("تتداخل فترة هذا الأجر مع فترة أجر أخرى لنفس العامل.");
  });

  it("rejects with the review reason and returns to the list", async () => {
    const client = setClient();
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.click(screen.getByRole("button", { name: "رفض" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
    expect(client.rejectWorker).toHaveBeenCalledWith("w-pending", "تم الرفض أثناء مراجعة الإدارة.");
    expect(client.approveWorker).not.toHaveBeenCalled();
  });

  it("shows a translated error when rejecting fails", async () => {
    setClient({ rejectWorker: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    renderWorkersPage(<ApproveWorkerPage />);

    fireEvent.click(screen.getByRole("button", { name: "رفض" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر رفض طلب العامل.");
    expect(alert.textContent).toContain("تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.");
    expect(alert.textContent).not.toContain("Failed to fetch");
    expect(nav.replace).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "رفض" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
