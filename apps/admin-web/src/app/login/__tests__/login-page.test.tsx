import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DevLoginUser } from "@fieldmaster/api-client";
import { AuthProvider } from "@/lib/auth-context";
import { NextIntlClientProvider } from "next-intl";
import { createIntlWrapper, getTestMessages } from "@/test/render-with-intl";
import { BUSINESS_TIME_ZONE, INTL_LOCALE, type Locale } from "@/i18n/config";
import en from "@/i18n/messages/en.json";
import { sessionStore } from "@/lib/session-store";
import LoginPage from "../page";

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: vi.fn() }),
}));

const DEV_USERS: DevLoginUser[] = [
  { membershipId: "m-owner", userId: "u1", fullLegalName: "Dana Owner-Levi", preferredName: "Dana", phoneNumber: "+972500000001", role: "OWNER", organizationId: "o1", organizationName: "Demo" },
  { membershipId: "m-fm", userId: "u2", fullLegalName: "Yossi Manager", preferredName: null, phoneNumber: "+972500000011", role: "FIELD_MANAGER", organizationId: "o1", organizationName: "Demo" },
  { membershipId: "m-worker", userId: "u3", fullLegalName: "Eli Ramzani", preferredName: null, phoneNumber: "+972500010001", role: "WORKER", organizationId: "o1", organizationName: "Demo" },
];

const SESSION = { accessToken: "header.eyJ3b3JrZXJQcm9maWxlSWQiOm51bGx9.sig", refreshToken: "fam:secret", expiresIn: 900, organizationId: "o1", role: "FIELD_MANAGER" };

function jsonResponse(status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockApi(devMode: boolean) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.endsWith("/auth/dev/users") && method === "GET") {
      return devMode ? jsonResponse(200, DEV_USERS) : jsonResponse(404, { statusCode: 404, code: "NOT_FOUND", message: "Cannot GET /api/v1/auth/dev/users", details: {}, correlationId: "c" });
    }
    if (url.endsWith("/auth/dev/login") && method === "POST") return jsonResponse(201, SESSION);
    if (url.endsWith("/auth/otp/request")) return jsonResponse(204, null);
    return jsonResponse(500, { statusCode: 500, code: "INTERNAL_ERROR", message: "unexpected", details: {}, correlationId: "c" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderLogin(locale: Locale = "en") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper({ locale }) },
  );
}

describe("Login page test-mode options", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides the banner, quick login and code hint when the API is not in dev login mode (404)", async () => {
    const fetchMock = mockApi(false);
    renderLogin();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/auth/dev/users"), expect.anything()));
    // Give the query a tick to settle, then assert nothing test-related rendered.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("TEST MODE — login without SMS")).toBeNull();
    expect(screen.queryByText("Quick test login")).toBeNull();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+972500000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeTruthy());
    expect(screen.queryByText(/code:/)).toBeNull();
  });

  it("shows the banner and the users grouped by role in dev login mode, and the code hint after requesting a code", async () => {
    mockApi(true);
    renderLogin();
    await waitFor(() => expect(screen.getByText("TEST MODE — login without SMS")).toBeTruthy());
    expect(screen.getByText("Quick test login")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Owners/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Field Managers/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Workers/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+972500000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
    await waitFor(() => expect(screen.getByText("123456")).toBeTruthy());
  });

  it("one click signs in through POST /auth/dev/login and goes to the dashboard", async () => {
    const fetchMock = mockApi(true);
    renderLogin();
    const button = await screen.findByRole("button", { name: "Sign in as Yossi Manager (Field Manager)" });
    fireEvent.click(button);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auth/dev/login"));
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ membershipId: "m-fm", deviceId: "admin-web", platform: "WEB" });
    expect(sessionStore.load()?.role).toBe("FIELD_MANAGER");
  });

  it("renders the login page, banner and quick-login list in Arabic", async () => {
    mockApi(true);
    renderLogin("ar");
    await waitFor(() => expect(screen.getByText("وضع الاختبار — تسجيل الدخول بدون رسالة SMS")).toBeTruthy());
    expect(screen.getByText("تسجيل الدخول إلى لوحة الإدارة")).toBeTruthy();
    expect(screen.getByLabelText("رقم الهاتف")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إرسال رمز التحقق" })).toBeTruthy();
    expect(screen.getByText("تسجيل دخول تجريبي سريع")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /المالكون/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /مدراء الميدان/ })).toBeTruthy();
    // Role names come from the glossary.
    expect(screen.getByRole("button", { name: "تسجيل الدخول باسم Yossi Manager (مدير ميدان)" })).toBeTruthy();
    // The phone number stays left-to-right inside the Arabic text.
    expect(screen.getByText("+972500000011").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("translates API errors on the login page (Arabic)", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/auth/dev/users")
        ? new Response(JSON.stringify({ statusCode: 404, code: "NOT_FOUND", message: "x", details: {}, correlationId: "c" }), { status: 404 })
        : new Response(JSON.stringify({ statusCode: 429, code: "OTP_RATE_LIMITED", message: "Too many verification codes requested.", details: {}, correlationId: "c" }), { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderLogin("ar");
    fireEvent.change(screen.getByLabelText("رقم الهاتف"), { target: { value: "+972500000001" } });
    fireEvent.click(screen.getByRole("button", { name: "إرسال رمز التحقق" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("تم طلب عدد كبير من رموز التحقق. حاول مرة أخرى لاحقًا."));
  });

  it("shows an error that is already on screen in the new language after switching", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/auth/dev/users")
        ? new Response(JSON.stringify({ statusCode: 404, code: "NOT_FOUND", message: "x", details: {}, correlationId: "c" }), { status: 404 })
        : new Response(JSON.stringify({ statusCode: 429, code: "OTP_RATE_LIMITED", message: "Too many verification codes requested.", details: {}, correlationId: "c" }), { status: 429 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Same tree, only the provider's locale changes, like router.refresh() after a switch: component state survives.
    const tree = (locale: Locale) => (
      <NextIntlClientProvider locale={INTL_LOCALE[locale]} messages={getTestMessages(locale)} timeZone={BUSINESS_TIME_ZONE}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>
    );
    const { rerender } = render(tree("ar"));
    fireEvent.change(screen.getByLabelText("رقم الهاتف"), { target: { value: "+972500000001" } });
    fireEvent.click(screen.getByRole("button", { name: "إرسال رمز التحقق" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("تم طلب عدد كبير من رموز التحقق. حاول مرة أخرى لاحقًا."));

    rerender(tree("en"));
    expect(screen.getByRole("alert").textContent).toBe(en.errors.OTP_RATE_LIMITED);
  });
});
