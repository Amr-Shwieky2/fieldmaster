import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CreatedInvitation, OnboardingInvitation } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { createIntlWrapper } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits, json, mockApi, requestsTo, seedSession, textOf, type Handler } from "@/test/api-mock";
import InvitationsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/workers/invitations",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <InvitationsPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
}

const OWNER_NAME = "رنا عودة";
const MANAGER_NAME = "خالد منصور";

function invitation(overrides: Partial<OnboardingInvitation> = {}): OnboardingInvitation {
  return {
    id: "inv-active",
    status: "ACTIVE",
    prefilledPhoneNumber: "+972501234567",
    createdAt: "2026-10-12T07:00:00Z",
    createdByName: OWNER_NAME,
    expiresAt: "2026-10-19T07:00:00Z",
    usedAt: null,
    workerProfileId: null,
    workerName: null,
    revokedAt: null,
    revokedByName: null,
    ...overrides,
  };
}
const ACTIVE = invitation();
const USED = invitation({
  id: "inv-used",
  status: "USED",
  prefilledPhoneNumber: null,
  createdAt: "2026-10-10T07:00:00Z",
  createdByName: MANAGER_NAME,
  expiresAt: "2026-10-17T07:00:00Z",
  usedAt: "2026-10-11T12:30:00Z",
  workerProfileId: "wp-9",
  workerName: "نادية خوري",
});
const REVOKED = invitation({
  id: "inv-revoked",
  status: "REVOKED",
  createdAt: "2026-10-05T07:00:00Z",
  revokedAt: "2026-10-06T08:00:00Z",
  revokedByName: OWNER_NAME,
});
const EXPIRED = invitation({
  id: "inv-expired",
  status: "EXPIRED",
  prefilledPhoneNumber: null,
  createdAt: "2026-09-01T07:00:00Z",
  createdByName: null,
  expiresAt: "2026-09-08T07:00:00Z",
});
const INVITATIONS = [EXPIRED, ACTIVE, REVOKED, USED];

const CREATED: CreatedInvitation = { invitationId: "inv-new", token: "tok-abc", joinPath: "/join/tok-abc", expiresAt: "2026-10-20T09:00:00Z" };

function routes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /onboarding-invitations": () => json(200, INVITATIONS),
    "POST /onboarding-invitations": () => json(201, CREATED),
    ...overrides,
  };
}

const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(window.navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });
}

describe("Worker invitations page", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalClipboard) Object.defineProperty(window.navigator, "clipboard", originalClipboard);
    else delete (window.navigator as { clipboard?: unknown }).clipboard;
  });

  it("lists every invitation with its translated status, phone, who created or revoked it and when, and the worker who used it", async () => {
    seedSession(OrgRole.OWNER);
    mockApi(routes());
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "دعوات العمال" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى قائمة العمال" }).getAttribute("href")).toBe("/workers");
    const table = await screen.findByRole("table", { name: "دعوات الانضمام وحالاتها" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["الحالة", "الهاتف المحدَّد", "الإنشاء", "انتهاء الصلاحية", "العامل", "الإجراءات"]);

    // Newest first.
    const rows = within(table).getAllByRole("row").slice(1);
    const cells = rows.map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => textOf(cell)),
    );
    expect(cells[0]).toEqual(["نشطة", "+972501234567", `12 أكتوبر 2026 في 10:00 بواسطة ${OWNER_NAME}`, "19 أكتوبر 2026 في 10:00", "—", "إلغاء الدعوة"]);
    expect(within(rows[0]).getByText("+972501234567").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // When it was used, and (for an Owner) the application it created.
    expect(cells[1].slice(0, 5)).toEqual([
      "مستخدمةاستُخدمت في 11 أكتوبر 2026 في 15:30",
      "—",
      `10 أكتوبر 2026 في 10:00 بواسطة ${MANAGER_NAME}`,
      "17 أكتوبر 2026 في 10:00",
      "مراجعة طلب نادية خوري",
    ]);
    expect(within(rows[1]).getByRole("link", { name: "مراجعة طلب نادية خوري" }).getAttribute("href")).toBe("/workers/wp-9/review");
    // Who revoked it and when.
    expect(cells[2][0]).toBe(`ملغاةأُلغيت في 6 أكتوبر 2026 في 11:00 بواسطة ${OWNER_NAME}`);
    expect(cells[3].slice(0, 5)).toEqual(["منتهية الصلاحية", "—", "1 سبتمبر 2026 في 10:00", "8 سبتمبر 2026 في 10:00", "—"]);
    // Only an active invitation can be revoked.
    for (const row of rows.slice(1)) expect(within(row).queryByRole("button")).toBeNull();
    expect(screen.queryByText("ACTIVE")).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("shows a Field Manager the worker's name without a link to the Owner's review page", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    mockApi(routes({ "GET /onboarding-invitations": () => json(200, [USED]) }));
    renderPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("نادية خوري")).toBeTruthy();
    expect(within(table).queryByRole("link")).toBeNull();
  });

  it("creates an invitation without a phone and shows its full link once, read-only, with its expiry and a copy button", async () => {
    seedSession(OrgRole.OWNER);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    let listCalls = 0;
    const fetchMock = mockApi(
      routes({
        "GET /onboarding-invitations": () => {
          listCalls += 1;
          return json(200, INVITATIONS);
        },
      }),
    );
    renderPage();
    await screen.findByRole("table");

    fireEvent.click(screen.getByRole("button", { name: "إنشاء رابط الدعوة" }));
    const panel = await screen.findByRole("region", { name: "رابط الدعوة جاهز" });
    expect(requestsTo(fetchMock, "POST", "/onboarding-invitations")[0].body).toEqual({});
    const link = within(panel).getByLabelText("رابط الانضمام") as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/join/tok-abc`);
    expect(link.readOnly).toBe(true);
    expect(link.getAttribute("dir")).toBe("ltr");
    expect(within(panel).getByText("يظهر هذا الرابط هذه المرة فقط: يُرجى نسخه الآن وإرساله إلى العامل.")).toBeTruthy();
    expect(textOf(within(panel).getByText(/^تنتهي صلاحية الرابط في/))).toBe("تنتهي صلاحية الرابط في 20 أكتوبر 2026 في 12:00.");
    expect(within(panel).queryByText(/رقم الهاتف المحدَّد/)).toBeNull();
    await waitFor(() => expect(listCalls).toBe(2));

    fireEvent.click(within(panel).getByRole("button", { name: "نسخ الرابط" }));
    expect((await within(panel).findByRole("status")).textContent).toBe("تم النسخ");
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/tok-abc`);
  });

  it("creates an invitation for a phone typed locally, sent in international form", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = mockApi(routes());
    renderPage();

    const phone = screen.getByLabelText("رقم هاتف العامل (اختياري)");
    expect(phone.getAttribute("type")).toBe("tel");
    expect(phone.getAttribute("dir")).toBe("ltr");
    fireEvent.change(phone, { target: { value: "050-123 4567" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء رابط الدعوة" }));

    const panel = await screen.findByRole("region", { name: "رابط الدعوة جاهز" });
    expect(requestsTo(fetchMock, "POST", "/onboarding-invitations")[0].body).toEqual({ prefilledPhoneNumber: "+972501234567" });
    expect(textOf(within(panel).getByText(/^رقم الهاتف المحدَّد/))).toBe("رقم الهاتف المحدَّد: +972501234567");
    expect((phone as HTMLInputElement).value).toBe("");
  });

  it("refuses a phone number that is not valid, in Arabic, before any request", async () => {
    seedSession(OrgRole.OWNER);
    const fetchMock = mockApi(routes());
    renderPage();

    const phone = screen.getByLabelText("رقم هاتف العامل (اختياري)");
    fireEvent.change(phone, { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء رابط الدعوة" }));

    const error = await screen.findByRole("alert");
    expect(textOf(error)).toBe("رقم الهاتف غير صالح. المقبول رقم محلي مثل 050-1234567 أو رقم دولي يبدأ بـ +972.");
    expect(phone.getAttribute("aria-invalid")).toBe("true");
    expect(phone.getAttribute("aria-describedby")).toContain(error.id);
    expect(document.activeElement).toBe(phone);
    expect(requestsTo(fetchMock, "POST", "/onboarding-invitations")).toEqual([]);
  });

  it("selects the link for a manual copy when the clipboard is not available", async () => {
    seedSession(OrgRole.OWNER);
    stubClipboard(undefined);
    mockApi(routes());
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "إنشاء رابط الدعوة" }));
    const panel = await screen.findByRole("region", { name: "رابط الدعوة جاهز" });
    fireEvent.click(within(panel).getByRole("button", { name: "نسخ الرابط" }));
    expect((await within(panel).findByRole("status")).textContent).toBe("تعذّر النسخ التلقائي، والرابط محدَّد الآن: يُرجى نسخه يدويًا.");
    const link = within(panel).getByLabelText("رابط الانضمام") as HTMLInputElement;
    expect(document.activeElement).toBe(link);
    expect([link.selectionStart, link.selectionEnd]).toEqual([0, link.value.length]);
  });

  it("shows a translated error when the invitation cannot be created", async () => {
    seedSession(OrgRole.OWNER);
    mockApi(routes({ "POST /onboarding-invitations": () => apiError(429, "RATE_LIMITED", "Too many requests") }));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "إنشاء رابط الدعوة" }));
    expect((await screen.findByRole("alert")).textContent).toBe("تعذّر إنشاء الدعوة: عدد الطلبات كبير جدًا. انتظر قليلًا ثم حاول مرة أخرى.");
    expect(screen.queryByRole("region", { name: "رابط الدعوة جاهز" })).toBeNull();
  });

  it("revokes an active invitation after a confirmation", async () => {
    seedSession(OrgRole.OWNER);
    let revoked = false;
    const fetchMock = mockApi(
      routes({
        "GET /onboarding-invitations": () =>
          json(200, revoked ? [{ ...ACTIVE, status: "REVOKED", revokedAt: "2026-10-13T09:00:00Z", revokedByName: OWNER_NAME }] : [ACTIVE]),
        "DELETE /onboarding-invitations/inv-active": () => {
          revoked = true;
          return json(200, { success: true });
        },
      }),
    );
    renderPage();

    const revoke = await screen.findByRole("button", { name: "إلغاء الدعوة المنشأة في 12 أكتوبر 2026 في 10:00" });
    expect(revoke.textContent).toBe("إلغاء الدعوة");
    fireEvent.click(revoke);
    expect(revoke.getAttribute("aria-expanded")).toBe("true");
    const confirm = screen.getByRole("group", { name: "إلغاء هذه الدعوة؟ سيتوقف رابطها عن العمل فورًا." });
    expect(revoke.getAttribute("aria-controls")).toBe(confirm.id);
    // Keeping it closes the confirmation without a request.
    fireEvent.click(within(confirm).getByRole("button", { name: "إبقاء الدعوة" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(requestsTo(fetchMock, "DELETE", "/onboarding-invitations/inv-active")).toEqual([]);

    fireEvent.click(revoke);
    fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: "تأكيد الإلغاء" }));
    expect((await screen.findByRole("status")).textContent).toBe("أُلغيت الدعوة، ولم يعد رابطها يعمل.");
    expect(requestsTo(fetchMock, "DELETE", "/onboarding-invitations/inv-active")).toHaveLength(1);
    expect(await screen.findByText("ملغاة")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^إلغاء الدعوة/ })).toBeNull();
  });

  it("explains a 409 when the invitation was used meanwhile, and refreshes the list", async () => {
    seedSession(OrgRole.OWNER);
    let used = false;
    mockApi(
      routes({
        "GET /onboarding-invitations": () => json(200, [used ? { ...USED, id: "inv-active" } : ACTIVE]),
        "DELETE /onboarding-invitations/inv-active": () => {
          used = true;
          return apiError(409, "INVITATION_ALREADY_USED", "Invitation already used");
        },
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^إلغاء الدعوة المنشأة/ }));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الإلغاء" }));
    expect((await screen.findByRole("alert")).textContent).toBe("تعذّر إلغاء الدعوة: استُخدمت هذه الدعوة، فلا يمكن إلغاؤها.");
    expect(screen.queryByText("Invitation already used")).toBeNull();
    expect(await screen.findByText("مستخدمة")).toBeTruthy();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows the empty state, and a translated error with retry", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    mockApi(routes({ "GET /onboarding-invitations": () => (++calls === 1 ? apiError(503, "SERVICE_UNAVAILABLE") : json(200, [])) }));
    renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("لا توجد دعوات بعد")).toBeTruthy();
    expect(screen.getByText("أنشئ رابط دعوة في الأعلى وأرسله إلى العامل.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
