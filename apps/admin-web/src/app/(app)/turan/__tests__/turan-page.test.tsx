import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type ApiError, type TuranAssignment, type Worker } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";
import TuranPage from "../page";

// ── API mock ────────────────────────────────────────────────────────────
const client = vi.hoisted(() => ({
  listTuranAssignments: vi.fn(),
  listWorkers: vi.fn(),
  createTuranAssignment: vi.fn(),
  cancelTuranAssignment: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client }) }));

function apiError(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  const body: ApiError = { statusCode: status, code, message, details, correlationId: "corr-1" };
  return new ApiRequestError(status, body);
}

const WORKERS = [
  { id: "wp-1", fullLegalName: "Eli Ramzani" },
  { id: "wp-2", fullLegalName: "Samir Haddad" },
] as unknown as Worker[];

const NIGHT: TuranAssignment = {
  id: "ta-1",
  organizationId: "org-1",
  turanType: "NIGHT_TURAN" as TuranAssignment["turanType"],
  status: "SCHEDULED" as TuranAssignment["status"],
  startAt: "2026-10-05T16:00:00.000Z", // 19:00 in Asia/Jerusalem
  endAt: "2026-10-06T04:00:00.000Z", // 07:00
  notes: null,
  assignedWorkerProfileId: "wp-1",
  backupWorkerProfileId: null,
};
const DAY_DONE: TuranAssignment = {
  ...NIGHT,
  id: "ta-2",
  turanType: "DAY_TURAN" as TuranAssignment["turanType"],
  status: "COMPLETED" as TuranAssignment["status"],
  startAt: "2026-10-04T04:00:00.000Z",
  endAt: "2026-10-04T14:00:00.000Z",
  assignedWorkerProfileId: "wp-2",
};

function renderPage() {
  return renderWithIntl(<TuranPage />, { queryClient: true });
}

function rowOf(workerName: string): HTMLElement {
  const row = screen.getByRole("cell", { name: workerName }).closest("tr");
  if (!row) throw new Error(`no row for ${workerName}`);
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.listTuranAssignments.mockResolvedValue([NIGHT, DAY_DONE]);
  client.listWorkers.mockResolvedValue(WORKERS);
  client.createTuranAssignment.mockResolvedValue({ ...NIGHT, id: "ta-new" });
  client.cancelTuranAssignment.mockResolvedValue({});
});

describe("Turan page", () => {
  it("renders the form and the assignments table", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "المناوبات والطوارئ" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "الجدولة" }).getAttribute("href")).toBe("/shifts");
    expect(screen.getByRole("heading", { name: "مناوبة جديدة" })).toBeTruthy();

    // Type options come from the glossary.
    const type = screen.getByLabelText("نوع المناوبة") as HTMLSelectElement;
    expect(within(type).getByRole("option", { name: "مناوبة نهارية" })).toBeTruthy();
    expect(within(type).getByRole("option", { name: "مناوبة ليلية" })).toBeTruthy();

    // Date-time inputs stay left-to-right inside the RTL page.
    expect(screen.getByLabelText("البداية").getAttribute("dir")).toBe("ltr");
    expect(screen.getByLabelText("النهاية").getAttribute("dir")).toBe("ltr");

    await screen.findByRole("cell", { name: "Eli Ramzani" });
    const table = screen.getByRole("table", { name: "قائمة المناوبات النهارية والليلية" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["النوع", "العامل", "البداية", "النهاية", "الحالة", "الإجراءات"]);
    headers.forEach((h) => {
      expect(h.getAttribute("scope")).toBe("col");
      expect(h.className).toContain("text-start");
    });

    const night = within(rowOf("Eli Ramzani"));
    expect(night.getByText("مناوبة ليلية")).toBeTruthy();
    expect(night.getByText("مجدولة")).toBeTruthy();
    expect(night.getByText(/19:00/)).toBeTruthy();
    expect(night.getByRole("button", { name: "إلغاء مناوبة Eli Ramzani" })).toBeTruthy();

    const day = within(rowOf("Samir Haddad"));
    expect(day.getByText("مناوبة نهارية")).toBeTruthy();
    expect(day.getByText("مكتملة")).toBeTruthy();
    expect(day.queryByRole("button")).toBeNull();

    expect(document.body.textContent ?? "").not.toMatch(/[٠-٩۰-۹]/);
    expect(document.body.textContent ?? "").not.toContain("NIGHT_TURAN");
    expect(screen.getByRole("button", { name: "إنشاء المناوبة" })).toBeTruthy();
  });

  it("shows the page-specific empty state", async () => {
    client.listTuranAssignments.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("لا توجد مناوبات بعد")).toBeTruthy();
    expect(screen.getByText("أنشئ مناوبة نهارية أو ليلية من النموذج أعلاه.")).toBeTruthy();
  });

  it("shows a translated error with a working retry", async () => {
    client.listTuranAssignments.mockRejectedValueOnce(apiError(503, "SERVICE_UNAVAILABLE", "Service unavailable"));
    renderPage();
    expect(await screen.findByText("الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("cell", { name: "Eli Ramzani" })).toBeTruthy();
    expect(client.listTuranAssignments).toHaveBeenCalledTimes(2);
  });

  it("shows access denied when the API answers 403", async () => {
    client.listTuranAssignments.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden"));
    renderPage();
    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("creates an assignment with the same payload as before and announces it", async () => {
    renderPage();
    await screen.findByRole("option", { name: "Samir Haddad" });
    const submit = screen.getByRole("button", { name: "إنشاء المناوبة" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-2" } });
    fireEvent.change(screen.getByLabelText("نوع المناوبة"), { target: { value: "DAY_TURAN" } });
    fireEvent.change(screen.getByLabelText("البداية"), { target: { value: "2026-10-06T07:00" } });
    fireEvent.change(screen.getByLabelText("النهاية"), { target: { value: "2026-10-06T15:00" } });
    fireEvent.change(screen.getByLabelText("ملاحظات (اختياري)"), { target: { value: "إشارات شارع يافا" } });
    fireEvent.click(submit);

    await waitFor(() => expect(client.createTuranAssignment).toHaveBeenCalledTimes(1));
    expect(client.createTuranAssignment).toHaveBeenCalledWith({
      turanType: "DAY_TURAN",
      assignedWorkerProfileId: "wp-2",
      startAt: new Date("2026-10-06T07:00").toISOString(),
      endAt: new Date("2026-10-06T15:00").toISOString(),
      notes: "إشارات شارع يافا",
    });
    expect(await screen.findByText("تم إنشاء المناوبة.")).toBeTruthy();
    expect((screen.getByLabelText("العامل") as HTMLSelectElement).value).toBe("");
  });

  it("asks for confirmation on an overlap (409) and resends with confirmOverlap", async () => {
    client.createTuranAssignment.mockRejectedValueOnce(
      apiError(409, "CONFLICT", "This worker already has an overlapping Turan assignment. Set confirmOverlap to proceed anyway.", { conflictingAssignmentId: "ta-1" }),
    );
    renderPage();
    await screen.findByRole("cell", { name: "Eli Ramzani" });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المناوبة" }));

    expect(await screen.findByText("لدى هذا العامل مناوبة أخرى في الوقت نفسه")).toBeTruthy();
    expect(screen.getByText(/تتداخل هذه المناوبة مع مناوبة ليلية من .*19:00.* إلى .*07:00.*\. هل تريد إنشاءها رغم التداخل؟/)).toBeTruthy();
    expect(screen.queryByText(/confirmOverlap/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "نعم، أنشئ المناوبة" }));
    await waitFor(() => expect(client.createTuranAssignment).toHaveBeenCalledTimes(2));
    expect(client.createTuranAssignment.mock.calls[0][0]).not.toHaveProperty("confirmOverlap");
    expect(client.createTuranAssignment.mock.calls[1][0]).toMatchObject({ assignedWorkerProfileId: "wp-1", confirmOverlap: true });
    expect(await screen.findByText("تم إنشاء المناوبة.")).toBeTruthy();
  });

  it("drops the overlap confirmation when the manager cancels it", async () => {
    client.createTuranAssignment.mockRejectedValueOnce(apiError(409, "CONFLICT", "overlap", { conflictingAssignmentId: "unknown-id" }));
    renderPage();
    await screen.findByRole("cell", { name: "Eli Ramzani" });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المناوبة" }));

    // The conflicting assignment is not in the list, so the generic overlap wording is used.
    expect(await screen.findByText("تتداخل هذه المناوبة مع مناوبة أخرى مجدولة للعامل نفسه. هل تريد إنشاءها رغم التداخل؟")).toBeTruthy();
    expect(screen.getByText("لدى هذا العامل مناوبة أخرى في الوقت نفسه")).toBeTruthy();
    expect(screen.queryByText("overlap")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByText("لدى هذا العامل مناوبة أخرى في الوقت نفسه")).toBeNull();
    expect(screen.queryByText("تتداخل هذه المناوبة مع مناوبة أخرى مجدولة للعامل نفسه. هل تريد إنشاءها رغم التداخل؟")).toBeNull();
    expect(screen.getByRole("button", { name: "إنشاء المناوبة" })).toBeTruthy();
    expect(client.createTuranAssignment).toHaveBeenCalledTimes(1);
  });

  it("validates that the end is after the start before calling the API", async () => {
    renderPage();
    await screen.findByRole("option", { name: "Eli Ramzani" });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-1" } });
    fireEvent.change(screen.getByLabelText("البداية"), { target: { value: "2026-10-06T15:00" } });
    fireEvent.change(screen.getByLabelText("النهاية"), { target: { value: "2026-10-06T07:00" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المناوبة" }));
    expect(await screen.findByText("يجب أن يكون وقت النهاية بعد وقت البداية.")).toBeTruthy();
    expect(client.createTuranAssignment).not.toHaveBeenCalled();
  });

  it("shows other create errors translated instead of the API's English message", async () => {
    client.createTuranAssignment.mockRejectedValueOnce(apiError(404, "NOT_FOUND", "Worker not found."));
    renderPage();
    await screen.findByRole("option", { name: "Eli Ramzani" });
    fireEvent.change(screen.getByLabelText("العامل"), { target: { value: "wp-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المناوبة" }));
    const alert = await screen.findByText("لم نتمكن من العثور على العنصر المطلوب.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(screen.queryByText("Worker not found.")).toBeNull();
  });

  it("cancels a scheduled assignment", async () => {
    renderPage();
    await screen.findByRole("cell", { name: "Eli Ramzani" });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء مناوبة Eli Ramzani" }));
    await waitFor(() => expect(client.cancelTuranAssignment).toHaveBeenCalledWith("ta-1"));
    expect(await screen.findByText("تم إلغاء المناوبة.")).toBeTruthy();
  });

  it("shows a translated error when cancelling fails", async () => {
    client.cancelTuranAssignment.mockRejectedValueOnce(apiError(403, "FORBIDDEN", "Forbidden"));
    renderPage();
    await screen.findByRole("cell", { name: "Eli Ramzani" });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء مناوبة Eli Ramzani" }));
    expect(await screen.findByText("ليست لديك صلاحية لتنفيذ هذا الإجراء.")).toBeTruthy();
  });
});
