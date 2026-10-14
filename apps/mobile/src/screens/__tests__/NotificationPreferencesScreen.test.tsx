import { Platform } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type MyNotificationPreferences } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { NotificationPreferencesScreen } from "../NotificationPreferencesScreen";
import { deferred, expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { getMyNotificationPreferences: jest.fn(), updateMyNotificationPreferences: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient }) }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

type Navigation = NativeStackScreenProps<RootStackParamList, "NotificationPreferences">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

const PREFERENCES: MyNotificationPreferences = {
  preferences: [
    { type: "SHIFT_APPROVED", push: true },
    { type: "SHIFT_REJECTED", push: true },
    { type: "PAYROLL_FINALIZED", push: false },
  ],
};

const switchFor = (type: keyof typeof ar.enums.NotificationType) => screen.getByLabelText(fill(ar.settings.pushLabel, { type: ar.enums.NotificationType[type] }));

function renderScreen() {
  return renderInArabic(
    <NotificationPreferencesScreen navigation={navigation as unknown as Navigation} route={{ key: "NotificationPreferences-1", name: "NotificationPreferences", params: undefined }} />,
  );
}

beforeEach(() => {
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockClient.getMyNotificationPreferences.mockResolvedValue(PREFERENCES);
  mockClient.updateMyNotificationPreferences.mockImplementation(async (input: MyNotificationPreferences) => ({
    preferences: PREFERENCES.preferences.map((p) => input.preferences.find((changed) => changed.type === p.type) ?? p),
  }));
});

describe("NotificationPreferencesScreen (Arabic, RTL)", () => {
  it("shows the loading state, then one push switch per notification type with the shared Arabic labels", async () => {
    const answer = deferred<MyNotificationPreferences>();
    mockClient.getMyNotificationPreferences.mockReturnValue(answer.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();

    await act(async () => answer.resolve(PREFERENCES));
    expect(screen.getByRole("header", { name: ar.settings.notificationsTitle })).toBeOnTheScreen();
    expect(screen.getByText(ar.settings.notificationsHelp)).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.NotificationType.SHIFT_APPROVED)).toBeOnTheScreen();
    expect(screen.getByText("تمت الموافقة على الحضور")).toBeOnTheScreen();
    expect(switchFor("SHIFT_APPROVED")).toHaveProp("value", true);
    expect(switchFor("PAYROLL_FINALIZED")).toHaveProp("value", false);
    expect(screen.getAllByText(ar.settings.pushOn)).toHaveLength(2);
    expect(screen.getByText(ar.settings.pushOff)).toBeOnTheScreen();
    // Push only exists on a phone: no web note here (iOS).
    expect(screen.queryByText(ar.settings.webNote)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("saves one switch at a time (the caller's own preferences)", async () => {
    await renderScreen();
    await screen.findByText(ar.enums.NotificationType.SHIFT_APPROVED);

    await act(async () => fireEvent(switchFor("SHIFT_APPROVED"), "valueChange", false));
    expect(mockClient.updateMyNotificationPreferences).toHaveBeenCalledWith({ preferences: [{ type: "SHIFT_APPROVED", push: false }] });
    expect(switchFor("SHIFT_APPROVED")).toHaveProp("value", false);
    expect(screen.getAllByText(ar.settings.pushOff)).toHaveLength(2);
  });

  it("goes back to the saved value and explains in Arabic when saving fails", async () => {
    mockClient.updateMyNotificationPreferences.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await screen.findByText(ar.enums.NotificationType.SHIFT_APPROVED);

    await act(async () => fireEvent(switchFor("SHIFT_REJECTED"), "valueChange", false));
    expect(switchFor("SHIFT_REJECTED")).toHaveProp("value", true);
    expect(screen.getByText(`${ar.settings.saveFailed} ${ar.errors.network}`)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the empty state", async () => {
    mockClient.getMyNotificationPreferences.mockResolvedValue({ preferences: [] });
    await renderScreen();
    expect(await screen.findByText(ar.settings.empty)).toBeOnTheScreen();
  });

  it("shows an Arabic error from the API code with a retry", async () => {
    mockClient.getMyNotificationPreferences.mockRejectedValueOnce(new ApiRequestError(403, { statusCode: 403, code: "FORBIDDEN", message: "Forbidden resource", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(`${ar.settings.loadError}\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expect(screen.queryByText(/Forbidden resource/)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(ar.enums.NotificationType.SHIFT_APPROVED)).toBeOnTheScreen();
  });

  it("offline: the connection banner and the Arabic network error", async () => {
    mockSync.isOnline = false;
    mockClient.getMyNotificationPreferences.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.settings.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("says on the web that push notifications do not reach the browser", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await renderScreen();
    expect(await screen.findByText(ar.settings.webNote)).toBeOnTheScreen();
  });
});
