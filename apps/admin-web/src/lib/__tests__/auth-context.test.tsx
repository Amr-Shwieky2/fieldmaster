import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { renderToString as reactRenderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider, useAuth } from "../auth-context";
import { sessionStore } from "../session-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

function withQueryClient(ui: ReactElement, queryClient = new QueryClient()) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}
const render = (ui: ReactElement) => rtlRender(withQueryClient(ui));
const renderToString = (ui: ReactElement) => reactRenderToString(withQueryClient(ui));

function Probe() {
  const { isReady, isAuthenticated, session } = useAuth();
  return <p>{`ready=${isReady} authenticated=${isAuthenticated} role=${session?.role ?? "none"}`}</p>;
}

describe("AuthProvider hydration safety", () => {
  beforeEach(() => {
    window.localStorage.clear();
    sessionStore.save({
      accessToken: "token",
      refreshToken: "refresh",
      organizationId: "org-1",
      role: OrgRole.OWNER,
      workerProfileId: null,
    });
  });
  afterEach(() => cleanup());

  it("renders the same not-ready state on the server even when a session is stored", () => {
    // Regression test: reading localStorage during the first render made the
    // server HTML differ from the client's first render on every page load.
    const html = renderToString(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(html).toContain("ready=false authenticated=false role=none");
  });

  it("loads the stored session after mount", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("ready=true authenticated=true role=OWNER")).toBeTruthy());
  });

  it("becomes ready without a session when nothing is stored", async () => {
    window.localStorage.clear();
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText("ready=true authenticated=false role=none")).toBeTruthy());
  });

  it("drops every cached query when the signed-in user changes (logout and login)", async () => {
    // Regression test: query keys are not per user, so after quick-switching
    // from an Owner to a Field Manager the Field Manager could see the Owner's
    // cached responses (e.g. worker compensation) until a refetch.
    const queryClient = new QueryClient();
    let auth: ReturnType<typeof useAuth> | null = null;
    function Capture() {
      auth = useAuth();
      return null;
    }
    rtlRender(withQueryClient(<AuthProvider><Capture /></AuthProvider>, queryClient));
    await waitFor(() => expect(auth?.isReady).toBe(true));

    queryClient.setQueryData(["worker", "w1"], { compensation: { dailyBaseRateAgorot: 45_000 } });
    act(() => auth!.logout());
    expect(queryClient.getQueryData(["worker", "w1"])).toBeUndefined();

    queryClient.setQueryData(["workers"], [{ id: "w1" }]);
    act(() =>
      auth!.login({ accessToken: "header.eyJ3b3JrZXJQcm9maWxlSWQiOm51bGx9.sig", refreshToken: "r", organizationId: "org-1", role: OrgRole.FIELD_MANAGER }),
    );
    expect(queryClient.getQueryData(["workers"])).toBeUndefined();
  });
});
