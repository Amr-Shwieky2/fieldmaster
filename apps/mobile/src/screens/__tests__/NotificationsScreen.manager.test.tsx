import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { NetworkError, type NotificationItem } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { NotificationsScreen } from "../NotificationsScreen";
import { expectArabicOnly, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { listNotifications: jest.fn(), markNotificationRead: jest.fn(), markAllNotificationsRead: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "OWNER", workerProfileId: null } }) }));
const mockAccess = { isManager: true };
jest.mock("../../lib/access-context", () => ({ useAccess: () => mockAccess }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));
const mockReport = jest.fn();
jest.mock("../../lib/notifications-context", () => ({ useNotifications: () => ({ unreadCount: 0, refresh: jest.fn(), report: mockReport }) }));

type Navigation = NativeStackScreenProps<RootStackParamList, "Notifications">["navigation"];

/** The root stack of a member who manages (RootNavigator): the tabs, the shared screens and the manager screens. */
const ROOT_ROUTES = [
  "Main",
  "ClockIn",
  "ClockOut",
  "History",
  "OfflineQueue",
  "ShiftDetails",
  "Emergency",
  "HistoryDetail",
  "Salary",
  "Notifications",
  "NotificationPreferences",
  "Supervisor",
  "Approvals",
  "AttendanceReview",
  "LiveOperations",
  "OnboardingReview",
  "SupervisorIssue",
  "OfflineReview",
];

type Listener = () => void;

/** A screen's navigation: a stack screen by default; `focus()` / `blur()` replay the navigator's events. */
function makeNavigation(state: { type: string; routeNames: string[] } = { type: "stack", routeNames: ROOT_ROUTES }, parent?: object) {
  const listeners: Record<string, Listener[]> = {};
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: jest.fn(() => true),
    isFocused: jest.fn(() => true),
    getState: jest.fn(() => state),
    getParent: jest.fn(() => parent),
    addListener: jest.fn((event: string, listener: Listener) => {
      (listeners[event] ??= []).push(listener);
      return () => {
        listeners[event] = (listeners[event] ?? []).filter((l) => l !== listener);
      };
    }),
    emit: (event: string) => (listeners[event] ?? []).forEach((listener) => listener()),
  };
}

let navigation: ReturnType<typeof makeNavigation>;

function notification(overrides: Partial<NotificationItem> & Pick<NotificationItem, "id" | "type">): NotificationItem {
  return { title: "English title", body: "English body", dataJson: {}, readAt: null, createdAt: "2026-10-15T07:00:00.000Z", subjectId: null, action: null, handled: null, ...overrides };
}

// One entry to review: the clock-out, then "awaiting approval" (the newest); both unread.
const ENTRY_OUT = notification({
  id: "n-out",
  type: "WORKER_CLOCKED_OUT",
  createdAt: "2026-10-15T07:00:00.000Z",
  dataJson: { timeEntryId: "te-1", shiftTitle: "صيانة إشارات", workerName: "خالد حداد", durationMinutes: 540 },
  subjectId: "subj-entry",
  action: { kind: "REVIEW_ATTENDANCE", timeEntryId: "te-1", workerProfileId: "wp-1" },
});
const ENTRY_WAITING = notification({
  id: "n-waiting",
  type: "SHIFT_AWAITING_APPROVAL",
  createdAt: "2026-10-15T08:00:00.000Z",
  dataJson: { timeEntryId: "te-1", shiftTitle: "صيانة إشارات", workerName: "خالد حداد" },
  subjectId: "subj-entry",
  action: { kind: "REVIEW_ATTENDANCE", timeEntryId: "te-1", workerProfileId: "wp-1" },
});
const LONG_OPEN = notification({
  id: "n-open",
  type: "OVERTIME_THRESHOLD_CROSSED",
  createdAt: "2026-10-15T06:00:00.000Z",
  dataJson: { timeEntryId: "te-open", shiftTitle: "حفريات", workerName: "سامي", openMinutes: 545 },
  subjectId: "subj-open",
  action: { kind: "OPEN_ENTRY", timeEntryId: "te-open", workerProfileId: "wp-3" },
});
const ONBOARDING = notification({
  id: "n-onboarding",
  type: "ONBOARDING_SUBMITTED",
  createdAt: "2026-10-15T05:00:00.000Z",
  dataJson: { workerProfileId: "wp-new", workerName: "منى" },
  subjectId: "subj-onboarding",
  action: { kind: "REVIEW_ONBOARDING", workerProfileId: "wp-new" },
});
const ISSUE = notification({
  id: "n-issue",
  type: "TEMPORARY_SUPERVISOR_ISSUE_REPORTED",
  createdAt: "2026-10-15T04:00:00.000Z",
  dataJson: { assignmentId: "as-1", shiftTitle: "حفريات", workerName: "يوسف", issueText: "نقص في المعدات" },
  subjectId: "subj-issue",
  action: { kind: "RESOLVE_SUPERVISOR_ISSUE", issueId: "iss-1" },
});
// The newest of all, but already settled by another manager: it sinks below the open ones.
const OFFLINE = notification({
  id: "n-offline",
  type: "OFFLINE_EVENT_REJECTED",
  createdAt: "2026-10-15T09:00:00.000Z",
  readAt: "2026-10-15T09:05:00.000Z",
  dataJson: { workerProfileId: "wp-2", workerName: "رامي", flaggedCount: 0, rejectedCount: 2 },
  subjectId: "subj-offline",
  action: { kind: "REVIEW_OFFLINE", workerProfileId: "wp-2" },
  handled: { at: "2026-10-15T09:30:00.000Z", by: { userId: "u-9", fullLegalName: "سارة لوي" }, outcome: "REVIEWED", note: "تواصلت مع العامل" },
});
// Information only.
const CLOCKED_IN = notification({
  id: "n-in",
  type: "WORKER_CLOCKED_IN",
  createdAt: "2026-10-15T07:30:00.000Z",
  dataJson: { timeEntryId: "te-1", shiftTitle: "صيانة إشارات", workerName: "خالد حداد", clockInAt: "2026-10-15T05:00:00.000Z" },
});

const ALL = [ENTRY_OUT, ENTRY_WAITING, LONG_OPEN, ONBOARDING, ISSUE, OFFLINE, CLOCKED_IN];

const FSI = "⁨";
const PDI = "⁩";
const iso = (value: string) => `${FSI}${value}${PDI}`;

const TITLES = {
  entry: "حضور بانتظار الموافقة",
  entryOlder: "إنهاء دوام",
  longOpen: "بدء الساعات الإضافية",
  onboarding: "طلب انضمام جديد",
  issue: "بلاغ من مشرف مؤقت",
  offline: "رُفضت سجلات حضور دون اتصال",
  clockedIn: "بدء دوام",
};

function renderScreen(nav: ReturnType<typeof makeNavigation> = navigation, routeName = "Notifications") {
  return renderInArabic(
    <NotificationsScreen
      navigation={nav as unknown as Navigation}
      route={{ key: `${routeName}-1`, name: routeName as "Notifications", params: undefined }}
    />,
  );
}

const actionTab = () => screen.getByRole("tab", { name: ar.notifications.tabAction });
const infoTab = () => screen.getByRole("tab", { name: ar.notifications.tabInfo });

beforeEach(() => {
  navigation = makeNavigation();
  mockAccess.isManager = true;
  mockSync.isOnline = true;
  mockClient.listNotifications.mockResolvedValue(ALL);
  mockClient.markNotificationRead.mockResolvedValue({ success: true });
  mockClient.markAllNotificationsRead.mockResolvedValue({ updated: 6 });
});

describe("NotificationsScreen for a member who manages (mobile manager mode)", () => {
  it("shows «تحتاج إجراء» first, with how many are open, and «للعلم» with the rest", async () => {
    await renderScreen();
    expect(await screen.findByText(TITLES.entry)).toBeOnTheScreen();

    expect(actionTab()).toBeSelected();
    expect(infoTab()).not.toBeSelected();
    // Entry, long-open entry, application, report: open. The offline review is settled.
    expect(actionTab()).toHaveAccessibilityValue({ text: "بانتظار الإجراء: 4" });
    expect(screen.queryByText(TITLES.clockedIn)).not.toBeOnTheScreen();
    for (const title of [TITLES.entry, TITLES.longOpen, TITLES.onboarding, TITLES.issue, TITLES.offline]) expect(screen.getByText(title)).toBeOnTheScreen();
    // The unread count and "mark all read" cover every notification.
    expect(screen.getByText("غير مقروءة: 6")).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(infoTab());
    expect(infoTab()).toBeSelected();
    expect(screen.getByText(TITLES.clockedIn)).toBeOnTheScreen();
    expect(screen.queryByText(TITLES.entry)).not.toBeOnTheScreen();
    expect(screen.queryByText(TITLES.offline)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("groups the notifications about the same subject: the newest one's text and time, and ×N", async () => {
    await renderScreen();
    expect(await screen.findByText(TITLES.entry)).toBeOnTheScreen();

    expect(screen.getByText(`${iso("خالد حداد")}: الحضور في وردية «${iso("صيانة إشارات")}» بانتظار الموافقة.`)).toBeOnTheScreen();
    expect(screen.queryByText(TITLES.entryOlder)).not.toBeOnTheScreen();
    expect(screen.getByText("×2")).toBeOnTheScreen();
    // Only that row stands for several.
    expect(screen.getAllByText(/^×/)).toHaveLength(1);
    // The time of the newest (Asia/Jerusalem), not of the older one.
    expect(screen.getByText("15 أكتوبر 2026 في 11:00")).toBeOnTheScreen();
    expect(screen.queryByText("15 أكتوبر 2026 في 10:00")).not.toBeOnTheScreen();
    // A grouped row is unread while any of its notifications is.
    expect(screen.getAllByText(ar.notifications.unread)).toHaveLength(4);
  });

  it("says in Arabic what each row asks for", async () => {
    await renderScreen();
    expect(await screen.findByText(ar.notifications.actions.REVIEW_ATTENDANCE)).toBeOnTheScreen();
    expect(screen.getByText("تواصل مع العامل: الدوام مفتوح منذ أكثر من 9 س 5 د")).toBeOnTheScreen();
    expect(screen.getByText(ar.notifications.actions.REVIEW_ONBOARDING)).toBeOnTheScreen();
    expect(screen.getByText(ar.notifications.actions.RESOLVE_SUPERVISOR_ISSUE)).toBeOnTheScreen();
    // Settled: who did it instead of what to do.
    expect(screen.queryByText(ar.notifications.actions.REVIEW_OFFLINE)).not.toBeOnTheScreen();
  });

  it("shows who settled a row, when and how, below the open ones", async () => {
    await renderScreen();
    expect(await screen.findByText(TITLES.offline)).toBeOnTheScreen();

    expect(screen.getByText(`تمت المعالجة بواسطة ${iso("سارة لوي")} في 15 أكتوبر 2026 في 12:30`)).toBeOnTheScreen();
    expect(screen.getByText("النتيجة: تمت المراجعة")).toBeOnTheScreen();
    expect(screen.getByText(`ملاحظة: ${iso("تواصلت مع العامل")}`)).toBeOnTheScreen();
    // The offline text says what happened: two records refused, none to review.
    expect(screen.getByText(`رُفضت 2 من سجلات حضور ${iso("رامي")} المسجّلة دون اتصال.`)).toBeOnTheScreen();

    // Newest first among the open rows; the settled one (the newest of all) last.
    const strings = renderedStrings();
    const positions = [TITLES.entry, TITLES.longOpen, TITLES.onboarding, TITLES.issue, TITLES.offline].map((title) => strings.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expectArabicOnly();
  });

  it("marks every unread notification of a row read and opens the review with its subject", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByText(TITLES.entry));

    expect(mockClient.markNotificationRead).toHaveBeenCalledTimes(2);
    expect(mockClient.markNotificationRead).toHaveBeenCalledWith("n-waiting");
    expect(mockClient.markNotificationRead).toHaveBeenCalledWith("n-out");
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "te-1", subjectId: "subj-entry" });
    expect(screen.getByText("غير مقروءة: 4")).toBeOnTheScreen();
    expect(mockReport).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "n-out", readAt: expect.any(String) })]));
  });

  it("opens each action's screen with the ids it needs", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByText(TITLES.longOpen));
    expect(navigation.navigate).toHaveBeenLastCalledWith("AttendanceReview", { timeEntryId: "te-open", subjectId: "subj-open" });

    await fireEvent.press(screen.getByText(TITLES.onboarding));
    expect(navigation.navigate).toHaveBeenLastCalledWith("OnboardingReview", { workerProfileId: "wp-new", subjectId: "subj-onboarding" });

    await fireEvent.press(screen.getByText(TITLES.issue));
    expect(navigation.navigate).toHaveBeenLastCalledWith("SupervisorIssue", { issueId: "iss-1", subjectId: "subj-issue" });

    // Settled and already read: no request, straight to the screen.
    mockClient.markNotificationRead.mockClear();
    await fireEvent.press(screen.getByText(TITLES.offline));
    expect(mockClient.markNotificationRead).not.toHaveBeenCalled();
    // The worker's name comes from the notification (the review screen shows it).
    expect(navigation.navigate).toHaveBeenLastCalledWith("OfflineReview", { workerProfileId: "wp-2", subjectId: "subj-offline", workerName: "رامي" });
  });

  it("keeps today's behavior for a row only for information: marked read, nothing else opens", async () => {
    await renderScreen();
    await screen.findByText(TITLES.entry);
    await fireEvent.press(infoTab());
    await fireEvent.press(screen.getByText(TITLES.clockedIn));

    expect(mockClient.markNotificationRead).toHaveBeenCalledWith("n-in");
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("keeps the row unread and stays on the list when marking it read fails", async () => {
    mockClient.markNotificationRead.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await fireEvent.press(await screen.findByText(TITLES.entry));

    expect(await screen.findByText(ar.notifications.markReadFailed)).toBeOnTheScreen();
    expect(screen.getByText("غير مقروءة: 6")).toBeOnTheScreen();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("as the «الإشعارات» tab: no back button, and the review screens of the root stack still open", async () => {
    const root = { getState: () => ({ type: "stack", routeNames: ROOT_ROUTES }), getParent: () => undefined };
    const tab = makeNavigation({ type: "tab", routeNames: ["ManageTab", "MyWorkTab", "NotificationsTab"] }, root);
    await renderScreen(tab, "NotificationsTab");
    await fireEvent.press(await screen.findByText(TITLES.entry));

    // A tab can "go back" to the first tab: still no back button on the tab root.
    expect(screen.queryByRole("button", { name: ar.common.back })).not.toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.common.notifications })).toBeOnTheScreen();
    expect(tab.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "te-1", subjectId: "subj-entry" });
    // The preferences stay one tap away.
    await fireEvent.press(screen.getByRole("button", { name: ar.notifications.openPreferences }));
    expect(tab.navigate).toHaveBeenLastCalledWith("NotificationPreferences");
  });

  it("as a stack screen: a back button when it can go back", async () => {
    await renderScreen();
    await screen.findByText(TITLES.entry);
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("as a stack screen that cannot go back: no back button", async () => {
    navigation.canGoBack.mockReturnValue(false);
    await renderScreen();
    await screen.findByText(TITLES.entry);
    expect(screen.queryByRole("button", { name: ar.common.back })).not.toBeOnTheScreen();
  });

  it("does not open a review screen this member's app does not have: the list stays", async () => {
    navigation = makeNavigation({ type: "stack", routeNames: ROOT_ROUTES.filter((name) => name !== "OnboardingReview") });
    await renderScreen();
    await fireEvent.press(await screen.findByText(TITLES.onboarding));
    expect(mockClient.markNotificationRead).toHaveBeenCalledWith("n-onboarding");
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("reloads when it comes back into focus (a settled entry shows who settled it)", async () => {
    await renderScreen();
    await screen.findByText(TITLES.entry);
    expect(mockClient.listNotifications).toHaveBeenCalledTimes(1);

    // The focus event that follows the first render does not load twice.
    await act(async () => navigation.emit("focus"));
    expect(mockClient.listNotifications).toHaveBeenCalledTimes(1);

    const approved = { at: "2026-10-15T10:00:00.000Z", by: { userId: "u-2", fullLegalName: "مدير آخر" }, outcome: "APPROVED" as const, note: null };
    mockClient.listNotifications.mockResolvedValue(ALL.map((n) => (n.subjectId === "subj-entry" ? { ...n, readAt: "2026-10-15T09:59:00.000Z", handled: approved } : n)));
    await act(async () => navigation.emit("blur"));
    await act(async () => navigation.emit("focus"));

    expect(mockClient.listNotifications).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(`تمت المعالجة بواسطة ${iso("مدير آخر")} في 15 أكتوبر 2026 في 13:00`)).toBeOnTheScreen();
    expect(screen.getByText("النتيجة: تم الاعتماد")).toBeOnTheScreen();
    expect(screen.queryByText(ar.notifications.actions.REVIEW_ATTENDANCE)).not.toBeOnTheScreen();
    expect(actionTab()).toHaveAccessibilityValue({ text: "بانتظار الإجراء: 3" });
  });

  it("says when nothing needs action", async () => {
    mockClient.listNotifications.mockResolvedValue([CLOCKED_IN]);
    await renderScreen();
    expect(await screen.findByText(ar.notifications.emptyActions)).toBeOnTheScreen();
    expect(actionTab().props.accessibilityValue?.text).toBeUndefined();
    expectArabicOnly();

    await fireEvent.press(infoTab());
    expect(screen.getByText(TITLES.clockedIn)).toBeOnTheScreen();
    expect(screen.queryByText(ar.notifications.emptyActions)).not.toBeOnTheScreen();
  });

  it("says when there is nothing for information", async () => {
    mockClient.listNotifications.mockResolvedValue([]);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("tab", { name: ar.notifications.tabInfo }));
    expect(screen.getByText(ar.notifications.emptyInfo)).toBeOnTheScreen();
    expectArabicOnly();
  });
});

describe("NotificationsScreen for a worker (mobile manager mode)", () => {
  it("keeps the single list, without tabs", async () => {
    mockAccess.isManager = false;
    const approved = notification({
      id: "n-approved",
      type: "SHIFT_APPROVED",
      dataJson: { timeEntryId: "te-9", shiftTitle: "صيانة", businessDate: "2026-10-14", approvedRegularMinutes: 540, approvedOvertimeMinutes: 0 },
    });
    const resolved = notification({
      id: "n-resolved",
      type: "TEMPORARY_SUPERVISOR_ISSUE_RESOLVED" as NotificationItem["type"],
      createdAt: "2026-10-15T08:00:00.000Z",
      dataJson: { issueId: "iss-1", assignmentId: "as-1", shiftId: "sh-1", shiftTitle: "حفريات", resolverName: "سارة لوي", note: "وصلت المعدات" },
    });
    mockClient.listNotifications.mockResolvedValue([approved, resolved]);
    await renderScreen();

    expect(await screen.findByText("تمت الموافقة على حضورك")).toBeOnTheScreen();
    expect(screen.getByText("تم حل بلاغك")).toBeOnTheScreen();
    expect(screen.getByText(`تم حل بلاغك عن وردية «${iso("حفريات")}» بواسطة ${iso("سارة لوي")}.\nالملاحظة: ${iso("وصلت المعدات")}`)).toBeOnTheScreen();
    expect(screen.queryByRole("tab")).not.toBeOnTheScreen();
    expect(screen.queryByText(/^×/)).not.toBeOnTheScreen();
    expectArabicOnly();

    // The supervisor's own report, resolved: their supervision screen.
    await fireEvent.press(screen.getByText("تم حل بلاغك"));
    expect(navigation.navigate).toHaveBeenCalledWith("Supervisor", { assignmentId: "as-1" });
  });
});
