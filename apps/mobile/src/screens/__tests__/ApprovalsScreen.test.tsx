import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { NetworkError, type AttendanceListItem, type AttendanceListResponse, type MyAccess } from "@fieldmaster/api-client";
import { Permission, permissionsForScope, SYSTEM_ROLE_PERMISSIONS } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import type { AccessValue } from "../../lib/access-context";
import { APPROVALS_PAGE_SIZE, ApprovalsScreen } from "../ApprovalsScreen";
import { deferred, expectArabicOnly, fill, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = { listAttendanceEntries: jest.fn() };
const mockAuth = { client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));

let mockAccess: AccessValue;
jest.mock("../../lib/access-context", () => ({ useAccess: () => mockAccess }));

const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

// Outside a navigator the screen is focused while mounted; refocus() replays coming back to it (after a decision).
const mockFocus: { effect: (() => void | (() => void)) | null; cleanup: void | (() => void) } = { effect: null, cleanup: undefined };
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return {
    ...actual,
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => {
        mockFocus.effect = effect;
        mockFocus.cleanup = effect();
        return () => {
          mockFocus.cleanup?.();
          mockFocus.cleanup = undefined;
        };
      }, [effect]);
    },
  };
});

let navigation: { navigate: jest.Mock; goBack: jest.Mock };

// ── Fixtures ────────────────────────────────────────────────────────────────

const WORK_RULES = { standardDayMinutes: 540, overtimeThresholdMinutes: 540, emergencyMinutesBefore: 30, emergencyMinutesAfter: 30, clockInEarlyWindowMinutes: 30 } as MyAccess["workRules"];

/** What `useAccess()` gives a member with these permissions (from /auth/me). */
function accessFor(permissions: readonly Permission[], restricted = false): AccessValue {
  const set = new Set<Permission>(permissions);
  return {
    status: "ready",
    access: {
      userId: "user-1",
      membershipId: "membership-1",
      organizationId: "org-1",
      role: "FIELD_MANAGER",
      roleId: null,
      roleName: null,
      permissions: [...permissions],
      isTimeTrackable: false,
      workerProfileId: null,
      workRules: WORK_RULES,
      scope: { restricted, projectIds: restricted ? ["project-1"] : [], siteIds: [], visibleProjectIds: restricted ? ["project-1"] : [] },
    },
    permissions: set,
    can: (permission) => set.has(permission),
    canAny: (list) => list.some((permission) => set.has(permission)),
    isManager: true,
    hasWorkerHome: false,
    restricted,
    workRules: WORK_RULES,
    refresh: jest.fn(async () => undefined),
  };
}

function entry(overrides: Partial<AttendanceListItem> & Pick<AttendanceListItem, "id">): AttendanceListItem {
  return {
    status: "PENDING_APPROVAL",
    businessDate: "2026-10-14",
    clockInAt: "2026-10-14T05:00:00.000Z",
    clockOutAt: "2026-10-14T13:30:00.000Z",
    rawDurationMinutes: 510,
    unpaidBreakMinutes: 0,
    approvedRegularMinutes: null,
    approvedOvertimeMinutes: null,
    fullDayCredit: false,
    isEmergency: false,
    devRewoundAt: null,
    checkInMethod: "GEOFENCED",
    dayRules: { standardDayMinutes: 540, overtimeThresholdMinutes: 540 },
    worker: { id: "worker-1", fullLegalName: "أحمد خليل" },
    shift: {
      id: "shift-1",
      title: "صيانة شارع يافا",
      shiftType: "STANDARD",
      project: { id: "project-1", name: "مشروع القدس" },
      site: { id: "site-1", name: "مفترق الساعة" },
    },
    dailySummary: null,
    flags: [],
    ...overrides,
  };
}

function listPage(items: AttendanceListItem[], total: number, page = 1): AttendanceListResponse {
  return { items, page, pageSize: APPROVALS_PAGE_SIZE, total, tabCounts: { PENDING: total, APPROVED: 0, REJECTED: 0, ALL: total } };
}

/** `count` entries numbered from `from` (entry-1, entry-2, ...). */
function entries(from: number, count: number): AttendanceListItem[] {
  return Array.from({ length: count }, (_, index) => entry({ id: `entry-${from + index}`, worker: { id: `worker-${from + index}`, fullLegalName: `عامل ${from + index}` } }));
}

const AHMAD = entry({ id: "entry-1", flags: ["OUTSIDE_GEOFENCE_ATTEMPT", "OFFLINE"] });
const SAMER = entry({
  id: "entry-2",
  status: "CORRECTION_REQUESTED",
  businessDate: "2026-10-13",
  clockInAt: "2026-10-13T19:00:00.000Z",
  clockOutAt: "2026-10-13T21:15:00.000Z",
  rawDurationMinutes: 135,
  isEmergency: true,
  worker: { id: "worker-2", fullLegalName: "سامر عودة" },
  // The API's English placeholder title of a call-out shift, without a site.
  shift: { id: "shift-2", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT", project: null, site: null },
  flags: ["EMERGENCY", "SUSPICIOUS_LOCATION"],
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const iso = (value: string) => `⁨${value}⁩`;

async function renderApprovals() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await renderInArabic(<ApprovalsScreen navigation={navigation as any} route={{ key: "Approvals-1", name: "Approvals", params: undefined }} />);
  await act(async () => undefined);
}

const list = () => screen.getByTestId("approvals-list");
const shownIds = () => (list().props.data as AttendanceListItem[]).map((item) => item.id);

/** The list reached its end (FlatList's onEndReached; jest has no layout to scroll). */
async function reachEnd() {
  await act(async () => {
    (list().props.onEndReached as () => void)();
  });
}

async function refocus() {
  await act(async () => {
    mockFocus.cleanup?.();
    mockFocus.cleanup = mockFocus.effect?.();
  });
}

async function pullToRefresh() {
  await act(async () => {
    await (list().props.refreshControl as { props: { onRefresh: () => Promise<void> } }).props.onRefresh();
  });
}

const networkError = () => new NetworkError(new TypeError("Network request failed"));
const pageCall = (page: number) => ({ tab: "PENDING", pageSize: 20, page });

beforeEach(() => {
  mockClient.listAttendanceEntries.mockReset();
  mockClient.listAttendanceEntries.mockResolvedValue(listPage([AHMAD, SAMER], 2));
  mockFocus.effect = null;
  mockFocus.cleanup = undefined;
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockAccess = accessFor(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ApprovalsScreen (Arabic, RTL)", () => {
  it("shows the loading state, then the first page of entries waiting for approval: who, when, which shift, times, duration and flags", async () => {
    const first = deferred<AttendanceListResponse>();
    mockClient.listAttendanceEntries.mockReturnValueOnce(first.promise);
    await renderApprovals();
    expect(screen.getByRole("header", { name: ar.approvals.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expectArabicOnly();

    await act(async () => first.resolve(listPage([AHMAD, SAMER], 2)));
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(1);
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledWith(pageCall(1));
    expect(screen.getByText(fill(ar.approvals.total, { count: "2" }))).toBeOnTheScreen();
    expect(shownIds()).toEqual(["entry-1", "entry-2"]);

    const ahmad = within(screen.getByTestId("approvals-row-entry-1"));
    expect(ahmad.getByText(iso("أحمد خليل"))).toBeOnTheScreen();
    expect(ahmad.getByText("14 أكتوبر 2026")).toBeOnTheScreen();
    expect(ahmad.getByText(fill(ar.approvals.shiftAtSite, { shift: iso("صيانة شارع يافا"), site: iso("مفترق الساعة") }))).toBeOnTheScreen();
    expect(ahmad.getByText("من 08:00 إلى 16:30")).toBeOnTheScreen();
    expect(ahmad.getByText("المدة: 8 س 30 د")).toBeOnTheScreen();
    expect(ahmad.getByText(ar.enums.AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT)).toBeOnTheScreen();
    expect(ahmad.getByText(ar.enums.AttendanceFlag.OFFLINE)).toBeOnTheScreen();
    expect(ahmad.queryByText(ar.enums.TimeEntryStatus.CORRECTION_REQUESTED)).not.toBeOnTheScreen();

    // A call-out without a site: the Arabic shift type, its status and its flags.
    const samer = within(screen.getByTestId("approvals-row-entry-2"));
    expect(samer.getByText(iso("سامر عودة"))).toBeOnTheScreen();
    expect(samer.getByText(ar.enums.TimeEntryStatus.CORRECTION_REQUESTED)).toBeOnTheScreen();
    expect(samer.getByText(iso(ar.enums.ShiftType.EMERGENCY_CALLOUT))).toBeOnTheScreen();
    expect(samer.getByText("13 أكتوبر 2026")).toBeOnTheScreen();
    expect(samer.getByText("من 22:00 إلى 00:15")).toBeOnTheScreen();
    expect(samer.getByText("المدة: 2 س 15 د")).toBeOnTheScreen();
    expect(samer.getByText(ar.enums.AttendanceFlag.EMERGENCY)).toBeOnTheScreen();
    expect(samer.getByText(ar.enums.AttendanceFlag.SUSPICIOUS_LOCATION)).toBeOnTheScreen();

    expect(screen.queryByText(ar.managerHome.restricted)).not.toBeOnTheScreen();
    expect(renderedStrings().join("\n")).not.toContain("₪");
    expectArabicOnly();
  });

  it("opens an entry's review", async () => {
    await renderApprovals();
    const row = screen.getByTestId("approvals-row-entry-2");
    expect(row).toHaveStyle({ minHeight: 56 });
    expect(screen.getAllByRole("button", { name: /سامر عودة/ })).toHaveLength(1);
    await fireEvent.press(row);
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "entry-2" });
  });

  it("loads the next page at the end of the list, one at a time, until every entry is loaded", async () => {
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(1, 20), 23));
    await renderApprovals();
    expect(shownIds()).toHaveLength(20);
    expect(list().props.initialNumToRender).toBe(APPROVALS_PAGE_SIZE);

    const second = deferred<AttendanceListResponse>();
    mockClient.listAttendanceEntries.mockReturnValueOnce(second.promise);
    await reachEnd();
    await reachEnd();
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(2);
    expect(mockClient.listAttendanceEntries).toHaveBeenLastCalledWith(pageCall(2));
    expect(screen.getByText(ar.approvals.loadingMore)).toBeOnTheScreen();
    expectArabicOnly();

    await act(async () => second.resolve(listPage(entries(21, 3), 23, 2)));
    expect(shownIds()).toEqual(entries(1, 23).map((item) => item.id));
    expect(screen.queryByText(ar.approvals.loadingMore)).not.toBeOnTheScreen();
    expect(screen.getByText(fill(ar.approvals.total, { count: "23" }))).toBeOnTheScreen();

    // Everything is loaded: the end of the list asks nothing more.
    await reachEnd();
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(2);
  });

  it("never shows an entry twice when entries move between pages, and an empty page ends the list", async () => {
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(1, 20), 25));
    await renderApprovals();
    // A new entry arrived at the top meanwhile: page 2 starts with entry-20 again.
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(20, 3), 26, 2));
    await reachEnd();
    expect(shownIds()).toEqual(entries(1, 22).map((item) => item.id));

    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage([], 26, 3));
    await reachEnd();
    expect(mockClient.listAttendanceEntries).toHaveBeenLastCalledWith(pageCall(3));
    expect(shownIds()).toHaveLength(22);
    await reachEnd();
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(3);
  });

  it("a page that fails shows an Arabic error with a retry, and only the retry asks again", async () => {
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(1, 20), 21));
    await renderApprovals();
    mockClient.listAttendanceEntries.mockRejectedValueOnce(networkError());
    await reachEnd();
    expect(screen.getByText(`${ar.approvals.loadMoreError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(shownIds()).toHaveLength(20);
    expectArabicOnly();

    await reachEnd();
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(2);

    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(21, 1), 21, 2));
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(3);
    expect(mockClient.listAttendanceEntries).toHaveBeenLastCalledWith(pageCall(2));
    expect(shownIds()).toHaveLength(21);
    expect(screen.queryByText(`${ar.approvals.loadMoreError}\n${ar.errors.network}`)).not.toBeOnTheScreen();
  });

  it("says when nothing is waiting for approval", async () => {
    mockClient.listAttendanceEntries.mockResolvedValue(listPage([], 0));
    await renderApprovals();
    expect(screen.getByText(ar.approvals.empty)).toBeOnTheScreen();
    expect(screen.getByText("لا يوجد حضور بانتظار الموافقة")).toBeOnTheScreen();
    expect(screen.getByText(ar.approvals.emptyHint)).toBeOnTheScreen();
    expect(screen.queryByTestId("approvals-total")).not.toBeOnTheScreen();
    await reachEnd();
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(1);
    expectArabicOnly();
  });

  it("shows an Arabic error with a retry when the list cannot be loaded", async () => {
    mockClient.listAttendanceEntries.mockRejectedValueOnce(networkError());
    await renderApprovals();
    expect(screen.getByText(`${ar.approvals.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.queryByText(ar.approvals.empty)).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("approvals-row-entry-1")).toBeOnTheScreen();
    expect(screen.queryByText(`${ar.approvals.loadError}\n${ar.errors.network}`)).not.toBeOnTheScreen();
  });

  it("reloads from the first page when the screen gains focus again (after a decision on the review screen)", async () => {
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(1, 20), 22));
    await renderApprovals();
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(21, 2), 22, 2));
    await reachEnd();
    expect(shownIds()).toHaveLength(22);

    // entry-1 was approved meanwhile.
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(2, 20), 21));
    await refocus();
    expect(mockClient.listAttendanceEntries).toHaveBeenLastCalledWith(pageCall(1));
    expect(shownIds()).toEqual(entries(2, 20).map((item) => item.id));
    expect(screen.queryByTestId("approvals-row-entry-1")).not.toBeOnTheScreen();

    // Paging starts over from page 2.
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(22, 1), 21, 2));
    await reachEnd();
    expect(mockClient.listAttendanceEntries).toHaveBeenLastCalledWith(pageCall(2));
    expect(shownIds()).toHaveLength(21);
  });

  it("drops a next page still on its way when the list is reloaded", async () => {
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(1, 20), 40));
    await renderApprovals();
    const late = deferred<AttendanceListResponse>();
    mockClient.listAttendanceEntries.mockReturnValueOnce(late.promise);
    await reachEnd();

    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage(entries(1, 20), 20));
    await pullToRefresh();
    await act(async () => late.resolve(listPage(entries(21, 20), 40, 2)));
    expect(shownIds()).toHaveLength(20);
    expect(screen.queryByText(ar.approvals.loadingMore)).not.toBeOnTheScreen();
    expect(screen.getByText(fill(ar.approvals.total, { count: "20" }))).toBeOnTheScreen();
  });

  it("pull-to-refresh reloads the first page", async () => {
    await renderApprovals();
    mockClient.listAttendanceEntries.mockResolvedValueOnce(listPage([SAMER], 1));
    await pullToRefresh();
    expect(mockClient.listAttendanceEntries).toHaveBeenCalledTimes(2);
    expect(mockClient.listAttendanceEntries).toHaveBeenLastCalledWith(pageCall(1));
    expect(shownIds()).toEqual(["entry-2"]);
    expect((list().props.refreshControl as { props: { refreshing: boolean } }).props.refreshing).toBe(false);
  });

  it("shows the scope hint to a member restricted to some projects", async () => {
    mockAccess = accessFor(permissionsForScope(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER, true), true);
    await renderApprovals();
    expect(screen.getByText(ar.managerHome.restricted)).toBeOnTheScreen();
    expect(screen.getByTestId("approvals-row-entry-1")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("without the approval permission, asks nothing and says so", async () => {
    mockAccess = accessFor([Permission.VIEW_ATTENDANCE, Permission.VIEW_OPERATIONS]);
    await renderApprovals();
    expect(screen.getByText(ar.approvals.noPermission)).toBeOnTheScreen();
    expect(mockClient.listAttendanceEntries).not.toHaveBeenCalled();
    expectArabicOnly();
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("the offline banner opens the queue of records waiting to sync", async () => {
    mockSync.isOnline = false;
    await renderApprovals();
    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).toHaveBeenCalledWith("OfflineQueue");
    expectArabicOnly();
  });
});
