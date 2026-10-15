import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole, Permission } from "@fieldmaster/shared-types";
import { createIntlWrapper } from "../../test/render-with-intl";
import ar from "../../i18n/messages";
import { apiError, json, mockApi, seedSession, type Handler } from "../../test/api-mock";
import { ACCOUNTANT, COORDINATOR, RESTRICTED_OWNER } from "../../test/access-fixtures";
import { Can, RequirePermission } from "../require-permission";
import { LoadingState } from "../ui/states";
import { AuthProvider, useAuth } from "../../lib/auth-context";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

/** Financial content, as the payroll page would show it. */
const PAYROLL_TOTAL = "إجمالي الصافي: ₪ 50,000.00";

/** Like the signed-in layout: asks for the member's access (GET /auth/me) once the session is read, and shows the page once it answered. */
function Shell({ children }: { children: ReactNode }) {
  const { session, loadAccess, accessStatus } = useAuth();
  useEffect(() => {
    if (session) void loadAccess();
  }, [session, loadAccess]);
  return accessStatus === "ready" || accessStatus === "failed" ? <>{children}</> : <LoadingState />;
}

// AuthProvider clears the React Query cache on login/logout, so it needs a QueryClient above it;
// the loading state is translated, so it also needs the intl provider.
function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>, { wrapper: createIntlWrapper() });
}

const GUARDED_PAYROLL = (
  <RequirePermission permission={[Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL]}>
    <div>{PAYROLL_TOTAL}</div>
  </RequirePermission>
);

/** The payroll pages' guard (VIEW_FINANCIALS with VIEW_PAYROLL) on its own, as the page tests render it: the session's role decides until /auth/me is read. */
function renderGuardedPayroll() {
  const fetchMock = mockApi({});
  render(<AuthProvider>{GUARDED_PAYROLL}</AuthProvider>);
  return fetchMock;
}

/** The same guard inside the signed-in shell, which reads the member's access first. */
function renderGuardedPayrollInShell(me: Handler) {
  const fetchMock = mockApi({ "GET /auth/me": me });
  render(
    <AuthProvider>
      <Shell>{GUARDED_PAYROLL}</Shell>
    </AuthProvider>,
  );
  return fetchMock;
}

/** An API without /auth/me (older versions): the session's built-in role decides. */
const noAccessEndpoint: Handler = () => apiError(404, "NOT_FOUND", "Cannot GET /api/v1/auth/me");

async function expectSentToDashboard() {
  await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
  // The financial content must never have been in the DOM, not merely hidden by CSS.
  expect(screen.queryByText(PAYROLL_TOTAL)).toBeNull();
  expect(document.body.textContent).not.toContain("₪");
  // Only the Arabic loading state is shown while the redirect happens.
  expect(screen.getByRole("status").textContent).toBe(ar.states.loading);
}

describe("RequirePermission (frontend financial-isolation guard)", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders its children for an Owner session", async () => {
    seedSession(OrgRole.OWNER);
    renderGuardedPayroll();

    await waitFor(() => expect(screen.getByText(PAYROLL_TOTAL)).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("never renders its children for a Field Manager session and redirects to /dashboard", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = renderGuardedPayroll();
    await expectSentToDashboard();
    // A built-in role's fixed permissions only shrink at /auth/me: refusing needs no request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never renders its children for a Worker session and redirects to /dashboard", async () => {
    seedSession(OrgRole.WORKER);
    renderGuardedPayroll();
    await expectSentToDashboard();
  });

  it("inside the signed-in shell, still lets an Owner in when the API has no /auth/me (the built-in role decides)", async () => {
    seedSession(OrgRole.OWNER);
    renderGuardedPayrollInShell(noAccessEndpoint);

    expect(await screen.findByText(PAYROLL_TOTAL)).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("renders its children for a custom role that holds the permissions (from /auth/me, whatever the role is called)", async () => {
    seedSession(OrgRole.CUSTOM);
    renderGuardedPayrollInShell(() => json(200, ACCOUNTANT));

    expect(await screen.findByText(PAYROLL_TOTAL)).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("never renders its children for a custom role without money, and redirects to /dashboard", async () => {
    seedSession(OrgRole.CUSTOM);
    renderGuardedPayrollInShell(() => json(200, COORDINATOR));
    await expectSentToDashboard();
  });

  it("never renders its children for an Owner restricted to some projects (no organization-wide permission)", async () => {
    seedSession(OrgRole.OWNER);
    renderGuardedPayrollInShell(() => json(200, RESTRICTED_OWNER));
    await expectSentToDashboard();
  });

  it("outside the shell, reads /auth/me itself for a custom role and decides nothing until it answers", async () => {
    seedSession(OrgRole.CUSTOM);
    let answer: (response: Response) => void = () => {};
    const fetchMock = mockApi({ "GET /auth/me": () => new Promise<Response>((resolve) => (answer = resolve)) });
    render(<AuthProvider>{GUARDED_PAYROLL}</AuthProvider>);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("status").textContent).toBe(ar.states.loading);
    expect(screen.queryByText(PAYROLL_TOTAL)).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();

    answer(json(200, ACCOUNTANT));
    expect(await screen.findByText(PAYROLL_TOTAL)).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("Can", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function renderCan(me: Handler) {
    mockApi({ "GET /auth/me": me });
    return render(
      <AuthProvider>
        <Shell>
          <Can permission={Permission.VIEW_FINANCIALS} fallback={<p>بلا مبالغ</p>}>
            <p>{PAYROLL_TOTAL}</p>
          </Can>
          <Can anyOf={[Permission.GENERATE_OPERATIONAL_REPORTS, Permission.GENERATE_FINANCIAL_REPORTS]}>
            <p>التقارير</p>
          </Can>
        </Shell>
      </AuthProvider>,
    );
  }

  it("shows money only to a member who may see it", async () => {
    seedSession(OrgRole.CUSTOM);
    renderCan(() => json(200, ACCOUNTANT));
    expect(await screen.findByText(PAYROLL_TOTAL)).toBeTruthy();
    expect(screen.getByText("التقارير")).toBeTruthy();
    expect(screen.queryByText("بلا مبالغ")).toBeNull();
  });

  it("shows the fallback, never the money, to a member without it", async () => {
    seedSession(OrgRole.CUSTOM);
    renderCan(() => json(200, COORDINATOR));
    expect(await screen.findByText("التقارير")).toBeTruthy();
    expect(screen.getByText("بلا مبالغ")).toBeTruthy();
    expect(document.body.textContent).not.toContain("₪");
  });
});
