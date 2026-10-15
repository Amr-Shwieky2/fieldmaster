import { AppState } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type FinancialDashboard, type MyAccess, type OperationsSummary } from "@fieldmaster/api-client";
import { ALL_PERMISSIONS, Permission, permissionsForScope, SYSTEM_ROLE_PERMISSIONS } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import type { AccessValue } from "../../lib/access-context";
import { MANAGER_HOME_REFRESH_MS, ManagerHomeScreen } from "../ManagerHomeScreen";
import { deferred, expectArabicOnly, fill, inArabic, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = { getOperationsSummary: jest.fn(), getFinancialDashboard: jest.fn() };
const mockLogout = jest.fn(async () => undefined);
const mockAuth: { client: typeof mockClient; logout: jest.Mock; session: { role: string; workerProfileId: string | null } | null } = {
  client: mockClient,
  logout: mockLogout,
  session: { role: "OWNER", workerProfileId: null },
};
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));

let mockAccess: AccessValue;
jest.mock("../../lib/access-context", () => ({ useAccess: () => mockAccess }));

const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

// Outside a navigator the screen is focused while mounted; blur() / refocus() replay leaving it and coming back.
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
function accessFor(permissions: readonly Permission[], overrides: Partial<MyAccess> = {}): AccessValue {
  const set = new Set<Permission>(permissions);
  const restricted = overrides.scope?.restricted ?? false;
  const access: MyAccess = {
    userId: "user-1",
    membershipId: "membership-1",
    organizationId: "org-1",
    role: "OWNER",
    roleId: null,
    roleName: null,
    permissions: [...permissions],
    isTimeTrackable: false,
    workerProfileId: null,
    workRules: WORK_RULES,
    scope: { restricted: false, projectIds: [], siteIds: [], visibleProjectIds: [] },
    ...overrides,
  };
  return {
    status: "ready",
    access,
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

const OWNER = () => accessFor(ALL_PERMISSIONS, { role: "OWNER" });
const FIELD_MANAGER = () => accessFor(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER, { role: "FIELD_MANAGER" });
/** A custom «محاسب» role: money and reports, no operations. */
const ACCOUNTANT_PERMISSIONS: Permission[] = [
  Permission.VIEW_ATTENDANCE,
  Permission.VIEW_SHIFTS,
  Permission.VIEW_ORG_SETTINGS,
  Permission.VIEW_FINANCIALS,
  Permission.VIEW_COMPENSATION,
  Permission.VIEW_PAYROLL,
  Permission.VIEW_FINANCIAL_DASHBOARD,
  Permission.GENERATE_OPERATIONAL_REPORTS,
  Permission.GENERATE_FINANCIAL_REPORTS,
];
const ACCOUNTANT = () => accessFor(ACCOUNTANT_PERMISSIONS, { role: "CUSTOM", roleId: "role-accountant", roleName: "محاسب" });
/** A Field Manager restricted to one project: the organization-wide permissions (onboarding, Turan) fall away. */
const SCOPED_MANAGER = () =>
  accessFor(permissionsForScope(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER, true), {
    role: "FIELD_MANAGER",
    scope: { restricted: true, projectIds: ["project-1"], siteIds: [], visibleProjectIds: ["project-1"] },
  });

const SUMMARY: OperationsSummary = {
  generatedAt: "2026-10-15T09:42:00.000Z",
  pendingApprovals: 7,
  onShift: 12,
  late: 2,
  siteAlerts: 3,
  onboardingRequests: 1,
};

const DASHBOARD: FinancialDashboard = {
  yearMonth: "2026-10",
  source: "LIVE",
  finalizedVersion: null,
  netPayableAgorot: 12345678,
  laborCostAgorot: 11000050,
  previousMonth: { yearMonth: "2026-09", source: "FINALIZED", netPayableAgorot: 10000000, laborCostAgorot: 9000000 },
  costByProject: [],
  costBySite: [],
  costByWorker: [],
  topEarners: [],
  overtime: { totalAgorot: 0, totalMinutes: 0, averageDailyMinutes: 0, spikeFactor: 2, spikeMinimumMinutes: 60, spikes: [] },
  forgottenStamps: { penalties: 0, penaltiesAgorot: 0, reversals: 0, reversalsAgorot: 0, netDeductionsAgorot: 0 },
  emergencies: { callouts: 0, compensatedMinutes: 0, costAgorot: 0 },
  dailyTrend: [],
  pendingApproval: { entries: 7, exposureAgorot: 250000, entriesWithoutCompensation: 0 },
  workersWithoutCompensation: [],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const realNow = Date.now.bind(Date);
/** Moves "now" to a given instant (the clock keeps running from there). */
function setNow(instant: string) {
  const offset = new Date(instant).getTime() - realNow();
  jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
}

const ltr = (value: string) => `⁦${value}⁩`;
const iso = (value: string) => `⁨${value}⁩`;

function homeElement() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <ManagerHomeScreen navigation={navigation as any} route={{ key: "ManageTab-1", name: "ManageTab", params: undefined }} />;
}

async function renderHome() {
  const view = await renderInArabic(homeElement());
  await act(async () => undefined);
  return view;
}

const counter = (key: string) => screen.queryByTestId(`manager-counter-${key}`);
const action = (key: string) => screen.queryByTestId(`manager-action-${key}`);
const noMoney = () => expect(renderedStrings().join("\n")).not.toContain("₪");

async function blur() {
  await act(async () => {
    mockFocus.cleanup?.();
    mockFocus.cleanup = undefined;
  });
}

async function refocus() {
  await act(async () => {
    mockFocus.cleanup = mockFocus.effect?.();
  });
}

async function pullToRefresh() {
  const scroll = screen.getByTestId("manager-home-scroll");
  await act(async () => {
    await (scroll.props.refreshControl as { props: { onRefresh: () => Promise<void> } }).props.onRefresh();
  });
}

/** The screen's AppState listener (the app goes to the background or comes back). */
function appStateListener(): (state: string) => void {
  const calls = jest.mocked(AppState.addEventListener).mock.calls;
  return calls[calls.length - 1][1] as (state: string) => void;
}

// React Native's jest mock of AppState has no state of its own: tests set it (restored after each test).
const initialAppState = AppState.currentState;
function setAppState(state: string) {
  (AppState as { currentState: unknown }).currentState = state;
}

const networkError = () => new NetworkError(new TypeError("Network request failed"));

beforeEach(() => {
  // 15 October 2026, 12:45 in Jerusalem: the payroll month is 2026-10.
  setNow("2026-10-15T09:45:00.000Z");
  for (const fn of Object.values(mockClient)) fn.mockReset();
  mockFocus.effect = null;
  mockFocus.cleanup = undefined;
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockAuth.session = { role: "OWNER", workerProfileId: null };
  mockSync.isOnline = true;
  mockSync.pendingCount = 0;
  mockAccess = OWNER();
  mockClient.getOperationsSummary.mockResolvedValue(SUMMARY);
  mockClient.getFinancialDashboard.mockResolvedValue(DASHBOARD);
});

afterEach(() => {
  jest.useRealTimers();
  setAppState(initialAppState);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ManagerHomeScreen (Arabic, RTL)", () => {
  it("as an Owner: the role, every counter, every quick action and the month's payroll in shekels", async () => {
    await renderHome();

    expect(screen.getByRole("header", { name: ar.managerHome.title })).toBeOnTheScreen();
    expect(screen.getByText("الإدارة")).toBeOnTheScreen();
    expect(screen.getByTestId("manager-home-role")).toHaveTextContent(ar.enums.OrgRole.OWNER);
    expect(screen.queryByText(ar.managerHome.restricted)).not.toBeOnTheScreen();

    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(1);
    expect(mockClient.getOperationsSummary).toHaveBeenCalledWith();
    // The current Asia/Jerusalem payroll month.
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledTimes(1);
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledWith("2026-10");

    expect(screen.getByRole("button", { name: "بانتظار الموافقة: 7" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "في الدوام الآن: 12" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "متأخرون: 2" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "تنبيهات الموقع: 3" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "طلبات الانضمام: 1" })).toBeOnTheScreen();
    expect(within(counter("pendingApprovals")!).getByText("7")).toBeOnTheScreen();
    expect(within(counter("pendingApprovals")!).getByText(ar.common.pendingApproval)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.managerHome.updatedAt, { time: "12:42" }))).toBeOnTheScreen();

    for (const label of ["موقع عمل جديد", "مواقع العمل", "وردية جديدة", "الموافقات", "العمليات المباشرة"]) {
      expect(screen.getByRole("button", { name: label })).toBeOnTheScreen();
    }

    const money = within(screen.getByTestId("manager-money"));
    expect(money.getByText(fill(ar.managerHome.money, { month: "أكتوبر 2026" }))).toBeOnTheScreen();
    expect(money.getByText(ar.managerHome.netPayable)).toBeOnTheScreen();
    expect(screen.getByTestId("manager-money-net")).toHaveTextContent(ltr("₪ 123,456.78"));
    expect(money.getByText(fill(ar.managerHome.laborCost, { amount: ltr("₪ 110,000.50") }))).toBeOnTheScreen();
    expect(money.getByText(ar.enums.PayrollFigureSource.LIVE)).toBeOnTheScreen();

    expect(screen.queryByText(ar.managerHome.webOnly)).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.managerHome.notificationSettings })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.common.signOut })).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("as a Field Manager: counters and quick actions, never any money (the dashboard is never asked for)", async () => {
    mockAccess = FIELD_MANAGER();
    mockAuth.session = { role: "FIELD_MANAGER", workerProfileId: "manager-profile" };
    await renderHome();

    expect(screen.getByTestId("manager-home-role")).toHaveTextContent("مدير ميدان");
    for (const key of ["pendingApprovals", "onShift", "late", "siteAlerts", "onboardingRequests"]) expect(counter(key)).toBeOnTheScreen();
    for (const key of ["newWorkLocation", "workLocations", "newShift", "approvals", "liveOperations"]) expect(action(key)).toBeOnTheScreen();

    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(1);
    expect(mockClient.getFinancialDashboard).not.toHaveBeenCalled();
    expect(screen.queryByTestId("manager-money")).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.managerHome.netPayable)).not.toBeOnTheScreen();
    noMoney();
    expectArabicOnly();

    // Not on a refresh either.
    await pullToRefresh();
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(2);
    expect(mockClient.getFinancialDashboard).not.toHaveBeenCalled();
    noMoney();
  });

  it("as a custom «محاسب» role: its own name and the month's payroll, no operations counters or actions", async () => {
    mockAccess = ACCOUNTANT();
    mockAuth.session = { role: "CUSTOM", workerProfileId: null };
    await renderHome();

    expect(screen.getByTestId("manager-home-role")).toHaveTextContent(iso("محاسب"));
    expect(screen.queryByText(ar.enums.OrgRole.CUSTOM)).not.toBeOnTheScreen();

    // It holds none of the counters' permissions: the summary is never asked for.
    expect(mockClient.getOperationsSummary).not.toHaveBeenCalled();
    expect(screen.queryByTestId("manager-counters")).not.toBeOnTheScreen();
    expect(screen.queryByTestId("manager-actions")).not.toBeOnTheScreen();
    for (const label of [ar.common.pendingApproval, ar.managerHome.onShift, ar.managerHome.late, ar.managerHome.siteAlerts]) {
      expect(screen.queryByText(label)).not.toBeOnTheScreen();
    }

    expect(mockClient.getFinancialDashboard).toHaveBeenCalledWith("2026-10");
    expect(screen.getByTestId("manager-money-net")).toHaveTextContent(ltr("₪ 123,456.78"));
    // It has a tool on the phone: no "your tools are on the web" notice.
    expect(screen.queryByText(ar.managerHome.webOnly)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("as a manager restricted to some projects: the scope hint, their counters only, no money", async () => {
    mockAccess = SCOPED_MANAGER();
    mockAuth.session = { role: "FIELD_MANAGER", workerProfileId: null };
    // Even if the API sent it, a counter the member may not see is never shown.
    await renderHome();

    expect(screen.getByText(ar.managerHome.restricted)).toBeOnTheScreen();
    expect(screen.getByText("عرض مقيَّد بمشاريعك")).toBeOnTheScreen();
    for (const key of ["pendingApprovals", "onShift", "late", "siteAlerts"]) expect(counter(key)).toBeOnTheScreen();
    expect(counter("onboardingRequests")).not.toBeOnTheScreen();
    expect(mockClient.getFinancialDashboard).not.toHaveBeenCalled();
    expect(screen.queryByTestId("manager-money")).not.toBeOnTheScreen();
    noMoney();
    expectArabicOnly();
  });

  it("drops the figures, and an answer still on its way, when the money permission is taken away", async () => {
    const late = deferred<FinancialDashboard>();
    mockClient.getFinancialDashboard.mockReturnValueOnce(late.promise);
    const view = await renderHome();
    expect(screen.getByTestId("manager-money")).toBeOnTheScreen();

    // A new /auth/me answer: the role lost the financial dashboard while its figures were on their way.
    mockAccess = FIELD_MANAGER();
    await view.rerender(inArabic(homeElement()));
    await act(async () => late.resolve(DASHBOARD));
    expect(screen.queryByTestId("manager-money")).not.toBeOnTheScreen();
    noMoney();

    // Given back: asked for again, and the dropped answer is never shown meanwhile.
    const again = deferred<FinancialDashboard>();
    mockClient.getFinancialDashboard.mockReturnValueOnce(again.promise);
    mockAccess = OWNER();
    await view.rerender(inArabic(homeElement()));
    expect(screen.getByTestId("manager-money")).toBeOnTheScreen();
    expect(screen.queryByTestId("manager-money-net")).not.toBeOnTheScreen();
    noMoney();
    await act(async () => again.resolve({ ...DASHBOARD, netPayableAgorot: 100 }));
    expect(screen.getByTestId("manager-money-net")).toHaveTextContent(ltr("₪ 1.00"));
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledTimes(2);
  });

  it("shows a counter only when the API sends it", async () => {
    mockClient.getOperationsSummary.mockResolvedValue({ generatedAt: SUMMARY.generatedAt, pendingApprovals: 0, onShift: 4 });
    await renderHome();
    expect(screen.getByRole("button", { name: "بانتظار الموافقة: 0" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "في الدوام الآن: 4" })).toBeOnTheScreen();
    expect(counter("late")).not.toBeOnTheScreen();
    expect(counter("siteAlerts")).not.toBeOnTheScreen();
    expect(counter("onboardingRequests")).not.toBeOnTheScreen();
  });

  it("each counter opens its list", async () => {
    await renderHome();
    const expected: [string, unknown[]][] = [
      ["pendingApprovals", ["Approvals"]],
      ["onShift", ["LiveOperations", { focus: "onShift" }]],
      ["late", ["LiveOperations", { focus: "late" }]],
      ["siteAlerts", ["LiveOperations", { focus: "alerts" }]],
      ["onboardingRequests", ["OnboardingRequests"]],
    ];
    for (const [key, args] of expected) {
      navigation.navigate.mockClear();
      await fireEvent.press(counter(key)!);
      expect(navigation.navigate).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).toHaveBeenCalledWith(...args);
    }
    expect(counter("late")).toHaveStyle({ minHeight: 112 });
  });

  it("each quick action opens its screen, and only with its permission", async () => {
    await renderHome();
    const expected: [string, unknown[]][] = [
      ["موقع عمل جديد", ["WorkLocationEditor"]],
      ["مواقع العمل", ["WorkLocations"]],
      ["وردية جديدة", ["NewShift"]],
      ["الموافقات", ["Approvals"]],
      ["العمليات المباشرة", ["LiveOperations"]],
    ];
    for (const [label, args] of expected) {
      navigation.navigate.mockClear();
      await fireEvent.press(screen.getByRole("button", { name: label }));
      expect(navigation.navigate).toHaveBeenCalledWith(...args);
    }
  });

  it("shows each quick action and counter only with its own permission", async () => {
    mockAccess = accessFor([Permission.VIEW_SHIFTS, Permission.MANAGE_SHIFTS, Permission.VIEW_OPERATIONS], { role: "CUSTOM", roleName: "منسق ورديات" });
    await renderHome();
    expect(action("newShift")).toBeOnTheScreen();
    expect(action("liveOperations")).toBeOnTheScreen();
    expect(action("newWorkLocation")).not.toBeOnTheScreen();
    expect(action("workLocations")).not.toBeOnTheScreen();
    expect(action("approvals")).not.toBeOnTheScreen();
    expect(counter("onShift")).toBeOnTheScreen();
    expect(counter("pendingApprovals")).not.toBeOnTheScreen();
    expect(counter("onboardingRequests")).not.toBeOnTheScreen();
    expect(mockClient.getFinancialDashboard).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("a member with none of these tools is told their tools are on the web (and nothing is asked)", async () => {
    mockAccess = accessFor([Permission.VIEW_ATTENDANCE, Permission.VIEW_SHIFTS, Permission.GENERATE_OPERATIONAL_REPORTS], { role: "CUSTOM", roleName: "مراقب" });
    await renderHome();
    expect(screen.getByText(ar.managerHome.webOnly)).toBeOnTheScreen();
    expect(screen.getByText("أدوات صلاحياتك متاحة في لوحة الإدارة على الويب")).toBeOnTheScreen();
    expect(mockClient.getOperationsSummary).not.toHaveBeenCalled();
    expect(mockClient.getFinancialDashboard).not.toHaveBeenCalled();
    // Settings and sign-out stay reachable.
    expect(screen.getByRole("button", { name: ar.managerHome.notificationSettings })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.common.signOut })).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the built-in role of the session until /auth/me answers", async () => {
    mockAccess = { ...FIELD_MANAGER(), access: null };
    mockAuth.session = { role: "FIELD_MANAGER", workerProfileId: null };
    await renderHome();
    expect(screen.getByTestId("manager-home-role")).toHaveTextContent("مدير ميدان");
  });

  it("shows the loading state, then an Arabic error with a retry for the counters", async () => {
    const first = deferred<OperationsSummary>();
    const dashboard = deferred<FinancialDashboard>();
    mockClient.getOperationsSummary.mockReturnValueOnce(first.promise);
    mockClient.getFinancialDashboard.mockReturnValueOnce(dashboard.promise);
    await renderHome();
    expect(screen.getAllByLabelText(ar.states.loading)).toHaveLength(2);
    expectArabicOnly();

    await act(async () => first.reject(networkError()));
    expect(screen.getByText(`${ar.managerHome.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(counter("pendingApprovals")).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(2);
    expect(counter("pendingApprovals")).toBeOnTheScreen();
    expect(screen.queryByText(`${ar.managerHome.loadError}\n${ar.errors.network}`)).not.toBeOnTheScreen();

    // The money card was still loading meanwhile, and never blocked the counters.
    await act(async () => dashboard.resolve(DASHBOARD));
    expect(screen.getByTestId("manager-money-net")).toHaveTextContent(ltr("₪ 123,456.78"));
  });

  it("keeps the counters when a later reload fails", async () => {
    await renderHome();
    mockClient.getOperationsSummary.mockRejectedValue(networkError());
    await pullToRefresh();
    expect(screen.getByText(`${ar.managerHome.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "بانتظار الموافقة: 7" })).toBeOnTheScreen();
  });

  it("shows the money card's own error with a retry", async () => {
    mockClient.getFinancialDashboard.mockRejectedValueOnce(new ApiRequestError(500, { statusCode: 500, code: "ERROR", message: "boom", correlationId: "c" }));
    await renderHome();
    const money = within(screen.getByTestId("manager-money"));
    expect(money.getByText(`${ar.managerHome.moneyLoadError}\n${ar.errors.INTERNAL_ERROR}`)).toBeOnTheScreen();
    expect(screen.queryByTestId("manager-money-net")).not.toBeOnTheScreen();
    expect(counter("pendingApprovals")).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(money.getByRole("button", { name: ar.common.retry }));
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("manager-money-net")).toHaveTextContent(ltr("₪ 123,456.78"));
  });

  it("reloads on focus, and the counters every minute while focused (not while the app is in the background, nor after leaving)", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-15T09:45:00.000Z") });
    await renderHome();
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(1);
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(MANAGER_HOME_REFRESH_MS));
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(2);
    // The heavier financial dashboard is not polled.
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledTimes(1);

    setAppState("background");
    await act(async () => jest.advanceTimersByTime(MANAGER_HOME_REFRESH_MS));
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(2);
    setAppState("active");

    await blur();
    await act(async () => jest.advanceTimersByTime(MANAGER_HOME_REFRESH_MS * 3));
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(2);

    // Back on the screen: everything again, and the minute timer restarts.
    await refocus();
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(3);
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledTimes(2);
    await act(async () => jest.advanceTimersByTime(MANAGER_HOME_REFRESH_MS));
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(4);
  });

  it("reloads when the app comes back to the foreground", async () => {
    await renderHome();
    await act(async () => appStateListener()("active"));
    expect(mockClient.getOperationsSummary).toHaveBeenCalledTimes(2);
    expect(mockClient.getFinancialDashboard).toHaveBeenCalledTimes(2);
  });

  it("pull-to-refresh reloads the counters and the money", async () => {
    await renderHome();
    mockClient.getOperationsSummary.mockResolvedValue({ ...SUMMARY, pendingApprovals: 9 });
    mockClient.getFinancialDashboard.mockResolvedValue({ ...DASHBOARD, netPayableAgorot: 50000 });
    await pullToRefresh();
    expect(screen.getByRole("button", { name: "بانتظار الموافقة: 9" })).toBeOnTheScreen();
    expect(screen.getByTestId("manager-money-net")).toHaveTextContent(ltr("₪ 500.00"));
    expect((screen.getByTestId("manager-home-scroll").props.refreshControl as { props: { refreshing: boolean } }).props.refreshing).toBe(false);
  });

  it("never lets an older, slower answer replace a newer one", async () => {
    const slow = deferred<OperationsSummary>();
    mockClient.getOperationsSummary.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ ...SUMMARY, pendingApprovals: 2 });
    await renderHome();
    await pullToRefresh();
    expect(screen.getByRole("button", { name: "بانتظار الموافقة: 2" })).toBeOnTheScreen();
    await act(async () => slow.resolve({ ...SUMMARY, pendingApprovals: 40 }));
    expect(screen.getByRole("button", { name: "بانتظار الموافقة: 2" })).toBeOnTheScreen();
  });

  it("opens the notification settings", async () => {
    await renderHome();
    await fireEvent.press(screen.getByRole("button", { name: "إعدادات الإشعارات" }));
    expect(navigation.navigate).toHaveBeenCalledWith("NotificationPreferences");
  });

  it("asks before signing out", async () => {
    await renderHome();
    const signOut = screen.getByRole("button", { name: "تسجيل الخروج" });
    expect(signOut).toHaveStyle({ minHeight: 56 });

    await fireEvent.press(signOut);
    expect(mockLogout).not.toHaveBeenCalled();
    expect(screen.getByText(ar.home.signOutConfirm)).toBeOnTheScreen();
    expect(screen.getByText("هل تريد تسجيل الخروج؟")).toBeOnTheScreen();
    expect(screen.queryByText(ar.home.signOutPending, { exact: false })).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.common.cancel }));
    expect(screen.queryByText(ar.home.signOutConfirm)).not.toBeOnTheScreen();
    expect(mockLogout).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: ar.common.signOut }));
    await fireEvent.press(screen.getByRole("button", { name: "نعم، سجّل الخروج" }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("warns that records waiting to sync stay on the phone after signing out", async () => {
    mockSync.isOnline = false;
    mockSync.pendingCount = 3;
    await renderHome();
    // The offline banner opens the queue.
    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).toHaveBeenCalledWith("OfflineQueue");

    await fireEvent.press(screen.getByRole("button", { name: ar.common.signOut }));
    expect(screen.getByText(fill(ar.home.signOutPending, { count: "3" }))).toBeOnTheScreen();
    expectArabicOnly();
    await fireEvent.press(screen.getByRole("button", { name: ar.home.signOutYes }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
