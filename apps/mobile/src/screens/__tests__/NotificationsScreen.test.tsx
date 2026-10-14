import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type NotificationItem } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { NotificationsScreen } from "../NotificationsScreen";
import { deferred, expectArabicOnly, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { listNotifications: jest.fn(), markNotificationRead: jest.fn(), markAllNotificationsRead: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "WORKER", workerProfileId: "worker-1" } }) }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));
const mockReport = jest.fn();
jest.mock("../../lib/notifications-context", () => ({ useNotifications: () => ({ unreadCount: 0, refresh: jest.fn(), report: mockReport }) }));

type Navigation = NativeStackScreenProps<RootStackParamList, "Notifications">["navigation"];
const ROUTES = ["Home", "ShiftDetails", "Emergency", "History", "HistoryDetail", "Salary", "Notifications", "NotificationPreferences", "Supervisor", "OfflineQueue"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock; getState: jest.Mock };

function notification(overrides: Partial<NotificationItem> & Pick<NotificationItem, "id" | "type">): NotificationItem {
  return { title: "Attendance approved", body: "Your clocked shift has been approved.", dataJson: {}, readAt: null, createdAt: "2026-01-15T08:30:00.000Z", ...overrides };
}

const APPROVED = notification({
  id: "n-approved",
  type: "SHIFT_APPROVED",
  dataJson: { timeEntryId: "te-1", shiftId: "sh-1", shiftTitle: "صيانة إشارات شارع يافا", businessDate: "2026-01-15", approvedRegularMinutes: 540, approvedOvertimeMinutes: 30 },
});
const PAYROLL = notification({ id: "n-payroll", type: "PAYROLL_FINALIZED", title: "Payroll finalized", body: "English", dataJson: { yearMonth: "2026-09" }, readAt: "2026-10-01T08:00:00.000Z", createdAt: "2026-10-01T07:00:00.000Z" });
const WELCOME = notification({ id: "n-welcome", type: "WORKER_APPROVED", title: "Your application was approved", body: "Welcome to the team.", createdAt: "2026-01-10T07:00:00.000Z" });

function renderScreen() {
  return renderInArabic(<NotificationsScreen navigation={navigation as unknown as Navigation} route={{ key: "Notifications-1", name: "Notifications", params: undefined }} />);
}

beforeEach(() => {
  navigation = { navigate: jest.fn(), goBack: jest.fn(), getState: jest.fn(() => ({ routeNames: ROUTES })) };
  mockSync.isOnline = true;
  mockClient.listNotifications.mockResolvedValue([WELCOME, APPROVED, PAYROLL]);
  mockClient.markNotificationRead.mockResolvedValue({ success: true });
  mockClient.markAllNotificationsRead.mockResolvedValue({ updated: 2 });
});

describe("NotificationsScreen (Arabic, RTL)", () => {
  it("shows the loading state, then every notification in Arabic built from its type and data (never the stored English)", async () => {
    const list = deferred<NotificationItem[]>();
    mockClient.listNotifications.mockReturnValue(list.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.common.notifications })).toBeOnTheScreen();

    await act(async () => list.resolve([WELCOME, APPROVED, PAYROLL]));
    expect(screen.getByText("تمت الموافقة على حضورك")).toBeOnTheScreen();
    expect(screen.getByText("وردية «⁨صيانة إشارات شارع يافا⁩» بتاريخ 15 يناير 2026.\nساعات عادية: 9 س 0 د\nساعات إضافية: 0 س 30 د")).toBeOnTheScreen();
    expect(screen.getByText("اعتُمدت الرواتب نهائياً")).toBeOnTheScreen();
    expect(screen.getByText("تمت الموافقة على طلب انضمامك")).toBeOnTheScreen();
    // Jerusalem times, Western digits.
    expect(screen.getByText("15 يناير 2026 في 10:30")).toBeOnTheScreen();
    expect(screen.queryByText(/Attendance approved|Payroll finalized|Welcome/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("lists the newest first, marks the unread ones and counts them", async () => {
    await renderScreen();
    await screen.findByText("تمت الموافقة على حضورك");

    const titles = ["اعتُمدت الرواتب نهائياً", "تمت الموافقة على حضورك", "تمت الموافقة على طلب انضمامك"];
    const strings = renderedStrings();
    const positions = titles.map((title) => strings.indexOf(title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(screen.getAllByText(ar.notifications.unread)).toHaveLength(2);
    expect(screen.getByText("غير مقروءة: 2")).toBeOnTheScreen();
    expect(mockReport).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "n-approved", readAt: null })]));
  });

  it("opens a notification's screen and marks it read (the same mapping as a tapped push)", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByText("تمت الموافقة على حضورك"));

    expect(mockClient.markNotificationRead).toHaveBeenCalledWith("n-approved");
    expect(navigation.navigate).toHaveBeenCalledWith("HistoryDetail", { timeEntryId: "te-1" });
    expect(screen.getByText("غير مقروءة: 1")).toBeOnTheScreen();
    expect(mockReport).toHaveBeenLastCalledWith(expect.arrayContaining([expect.objectContaining({ id: "n-approved", readAt: expect.any(String) })]));

    await fireEvent.press(screen.getByText("اعتُمدت الرواتب نهائياً"));
    // Already read: no second request, straight to the month.
    expect(mockClient.markNotificationRead).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenLastCalledWith("Salary", { yearMonth: "2026-09" });
  });

  it("only marks read a notification that leads nowhere else", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByText("تمت الموافقة على طلب انضمامك"));
    expect(mockClient.markNotificationRead).toHaveBeenCalledWith("n-welcome");
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("keeps it unread and says so in Arabic when marking it read fails", async () => {
    mockClient.markNotificationRead.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await fireEvent.press(await screen.findByText("تمت الموافقة على طلب انضمامك"));
    expect(await screen.findByText(ar.notifications.markReadFailed)).toBeOnTheScreen();
    expect(screen.getAllByText(ar.notifications.unread)).toHaveLength(2);
    expect(navigation.navigate).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("marks everything read", async () => {
    await renderScreen();
    await screen.findByText("تمت الموافقة على حضورك");
    await fireEvent.press(screen.getByRole("button", { name: ar.notifications.markAllRead }));

    expect(mockClient.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(ar.notifications.unread)).not.toBeOnTheScreen();
    expect(screen.getByText(ar.notifications.allRead)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.notifications.markAllRead })).toBeDisabled();
  });

  it("opens the notification settings", async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole("button", { name: ar.notifications.openPreferences }));
    expect(navigation.navigate).toHaveBeenCalledWith("NotificationPreferences");
  });

  it("shows the empty state", async () => {
    mockClient.listNotifications.mockResolvedValue([]);
    await renderScreen();
    expect(await screen.findByText(ar.notifications.empty)).toBeOnTheScreen();
    expect(screen.getByText(ar.notifications.emptyHint)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows an Arabic error from the API code, never the English message, and retries", async () => {
    mockClient.listNotifications.mockRejectedValueOnce(new ApiRequestError(500, { statusCode: 500, code: "INTERNAL_ERROR", message: "Internal server error", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(`${ar.notifications.loadError}\n${ar.errors.INTERNAL_ERROR}`)).toBeOnTheScreen();
    expect(screen.queryByText(/Internal server error/)).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText("تمت الموافقة على حضورك")).toBeOnTheScreen();
  });

  it("offline: shows the connection banner and the Arabic network error", async () => {
    mockSync.isOnline = false;
    mockClient.listNotifications.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.notifications.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly();
  });
});
