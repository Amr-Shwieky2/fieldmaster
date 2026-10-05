import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { OwnerOnly } from "../owner-only";
import { AuthProvider } from "../../lib/auth-context";
import { sessionStore, type StoredSession } from "../../lib/session-store";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

// AuthProvider clears the React Query cache on login/logout, so it needs a QueryClient above it.
function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

function seedSession(role: OrgRole) {
  const session: StoredSession = {
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    organizationId: "org-1",
    role,
    workerProfileId: null,
  };
  sessionStore.save(session);
}

describe("OwnerOnly (frontend financial-isolation guard)", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders its children for an Owner session", async () => {
    seedSession(OrgRole.OWNER);
    render(
      <AuthProvider>
        <OwnerOnly>
          <div>Payroll totals: ₪50,000.00</div>
        </OwnerOnly>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("Payroll totals: ₪50,000.00")).toBeTruthy());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("never renders its children for a Field Manager session and redirects to /dashboard", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    render(
      <AuthProvider>
        <OwnerOnly>
          <div>Payroll totals: ₪50,000.00</div>
        </OwnerOnly>
      </AuthProvider>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    // The financial content must never have been in the DOM, not merely hidden by CSS.
    expect(screen.queryByText("Payroll totals: ₪50,000.00")).toBeNull();
  });

  it("never renders its children for a Worker session and redirects to /dashboard", async () => {
    seedSession(OrgRole.WORKER);
    render(
      <AuthProvider>
        <OwnerOnly>
          <div>Payroll totals: ₪50,000.00</div>
        </OwnerOnly>
      </AuthProvider>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText("Payroll totals: ₪50,000.00")).toBeNull();
  });
});
