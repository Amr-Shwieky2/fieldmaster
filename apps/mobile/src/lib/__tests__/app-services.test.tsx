import { AppState } from "react-native";
import { act, render } from "@testing-library/react-native";
import { AppServices } from "../app-services";
import { registerThisDevice } from "../device-registration";
import { openLinkTarget } from "../linking";
import { notificationsMock } from "../../../jest/expo-notifications-mock";

const mockClient = { markNotificationRead: jest.fn(async () => ({ success: true })) };
const mockAuth = { client: mockClient, isAuthenticated: true, reportDeviceKeyRevoked: jest.fn(async () => undefined) };
const mockSync = { isOnline: true };
const mockNotifications = { unreadCount: 0, refresh: jest.fn(async () => undefined), report: jest.fn() };

jest.mock("../auth-context", () => ({ useAuth: () => mockAuth }));
jest.mock("../offline-sync-context", () => ({ useOfflineSync: () => mockSync }));
jest.mock("../notifications-context", () => ({ useNotifications: () => mockNotifications }));
jest.mock("../device-registration", () => ({ registerThisDevice: jest.fn() }));
jest.mock("../linking", () => ({ ...jest.requireActual("../linking"), openLinkTarget: jest.fn() }));

const element = () => <AppServices />;

beforeEach(() => {
  notificationsMock.reset();
  mockAuth.isAuthenticated = true;
  mockSync.isOnline = true;
  jest.mocked(registerThisDevice).mockResolvedValue("REGISTERED");
});

describe("AppServices: device registration", () => {
  it("registers the device at app start with a session, and again after each sign-in", async () => {
    const view = await render(element());
    await act(async () => undefined);
    expect(registerThisDevice).toHaveBeenCalledTimes(1);
    expect(registerThisDevice).toHaveBeenCalledWith(mockClient);

    mockAuth.isAuthenticated = false;
    await view.rerender(element());
    mockAuth.isAuthenticated = true;
    await view.rerender(element());
    await act(async () => undefined);
    expect(registerThisDevice).toHaveBeenCalledTimes(2);
  });

  it("does not register while signed out", async () => {
    mockAuth.isAuthenticated = false;
    await render(element());
    await act(async () => undefined);
    expect(registerThisDevice).not.toHaveBeenCalled();
  });

  it("tries again when the phone is back online after an offline attempt (not before)", async () => {
    jest.mocked(registerThisDevice).mockResolvedValueOnce("RETRY");
    mockSync.isOnline = false;
    const view = await render(element());
    await act(async () => undefined);
    expect(registerThisDevice).toHaveBeenCalledTimes(1);

    mockSync.isOnline = true;
    await view.rerender(element());
    await act(async () => undefined);
    expect(registerThisDevice).toHaveBeenCalledTimes(2);

    // Done now: going offline and online again does not register again.
    mockSync.isOnline = false;
    await view.rerender(element());
    mockSync.isOnline = true;
    await view.rerender(element());
    await act(async () => undefined);
    expect(registerThisDevice).toHaveBeenCalledTimes(2);
  });

  it("tries again when the app returns to the foreground after a failed attempt", async () => {
    jest.mocked(registerThisDevice).mockResolvedValueOnce("RETRY");
    await render(element());
    await act(async () => undefined);
    const calls = jest.mocked(AppState.addEventListener).mock.calls;
    const listener = calls[calls.length - 1][1] as (state: string) => void;
    await act(async () => listener("active"));
    expect(registerThisDevice).toHaveBeenCalledTimes(2);
  });

  it("hands a revoked key over to the auth provider (clear everything, sign in again)", async () => {
    jest.mocked(registerThisDevice).mockResolvedValueOnce("REVOKED");
    await render(element());
    await act(async () => undefined);
    expect(mockAuth.reportDeviceKeyRevoked).toHaveBeenCalledTimes(1);
  });
});

describe("AppServices: tapped push notifications", () => {
  it("opens the screen of a tapped notification, marks it read and refreshes the unread count", async () => {
    await render(element());
    await act(async () => undefined);

    await act(async () => notificationsMock.tap({ notificationId: "n1", type: "SHIFT_APPROVED", timeEntryId: "te-1" }));
    expect(openLinkTarget).toHaveBeenCalledWith({ name: "HistoryDetail", params: { timeEntryId: "te-1" } });
    expect(mockClient.markNotificationRead).toHaveBeenCalledWith("n1");
    expect(mockNotifications.refresh).toHaveBeenCalled();
  });

  it("opens the notification that started the app", async () => {
    notificationsMock.setLaunchTap({ notificationId: "n2", type: "PAYROLL_FINALIZED", yearMonth: "2026-09" });
    await render(element());
    await act(async () => undefined);
    expect(openLinkTarget).toHaveBeenCalledWith({ name: "Salary", params: { yearMonth: "2026-09" } });
  });

  it("keeps the target for after the sign-in when signed out, without calling the API", async () => {
    mockAuth.isAuthenticated = false;
    await render(element());
    await act(async () => notificationsMock.tap({ notificationId: "n3", type: "SHIFT_REJECTED", timeEntryId: "te-3" }));
    expect(openLinkTarget).toHaveBeenCalledWith({ name: "HistoryDetail", params: { timeEntryId: "te-3" } });
    expect(mockClient.markNotificationRead).not.toHaveBeenCalled();
  });
});
