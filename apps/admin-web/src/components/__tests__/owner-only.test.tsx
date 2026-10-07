import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createIntlWrapper } from "../../test/render-with-intl";
import ar from "../../i18n/messages/ar.json";
import { OrgRole } from "@fieldmaster/shared-types";
import { OwnerOnly } from "../owner-only";
import { AuthProvider } from "../../lib/auth-context";
import { sessionStore, type StoredSession } from "../../lib/session-store";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

/** Owner-only financial content, as the payroll page would show it. */
const PAYROLL_TOTAL = "إجمالي الصافي: ₪ 50,000.00";

// AuthProvider clears the React Query cache on login/logout, so it needs a QueryClient above it;
// the loading state is translated, so it also needs the intl provider.
function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>, { wrapper: createIntlWrapper() });
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

function renderGuardedPayroll() {
  return render(
    <AuthProvider>
      <OwnerOnly>
        <div>{PAYROLL_TOTAL}</div>
      </OwnerOnly>
    </AuthProvider>,
  );
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
    renderGuardedPayroll();

    await waitFor(() => expect(screen.getByText(PAYROLL_TOTAL)).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("never renders its children for a Field Manager session and redirects to /dashboard", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    renderGuardedPayroll();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    // The financial content must never have been in the DOM, not merely hidden by CSS.
    expect(screen.queryByText(PAYROLL_TOTAL)).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
    // Only the Arabic loading state is shown while the redirect happens.
    expect(screen.getByRole("status").textContent).toBe(ar.states.loading);
  });

  it("never renders its children for a Worker session and redirects to /dashboard", async () => {
    seedSession(OrgRole.WORKER);
    renderGuardedPayroll();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText(PAYROLL_TOTAL)).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
    expect(screen.getByRole("status").textContent).toBe(ar.states.loading);
  });
});
