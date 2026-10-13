import { AppState } from "react-native";
import { act, render } from "@testing-library/react-native";
import type { NotificationItem } from "@fieldmaster/api-client";
import { NotificationsProvider, UNREAD_REFRESH_INTERVAL_MS, useNotifications } from "../notifications-context";
import { notificationsMock } from "../../../jest/expo-notifications-mock";

const mockClient = { listNotifications: jest.fn() };
const mockAuth = { client: mockClient, isAuthenticated: true };
jest.mock("../auth-context", () => ({ useAuth: () => mockAuth }));

function item(id: string, read: boolean): NotificationItem {
  return { id, type: "SHIFT_APPROVED", title: "Attendance approved", body: "English", dataJson: {}, readAt: read ? "2026-01-15T10:00:00.000Z" : null, createdAt: "2026-01-15T09:00:00.000Z" };
}

let value: ReturnType<typeof useNotifications>;
function Probe() {
  value = useNotifications();
  return null;
}

async function renderProvider() {
  const view = await render(
    <NotificationsProvider>
      <Probe />
    </NotificationsProvider>,
  );
  await act(async () => undefined);
  return view;
}

/** The provider's AppState listener (the app goes to the background or comes back). */
function appStateListener(): (state: string) => void {
  const calls = jest.mocked(AppState.addEventListener).mock.calls;
  return calls[calls.length - 1][1] as (state: string) => void;
}

beforeEach(() => {
  notificationsMock.reset();
  mockAuth.isAuthenticated = true;
  mockClient.listNotifications.mockResolvedValue([item("a", false), item("b", false), item("c", true)]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("NotificationsProvider (unread count)", () => {
  it("counts the unread notifications once signed in", async () => {
    await renderProvider();
    expect(value.unreadCount).toBe(2);
    expect(mockClient.listNotifications).toHaveBeenCalledTimes(1);
  });

  it("is 0 and asks nothing while signed out, and outside the provider", async () => {
    mockAuth.isAuthenticated = false;
    await renderProvider();
    expect(value.unreadCount).toBe(0);
    expect(mockClient.listNotifications).not.toHaveBeenCalled();

    await render(<Probe />);
    expect(value.unreadCount).toBe(0);
    await expect(value.refresh()).resolves.toBeUndefined();
  });

  it("refreshes when the app comes back to the foreground and when a notification arrives", async () => {
    await renderProvider();
    mockClient.listNotifications.mockResolvedValue([item("a", false)]);

    await act(async () => appStateListener()("active"));
    expect(value.unreadCount).toBe(1);

    mockClient.listNotifications.mockResolvedValue([item("a", false), item("d", false), item("e", false)]);
    await act(async () => notificationsMock.receive({ notificationId: "e" }));
    expect(value.unreadCount).toBe(3);
  });

  it("refreshes on an interval while the app is in the foreground only", async () => {
    jest.useFakeTimers();
    await renderProvider();
    expect(mockClient.listNotifications).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(UNREAD_REFRESH_INTERVAL_MS));
    expect(mockClient.listNotifications).toHaveBeenCalledTimes(2);

    await act(async () => appStateListener()("background"));
    await act(async () => jest.advanceTimersByTime(UNREAD_REFRESH_INTERVAL_MS * 3));
    expect(mockClient.listNotifications).toHaveBeenCalledTimes(2);
  });

  it("keeps the last count when a refresh fails (offline)", async () => {
    await renderProvider();
    mockClient.listNotifications.mockRejectedValue(new TypeError("Network request failed"));
    await act(async () => value.refresh());
    expect(value.unreadCount).toBe(2);
  });

  it("takes the count from a list a screen already loaded", async () => {
    await renderProvider();
    await act(async () => value.report([item("a", true), item("b", true), item("c", false)]));
    expect(value.unreadCount).toBe(1);
  });
});
