import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type AuditLogEntry } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import AuditLogPage from "../page";

const mocks = vi.hoisted(() => ({
  auth: { session: null as unknown, client: null as unknown },
  replace: vi.fn(),
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/audit-log",
}));

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: "a1",
    organizationId: "o1",
    actorUserId: "u1",
    action: "TIME_ENTRY_APPROVED",
    entityType: "TimeEntry",
    entityId: "3f2b9c1d-aaaa-bbbb-cccc-1234567890ab",
    field: null,
    oldValue: null,
    newValue: null,
    reason: null,
    note: null,
    correlationId: "c1",
    createdAt: "2026-01-15T08:30:00.000Z",
    ...overrides,
  };
}

const ENTRIES: AuditLogEntry[] = [
  entry({ id: "a1" }),
  entry({ id: "a2", action: "MANUAL_TIME_CORRECTION", reason: "FORGOTTEN_CLOCK_OUT", entityId: "9e8d7c6b-0000-1111-2222-333344445555" }),
  entry({ id: "a3", action: "FULL_DAY_CREDIT_APPLIED", reason: "Pump failure on site", entityId: "1a1a1a1a-0000-1111-2222-333344445555" }),
  entry({ id: "a4", action: "SOMETHING_NEW_FROM_API", entityType: "BrandNewEntity", entityId: "2b2b2b2b-0000-1111-2222-333344445555" }),
];

function apiError(status: number, code: string) {
  return new ApiRequestError(status, { statusCode: status, code, message: `API says ${code}`, details: {}, correlationId: "c" });
}

function setup(role: OrgRole, overrides: Partial<Record<"listAuditLogs" | "verifyAuditChain", ReturnType<typeof vi.fn>>> = {}) {
  const client = {
    listAuditLogs: vi.fn(async () => ({ items: ENTRIES, nextCursor: null })),
    verifyAuditChain: vi.fn(async () => ({ valid: true })),
    ...overrides,
  };
  mocks.auth = {
    client,
    session: { accessToken: "a", refreshToken: "r", organizationId: "o1", role, workerProfileId: null },
  };
  return client;
}

function renderPage() {
  return renderWithIntl(<AuditLogPage />, { queryClient: true });
}

describe("Audit log page", () => {
  beforeEach(() => {
    mocks.replace.mockClear();
  });

  it("renders the events with translated actions, entities and reasons", async () => {
    setup(OrgRole.OWNER);
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "سجل التدقيق" })).toBeTruthy();
    const table = await screen.findByRole("table", { name: "أحداث سجل التدقيق" });
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["الإجراء", "العنصر", "السبب", "التاريخ والوقت"]);
    for (const th of within(table).getAllByRole("columnheader")) {
      expect(th.className).toContain("text-start");
      expect(th.getAttribute("scope")).toBe("col");
    }

    expect(within(table).getByText("الموافقة على سجل حضور")).toBeTruthy();
    expect(within(table).getByText("تصحيح يدوي للوقت")).toBeTruthy();
    expect(within(table).getAllByText("سجل حضور").length).toBeGreaterThan(0);
    // CorrectionReason codes are translated; free text typed by a person is shown as written.
    expect(within(table).getByText("نسيان تسجيل إنهاء الدوام")).toBeTruthy();
    expect(within(table).getByText("Pump failure on site")).toBeTruthy();
    expect(within(table).queryByText("FORGOTTEN_CLOCK_OUT")).toBeNull();
    // Short entity id is a left-to-right isolate, with the full id on hover.
    const shortId = within(table).getByText("3f2b9c1d…", { selector: "bdi" });
    expect(shortId.getAttribute("dir")).toBe("ltr");
    expect(shortId.parentElement?.getAttribute("title")).toBe("المعرّف الكامل: 3f2b9c1d-aaaa-bbbb-cccc-1234567890ab");
    // Date and time in Asia/Jerusalem, Western digits.
    expect(within(table).getAllByText("15 يناير 2026 في 10:30").length).toBe(4);
    expect(document.body.textContent).not.toMatch(/[٠-٩۰-۹]/);
    expect(screen.getByRole("button", { name: "التحقق من سلامة السجل" })).toBeTruthy();
  });

  it("shows the old English default reasons the web used to send in today's Arabic wording", async () => {
    setup(OrgRole.OWNER, {
      listAuditLogs: vi.fn(async () => ({
        items: [
          entry({ id: "l1", action: "WORKER_APPROVED", reason: "Initial onboarding approval" }),
          entry({ id: "l2", action: "WORKER_REJECTED", reason: "Rejected during admin review." }),
          entry({ id: "l3", action: "PAYROLL_PERIOD_REOPENED", reason: "Correction needed after review" }),
          entry({ id: "l4", action: "TIME_ENTRY_REJECTED", reason: "Rejected during review." }),
          entry({ id: "l5", action: "FULL_DAY_CREDIT_APPLIED", reason: "Weather stopped work" }),
        ],
        nextCursor: null,
      })),
    });
    renderPage();
    const table = await screen.findByRole("table", { name: "أحداث سجل التدقيق" });
    for (const arabic of [
      "موافقة أولية عند الانضمام",
      "تم الرفض أثناء مراجعة الإدارة.",
      "يلزم تصحيح بعد المراجعة",
      "تم الرفض بعد المراجعة.",
      "توقّف العمل بسبب الطقس",
    ]) {
      expect(within(table).getByText(arabic)).toBeTruthy();
    }
    expect(table.textContent).not.toMatch(/Initial onboarding|admin review|Correction needed|during review|Weather/);
  });

  it("translates API error codes stored as a reason (e.g. a rejected offline sync)", async () => {
    setup(OrgRole.OWNER, {
      listAuditLogs: vi.fn(async () => ({
        items: [
          entry({ id: "e1", action: "OFFLINE_EVENT_REJECTED", reason: "INVALID_OFFLINE_SIGNATURE" }),
          entry({ id: "e2", action: "OFFLINE_EVENT_REJECTED", reason: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS" }),
        ],
        nextCursor: null,
      })),
    });
    renderPage();
    const table = await screen.findByRole("table", { name: "أحداث سجل التدقيق" });
    expect(within(table).getByText("تعذّر التحقق من التسجيل الذي تمّ دون اتصال.")).toBeTruthy();
    // No details are stored with the reason, so the wording without placeholders is used.
    expect(within(table).getByText("موقعك الحالي خارج نطاق الموقع المسموح به.")).toBeTruthy();
    expect(within(table).queryByText("INVALID_OFFLINE_SIGNATURE")).toBeNull();
  });

  it("shows an unknown action code and entity type as-is, left to right", async () => {
    setup(OrgRole.OWNER);
    renderPage();
    const code = await screen.findByText("SOMETHING_NEW_FROM_API");
    expect(code.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("BrandNewEntity").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("shows the empty state", async () => {
    setup(OrgRole.OWNER, { listAuditLogs: vi.fn(async () => ({ items: [], nextCursor: null })) });
    renderPage();
    expect(await screen.findByText("لا توجد أحداث في السجل بعد")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows a translated error and retries", async () => {
    const listAuditLogs = vi.fn().mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR")).mockResolvedValue({ items: ENTRIES, nextCursor: null });
    setup(OrgRole.OWNER, { listAuditLogs });
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    expect(alert.textContent).not.toContain("API says");
    fireEvent.click(within(alert).getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(listAuditLogs).toHaveBeenCalledTimes(2);
  });

  it("shows access denied when the API answers 403", async () => {
    setup(OrgRole.OWNER, { listAuditLogs: vi.fn().mockRejectedValue(apiError(403, "FORBIDDEN")) });
    renderPage();
    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("never renders or loads the audit log for a Field Manager and redirects to the dashboard", async () => {
    const client = setup(OrgRole.FIELD_MANAGER);
    renderPage();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByRole("heading", { name: "سجل التدقيق" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(client.listAuditLogs).not.toHaveBeenCalled();
  });

  it("verifies the chain: pending label, then the valid result", async () => {
    let resolveVerify: (value: { valid: boolean }) => void = () => {};
    const verifyAuditChain = vi.fn(() => new Promise<{ valid: boolean }>((resolve) => (resolveVerify = resolve)));
    setup(OrgRole.OWNER, { verifyAuditChain });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "التحقق من سلامة السجل" }));
    const pending = await screen.findByRole("button", { name: "جارٍ التحقق…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    resolveVerify({ valid: true });
    expect(await screen.findByText("السجل سليم — لم يُكتشف أي تلاعب")).toBeTruthy();
    expect((screen.getByRole("button", { name: "التحقق من سلامة السجل" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("verifies the chain: broken result names the event id left to right", async () => {
    setup(OrgRole.OWNER, { verifyAuditChain: vi.fn(async () => ({ valid: false, brokenAtId: "a2-broken-id" })) });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "التحقق من سلامة السجل" }));
    const id = await screen.findByText("a2-broken-id");
    expect(id.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(id.parentElement?.textContent).toBe("السجل غير سليم — يوجد خلل عند الحدث a2-broken-id");
  });

  it("verifies the chain: broken result without an id", async () => {
    setup(OrgRole.OWNER, { verifyAuditChain: vi.fn(async () => ({ valid: false })) });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "التحقق من سلامة السجل" }));
    expect(await screen.findByText("السجل غير سليم — تم اكتشاف خلل في تسلسل الأحداث")).toBeTruthy();
  });

  it("verifies the chain: a failed request shows a translated error", async () => {
    setup(OrgRole.OWNER, { verifyAuditChain: vi.fn().mockRejectedValue(apiError(500, "INTERNAL_ERROR")) });
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "التحقق من سلامة السجل" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("تعذّر التحقق من سلامة السجل");
    expect(alert.textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
  });
});
