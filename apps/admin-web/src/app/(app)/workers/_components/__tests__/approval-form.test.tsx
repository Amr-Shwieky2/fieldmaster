import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { WorkerApprovalForm } from "../approval-form";
import { apiError, renderWorkersPage } from "../../__tests__/workers-test-utils";

// Moved from the old /workers/[id]/approve page's tests (Step 8: the form now sits on the Owner's review page).
// Changes: amounts start empty (the compensation must be typed), and rejecting needs a written reason.

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/workers/w-pending/review",
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

/** A valid daily compensation. */
function fillDaily(daily = "400", overtime = "60") {
  fireEvent.change(screen.getByLabelText("أجر اليوم (بالشيكل)"), { target: { value: daily } });
  fireEvent.change(screen.getByLabelText("أجر الساعات الإضافية (بالشيكل للساعة)"), { target: { value: overtime } });
}

function openRejection(reason?: string) {
  fireEvent.click(screen.getByRole("button", { name: "رفض الطلب" }));
  if (reason !== undefined) fireEvent.change(screen.getByLabelText("سبب الرفض"), { target: { value: reason } });
}

describe("Worker approval form", () => {
  beforeEach(() => {
    nav.replace.mockClear();
    auth.client = {};
  });

  it("renders the approval form with LTR amount inputs", () => {
    setClient();
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    expect(screen.getByRole("heading", { name: "الموافقة وتحديد الأجر" })).toBeTruthy();
    expect(screen.getByText("حدّد الأجر لتفعيل حساب هذا العامل.")).toBeTruthy();
    const type = screen.getByLabelText("نوع الأجر") as HTMLSelectElement;
    expect([...type.options].map((o) => o.textContent)).toEqual(["أجر اليوم", "أجر الساعة"]);
    const daily = screen.getByLabelText("أجر اليوم (بالشيكل)") as HTMLInputElement;
    expect(daily.getAttribute("dir")).toBe("ltr");
    expect(daily.getAttribute("inputmode")).toBe("decimal");
    expect(daily.value).toBe("");
    expect(screen.getByLabelText("أجر الساعات الإضافية (بالشيكل للساعة)").getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("أدخل المبالغ بالشيكل، مثل 400 أو 45.50.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "الموافقة على العامل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "رفض الطلب" })).toBeTruthy();
  });

  it("sends a daily rate entered in shekels as integer agorot, then returns to the list", async () => {
    const client = setClient();
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    fillDaily("450.5", "62.25");
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
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    fireEvent.change(screen.getByLabelText("نوع الأجر"), { target: { value: "HOURLY" } });
    expect(screen.queryByLabelText("أجر اليوم (بالشيكل)")).toBeNull();
    const hourly = screen.getByLabelText("أجر الساعة (بالشيكل)");
    expect(hourly.getAttribute("dir")).toBe("ltr");
    fireEvent.change(hourly, { target: { value: "52.5" } });
    fireEvent.change(screen.getByLabelText("أجر الساعات الإضافية (بالشيكل للساعة)"), { target: { value: "60" } });
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

  it("requires a valid compensation before approving: nothing is sent until both amounts are valid", () => {
    const client = setClient();
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    expect(screen.getAllByText("أدخل المبلغ بالشيكل.")).toHaveLength(2);
    fillDaily("0", "1,000");
    expect(screen.getByText("يجب أن يكون المبلغ أكبر من صفر.")).toBeTruthy();
    expect(screen.getByText("أدخل المبلغ بالأرقام فقط، مثل 400 أو 45.50.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    expect(client.approveWorker).not.toHaveBeenCalled();
  });

  it("disables both actions and shows a pending label while approving", async () => {
    const pending = deferred();
    setClient({ approveWorker: vi.fn().mockReturnValue(pending.promise) });
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    fillDaily();
    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    const approving = await screen.findByRole("button", { name: "جارٍ الموافقة…" });
    expect((approving as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "رفض الطلب" }) as HTMLButtonElement).disabled).toBe(true);
    pending.resolve({});
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
  });

  it("shows a translated 403 (for example a Field Manager approving compensation) and stays on the page", async () => {
    setClient({ approveWorker: vi.fn().mockRejectedValue(apiError(403, "FORBIDDEN", "Missing permission MANAGE_COMPENSATION")) });
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    fillDaily();
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
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    fillDaily();
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
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    fillDaily();
    fireEvent.click(screen.getByRole("button", { name: "الموافقة على العامل" }));
    expect((await screen.findByRole("alert")).textContent).toContain("تتداخل فترة هذا الأجر مع فترة أجر أخرى لنفس العامل.");
  });

  it("rejects with the written reason and returns to the list", async () => {
    const client = setClient();
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    openRejection();
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الرفض" }));
    expect((await screen.findByRole("alert")).textContent).toBe("اكتب السبب قبل المتابعة.");
    expect(client.rejectWorker).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("سبب الرفض"), { target: { value: "رقم الهوية لا يطابق الصورة" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الرفض" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
    expect(client.rejectWorker).toHaveBeenCalledWith("w-pending", "رقم الهوية لا يطابق الصورة");
    expect(client.approveWorker).not.toHaveBeenCalled();
  });

  it("shows a translated error when rejecting fails", async () => {
    setClient({ rejectWorker: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) });
    renderWorkersPage(<WorkerApprovalForm workerProfileId="w-pending" />);

    openRejection("مستندات ناقصة");
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الرفض" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر رفض طلب العامل.");
    expect(alert.textContent).toContain("تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.");
    expect(alert.textContent).not.toContain("Failed to fetch");
    expect(nav.replace).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "تأكيد الرفض" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
