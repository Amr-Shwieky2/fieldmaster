import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DevLoginUser } from "@fieldmaster/api-client";
import { AuthProvider } from "@/lib/auth-context";
import { createIntlWrapper } from "@/test/render-with-intl";
import ar from "@/i18n/messages/ar.json";
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

/** The API is not in dev login mode (404) and answers the OTP request with `otpResponse`. */
function mockOtpFailure(otpResponse: { status: number; body: unknown }) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/auth/dev/users")
      ? new Response(JSON.stringify({ statusCode: 404, code: "NOT_FOUND", message: "x", details: {}, correlationId: "c" }), { status: 404 })
      : new Response(JSON.stringify(otpResponse.body), { status: otpResponse.status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
}

function requestCode(phoneNumber: string) {
  fireEvent.change(screen.getByLabelText(ar.auth.phoneLabel), { target: { value: phoneNumber } });
  fireEvent.click(screen.getByRole("button", { name: ar.auth.sendCode }));
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
    expect(screen.queryByText(ar.devLogin.bannerTitle)).toBeNull();
    expect(screen.queryByText(ar.devLogin.quickLoginTitle)).toBeNull();
    expect(screen.queryByRole("heading", { name: new RegExp(ar.devLogin.groupOwners) })).toBeNull();

    requestCode("+972500000001");
    await waitFor(() => expect(screen.getByLabelText(ar.auth.codeLabel)).toBeTruthy());
    // No fixed-code hint ("وضع الاختبار — الرمز: 123456") outside test mode.
    expect(document.getElementById("code-hint")).toBeNull();
    expect(screen.getByLabelText(ar.auth.codeLabel).getAttribute("aria-describedby")).toBeNull();
    expect(screen.queryByText(/الرمز:/)).toBeNull();
    expect(screen.queryByText("123456")).toBeNull();
    // The phone number the code was sent to stays left-to-right inside the Arabic sentence.
    expect(screen.getByText("+972500000001").closest("bdi")?.getAttribute("dir")).toBe("ltr");
  });

  it("shows the banner and the users grouped by role in dev login mode, and the code hint after requesting a code", async () => {
    mockApi(true);
    renderLogin();
    await waitFor(() => expect(screen.getByText(ar.devLogin.bannerTitle)).toBeTruthy());
    expect(screen.getByText(ar.devLogin.quickLoginTitle)).toBeTruthy();
    // One user per role; the count is in Western digits.
    expect(screen.getByRole("heading", { name: `${ar.devLogin.groupOwners} (1)` })).toBeTruthy();
    expect(screen.getByRole("heading", { name: `${ar.devLogin.groupFieldManagers} (1)` })).toBeTruthy();
    expect(screen.getByRole("heading", { name: `${ar.devLogin.groupWorkers} (1)` })).toBeTruthy();

    requestCode("+972500000001");
    await waitFor(() => expect(screen.getByText("123456")).toBeTruthy());
    expect(document.getElementById("code-hint")?.textContent).toBe(ar.auth.testModeCodeHint.replace("<code></code>", "123456"));
    expect(screen.getByText("123456").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByLabelText(ar.auth.codeLabel).getAttribute("aria-describedby")).toBe("code-hint");
  });

  it("one click signs in through POST /auth/dev/login and goes to the dashboard", async () => {
    const fetchMock = mockApi(true);
    renderLogin();
    const button = await screen.findByRole("button", { name: "تسجيل الدخول باسم Yossi Manager (مدير ميدان)" });
    fireEvent.click(button);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auth/dev/login"));
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ membershipId: "m-fm", deviceId: "admin-web", platform: "WEB" });
    expect(sessionStore.load()?.role).toBe("FIELD_MANAGER");
  });

  it("renders the login page, banner and quick-login list in Arabic with no language switcher", async () => {
    mockApi(true);
    renderLogin();
    await waitFor(() => expect(screen.getByText("وضع الاختبار — تسجيل الدخول بدون رسالة SMS")).toBeTruthy());
    expect(screen.getByText("تسجيل الدخول إلى لوحة الإدارة")).toBeTruthy();
    expect(screen.getByLabelText("رقم الهاتف")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إرسال رمز التحقق" })).toBeTruthy();
    expect(screen.getByText("تسجيل دخول تجريبي سريع")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /المالكون/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /مدراء الميدان/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /العمال/ })).toBeTruthy();
    // Role names come from the glossary.
    expect(screen.getByRole("button", { name: "تسجيل الدخول باسم Dana Owner-Levi (المالك)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "تسجيل الدخول باسم Yossi Manager (مدير ميدان)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "تسجيل الدخول باسم Eli Ramzani (عامل)" })).toBeTruthy();
    // The phone number stays left-to-right inside the Arabic text.
    expect(screen.getByText("+972500000011").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // The app is Arabic only: there is no language switch on the login page.
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
    expect(screen.queryByRole("button", { name: "العربية" })).toBeNull();
    expect(screen.queryByRole("group", { name: "اللغة" })).toBeNull();
  });

  it("translates API errors on the login page", async () => {
    mockOtpFailure({
      status: 429,
      body: { statusCode: 429, code: "OTP_RATE_LIMITED", message: "Too many verification codes requested.", details: {}, correlationId: "c" },
    });
    renderLogin();
    requestCode("+972500000001");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("تم طلب عدد كبير من رموز التحقق. حاول مرة أخرى لاحقًا."));
  });

  it("shows the Arabic status-level message, never the API's English message, for an error code it does not know", async () => {
    mockOtpFailure({
      status: 400,
      body: { statusCode: 400, code: "PHONE_NUMBER_NOT_E164", message: "phoneNumber must be a valid E.164 phone number", details: {}, correlationId: "c" },
    });
    renderLogin();
    requestCode("0501234567");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(ar.errors.VALIDATION_FAILED));
    expect(screen.queryByText(/E\.164/)).toBeNull();
    // The user stays on the phone step and can correct the number.
    expect(screen.getByLabelText(ar.auth.phoneLabel)).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("checks empty fields itself and shows Arabic messages instead of the browser's own bubble", async () => {
    const fetchMock = mockOtpFailure({ status: 204, body: null });
    renderLogin();
    const phone = screen.getByLabelText(ar.auth.phoneLabel);
    expect(phone.closest("form")?.noValidate).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: ar.auth.sendCode }));
    expect(screen.getByRole("alert").textContent).toBe(ar.auth.phoneRequired);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/otp/request"))).toBe(false);

    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/auth/dev/users")
        ? new Response(JSON.stringify({ statusCode: 404, code: "NOT_FOUND", message: "x", details: {}, correlationId: "c" }), { status: 404 })
        : new Response(null, { status: 204 }),
    );
    requestCode("+972500000001");
    const code = await screen.findByLabelText(ar.auth.codeLabel);
    expect(code.closest("form")?.noValidate).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: ar.auth.verify }));
    expect(screen.getByRole("alert").textContent).toBe(ar.auth.codeRequired);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/otp/verify"))).toBe(false);
  });
});
