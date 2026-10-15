import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole, SystemRoleKey } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { createIntlWrapper } from "@/test/render-with-intl";
import { apiError, json, mockApi, requestsTo, seedSession, type Handler } from "@/test/api-mock";
import { COORDINATOR, RESTRICTED_OWNER, builtInAccess } from "@/test/access-fixtures";
import AppLayout from "../layout";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/dashboard",
}));

const PAGE = "محتوى الصفحة";

function renderShell(me: Handler) {
  const fetchMock = mockApi({ "GET /auth/me": me, "GET /auth/dev/users": () => apiError(404, "NOT_FOUND") });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppLayout>
          <p>{PAGE}</p>
        </AppLayout>
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
  return fetchMock;
}

function menu(): (string | null)[] {
  return within(screen.getByRole("navigation", { name: "القائمة الرئيسية" }))
    .getAllByRole("link")
    .map((link) => link.textContent);
}

beforeEach(() => {
  window.localStorage.clear();
  nav.replace.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Signed-in layout: the member's access", () => {
  it("reads /auth/me after sign-in (on load) and shows nothing until it answers", async () => {
    seedSession(OrgRole.CUSTOM);
    let answer: (response: Response) => void = () => {};
    const fetchMock = renderShell(() => new Promise<Response>((resolve) => (answer = resolve)));

    await waitFor(() => expect(requestsTo(fetchMock, "GET", "/auth/me")).toHaveLength(1));
    expect(screen.getByRole("status").textContent).toBe("جارٍ التحميل…");
    expect(screen.queryByText(PAGE)).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();

    answer(json(200, COORDINATOR));
    expect(await screen.findByText(PAGE)).toBeTruthy();
    expect(menu()).toEqual(["لوحة التحكم", "العمليات المباشرة", "الجدولة", "الحضور", "نسيان التسجيل", "استدعاءات الطوارئ", "التقارير", "الإشعارات", "الإعدادات"]);
    expect(screen.getByText("تم تسجيل الدخول بصفة منسق الحضور")).toBeTruthy();
    expect(screen.queryByText("عرض مقيَّد بمشاريعك")).toBeNull();
    expect(requestsTo(fetchMock, "GET", "/auth/me")).toHaveLength(1);
  });

  it("tells a member restricted to some projects, and leaves the organization-wide entries out", async () => {
    seedSession(OrgRole.OWNER);
    renderShell(() => json(200, RESTRICTED_OWNER));

    expect(await screen.findByText(PAGE)).toBeTruthy();
    expect(screen.getByText("عرض مقيَّد بمشاريعك")).toBeTruthy();
    expect(menu()).not.toContain("الرواتب");
    expect(menu()).not.toContain("المستخدمون والأجهزة");
    expect(menu()).toContain("الإعدادات");
  });

  it("uses the built-in role when the API has no /auth/me", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    renderShell(() => apiError(404, "NOT_FOUND"));

    expect(await screen.findByText(PAGE)).toBeTruthy();
    expect(menu()).toContain("الحضور");
    expect(menu()).not.toContain("الرواتب");
    expect(screen.getByText("تم تسجيل الدخول بصفة مدير ميدان")).toBeTruthy();
  });

  it("cannot show a custom role anything without /auth/me: an error with a retry", async () => {
    seedSession(OrgRole.CUSTOM);
    let me: Handler = () => apiError(503, "SERVICE_UNAVAILABLE");
    const fetchMock = renderShell(() => me(undefined, new URL("http://x")));

    expect(await screen.findByText("تعذّر تحميل صلاحياتك من الخادم، فلا يمكن عرض لوحة الإدارة الآن. حاول مرة أخرى.")).toBeTruthy();
    expect(screen.queryByText(PAGE)).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();

    me = () => json(200, COORDINATOR);
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText(PAGE)).toBeTruthy();
    expect(requestsTo(fetchMock, "GET", "/auth/me")).toHaveLength(2);
  });

  it("keeps the mobile-app notice for the built-in Worker role (as /auth/me tells it)", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    renderShell(() => json(200, builtInAccess(SystemRoleKey.WORKER)));

    expect(await screen.findByRole("heading", { name: "العمال يستخدمون تطبيق الهاتف" })).toBeTruthy();
    expect(screen.queryByText(PAGE)).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("sends a visitor without a session to the login page without asking /auth/me", async () => {
    const fetchMock = renderShell(() => json(200, COORDINATOR));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login"));
    expect(requestsTo(fetchMock, "GET", "/auth/me")).toHaveLength(0);
  });
});
