import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole, Permission, SYSTEM_ROLE_PERMISSIONS } from "@fieldmaster/shared-types";
import { apiError, json, mockApi, requestsTo, seedSession, type Handler } from "@/test/api-mock";
import { ACCOUNTANT, COORDINATOR, RESTRICTED_OWNER } from "@/test/access-fixtures";
import { AuthProvider, useAuth } from "../auth-context";
import { sessionStore } from "../session-store";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

let auth: ReturnType<typeof useAuth> | null = null;
function Capture() {
  auth = useAuth();
  return (
    <p>{`status=${auth.accessStatus} canPayroll=${auth.can(Permission.VIEW_PAYROLL)} canReports=${auth.canAny([
      Permission.GENERATE_OPERATIONAL_REPORTS,
      Permission.GENERATE_FINANCIAL_REPORTS,
    ])}`}</p>
  );
}

function renderProvider(routes: Record<string, Handler>) {
  const fetchMock = mockApi(routes);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Capture />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

async function signedIn() {
  await waitFor(() => expect(auth?.isReady).toBe(true));
  return auth!;
}

beforeEach(() => {
  auth = null;
  router.replace.mockClear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AuthProvider: the member's access (GET /auth/me)", () => {
  it("asks nothing until the signed-in shell loads it, and the built-in role's permissions stand in meanwhile", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = renderProvider({});
    const value = await signedIn();

    expect(value.accessStatus).toBe("idle");
    expect(value.access).toBeNull();
    expect([...value.permissions].sort()).toEqual([...SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER].sort());
    expect(value.can(Permission.VIEW_ATTENDANCE)).toBe(true);
    expect(value.can(Permission.VIEW_PAYROLL)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads /auth/me once and exposes its permissions, can, canAny, the scope and the role's name", async () => {
    seedSession(OrgRole.CUSTOM);
    const fetchMock = renderProvider({ "GET /auth/me": () => json(200, ACCOUNTANT) });
    const value = await signedIn();
    // A custom role has no permission until /auth/me tells.
    expect(value.can(Permission.VIEW_PAYROLL)).toBe(false);

    await act(async () => {
      await value.loadAccess();
    });
    expect(screen.getByText("status=ready canPayroll=true canReports=true")).toBeTruthy();
    expect(auth!.access?.roleName).toBe("محاسب");
    expect(auth!.access?.scope.restricted).toBe(false);
    expect([...auth!.permissions].sort()).toEqual([...ACCOUNTANT.permissions].sort());

    // Loading again in the same session reads nothing more (later reads are refreshes).
    await act(async () => {
      await auth!.loadAccess();
    });
    expect(requestsTo(fetchMock, "GET", "/auth/me")).toHaveLength(1);
    // The access token is the session's own.
    expect(requestsTo(fetchMock, "GET", "/auth/me")[0].headers.Authorization).toBe("Bearer test-access");
  });

  it("shows «loading» until the first answer", async () => {
    seedSession(OrgRole.OWNER);
    let answer: (response: Response) => void = () => {};
    renderProvider({ "GET /auth/me": () => new Promise<Response>((resolve) => (answer = resolve)) });
    const value = await signedIn();

    act(() => void value.loadAccess());
    expect(await screen.findByText(/^status=loading/)).toBeTruthy();
    await act(async () => answer(json(200, RESTRICTED_OWNER)));
    // A restricted Owner has none of the organization-wide permissions.
    expect(await screen.findByText("status=ready canPayroll=false canReports=true")).toBeTruthy();
    expect(auth!.access?.scope.restricted).toBe(true);
  });

  it("falls back to the built-in role's permissions when the API has no /auth/me (older mocks and servers)", async () => {
    seedSession(OrgRole.OWNER);
    renderProvider({ "GET /auth/me": () => apiError(404, "NOT_FOUND") });
    const value = await signedIn();

    await act(async () => {
      await value.loadAccess();
    });
    expect(screen.getByText("status=failed canPayroll=true canReports=true")).toBeTruthy();
    expect(auth!.access).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("reads it again on window focus, and after a change (refreshAccess); a failed read keeps what was known", async () => {
    seedSession(OrgRole.CUSTOM);
    let answer: Handler = () => json(200, COORDINATOR);
    const fetchMock = renderProvider({ "GET /auth/me": () => answer(undefined, new URL("http://x")) });
    const value = await signedIn();
    await act(async () => {
      await value.loadAccess();
    });
    expect(screen.getByText("status=ready canPayroll=false canReports=true")).toBeTruthy();

    // The Owner gave the role payroll meanwhile: it shows when the window comes back.
    answer = () => json(200, ACCOUNTANT);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    await act(async () => {
      fireEvent.focus(window);
    });
    expect(await screen.findByText("status=ready canPayroll=true canReports=true")).toBeTruthy();
    expect(requestsTo(fetchMock, "GET", "/auth/me")).toHaveLength(2);

    // A failed refresh does not undo what is known.
    answer = () => apiError(503, "SERVICE_UNAVAILABLE");
    await act(async () => {
      await auth!.refreshAccess();
    });
    expect(requestsTo(fetchMock, "GET", "/auth/me")).toHaveLength(3);
    expect(screen.getByText("status=ready canPayroll=true canReports=true")).toBeTruthy();
  });

  it("does not refresh before the shell loaded it, and a new sign-in starts over", async () => {
    seedSession(OrgRole.CUSTOM);
    const fetchMock = renderProvider({ "GET /auth/me": () => json(200, ACCOUNTANT) });
    const value = await signedIn();

    await act(async () => {
      await value.refreshAccess();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await auth!.loadAccess();
    });
    expect(auth!.can(Permission.VIEW_PAYROLL)).toBe(true);

    // Signing in as someone else drops the previous member's access at once.
    act(() => auth!.login({ accessToken: "header.eyJ3b3JrZXJQcm9maWxlSWQiOm51bGx9.sig", refreshToken: "r2", organizationId: "org-1", role: OrgRole.FIELD_MANAGER }));
    expect(auth!.accessStatus).toBe("idle");
    expect(auth!.access).toBeNull();
    expect(auth!.can(Permission.VIEW_PAYROLL)).toBe(false);
    expect(auth!.can(Permission.VIEW_ATTENDANCE)).toBe(true);
  });

  it("signs out when /auth/me answers 401", async () => {
    seedSession(OrgRole.OWNER);
    renderProvider({ "GET /auth/me": () => apiError(401, "UNAUTHENTICATED") });
    const value = await signedIn();

    await act(async () => {
      await value.loadAccess();
    });
    expect(router.replace).toHaveBeenCalledWith("/login");
    expect(sessionStore.load()).toBeNull();
    expect(auth!.isAuthenticated).toBe(false);
  });
});
