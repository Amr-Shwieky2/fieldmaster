import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { Shift } from "@fieldmaster/api-client";
import { CheckInMethod, Permission, ShiftStatus, ShiftType } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { authWithAccess, myAccess } from "@/test/access-fixtures";
import ShiftsPage from "../page";
import ShiftDetailPage from "../[id]/page";
import NewShiftPage from "../new/page";

// Flexible organization model: VIEW_SHIFTS reads the schedule; creating and assigning are MANAGE_SHIFTS,
// temporary supervisors MANAGE_TEMP_SUPERVISORS -- whatever the member's role is called.

const client = vi.hoisted(() => ({
  listShifts: vi.fn(),
  getShift: vi.fn(),
  listWorkers: vi.fn(),
  listShiftTemporarySupervisors: vi.fn(),
  listProjects: vi.fn(),
}));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));
const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useParams: () => ({ id: "sh1" }),
  usePathname: () => "/shifts",
  useSearchParams: () => new URLSearchParams(),
}));

const SHIFT: Shift = {
  id: "sh1",
  organizationId: "o1",
  projectId: "p1",
  siteId: "s1",
  geofenceId: "g1",
  shiftType: ShiftType.STANDARD,
  title: "صب الأسقف",
  scheduledStart: "2026-10-05T04:00:00.000Z",
  scheduledEnd: "2026-10-05T13:00:00.000Z",
  checkInMethod: CheckInMethod.GEOFENCED,
  status: ShiftStatus.PUBLISHED,
  managerId: "m1",
  businessDate: "2026-10-05",
  assignments: [],
};

/** A member who reads the schedule only. */
const VIEWER = myAccess({ roleName: "متابع الجدول", permissions: [Permission.VIEW_SHIFTS] });

beforeEach(() => {
  vi.clearAllMocks();
  auth.value = authWithAccess(VIEWER, client);
  client.listShifts.mockResolvedValue([SHIFT]);
  client.getShift.mockResolvedValue(SHIFT);
  client.listWorkers.mockResolvedValue([]);
  client.listShiftTemporarySupervisors.mockResolvedValue([]);
  client.listProjects.mockResolvedValue([]);
});

describe("Shifts by permission", () => {
  it("lists the shifts without the «new shift» link for a member who may only read them", async () => {
    renderWithIntl(<ShiftsPage />, { queryClient: true });
    expect(await screen.findByText("صب الأسقف")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "وردية جديدة" })).toBeNull();
  });

  it("shows the shift without assigning or temporary supervisors", async () => {
    renderWithIntl(<ShiftDetailPage />, { queryClient: true });
    expect(await screen.findByRole("heading", { level: 1, name: "صب الأسقف" })).toBeTruthy();
    expect(screen.queryByLabelText("تكليف عامل")).toBeNull();
    expect(client.listShiftTemporarySupervisors).not.toHaveBeenCalled();
  });

  it("sends a member who may not create shifts from the new-shift page to the dashboard", async () => {
    renderWithIntl(<NewShiftPage />, { queryClient: true });
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it("offers everything to a member who manages shifts and temporary supervisors", async () => {
    auth.value = authWithAccess(
      myAccess({ roleName: "منسق الورديات", permissions: [Permission.VIEW_SHIFTS, Permission.MANAGE_SHIFTS, Permission.MANAGE_TEMP_SUPERVISORS] }),
      client,
    );
    renderWithIntl(<ShiftDetailPage />, { queryClient: true });
    expect(await screen.findByLabelText("تكليف عامل")).toBeTruthy();
    await waitFor(() => expect(client.listShiftTemporarySupervisors).toHaveBeenCalledWith("sh1"));
  });
});
