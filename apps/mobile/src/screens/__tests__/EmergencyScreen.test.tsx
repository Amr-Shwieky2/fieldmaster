import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type EmergencyEligibility } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import { useAuth } from "../../lib/auth-context";
import { getDeviceId } from "../../lib/device-id";
import { resetLocationHistory } from "../../lib/location";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { RootStackParamList } from "../../navigation/types";
import { EmergencyScreen } from "../EmergencyScreen";
import { deferred, expectArabicOnly, fill, freezeDate, renderInArabic } from "./clock-screens-test-utils";

jest.mock("../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: jest.fn() }));
jest.mock("../../lib/device-id", () => ({ getDeviceId: jest.fn() }));
// The minutes before and after come from the organization's rules in force (GET /auth/me): here its original values.
jest.mock("../../lib/access-context", () => ({
  useAccess: () => ({
    workRules: { standardDayMinutes: 540, overtimeThresholdMinutes: 540, emergencyMinutesBefore: 60, emergencyMinutesAfter: 15, clockInEarlyWindowMinutes: 60 },
  }),
}));
jest.mock("expo-location", () => ({
  ...jest.requireActual("expo-location"),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));

type Navigation = NativeStackScreenProps<RootStackParamList, "Emergency">["navigation"];

// 02:10 on 16 January in Jerusalem (winter, UTC+2): a night call-out.
const NOW = "2026-01-16T00:10:00.000Z";
const NOW_MS = new Date(NOW).getTime();

const NIGHT_TURAN = {
  id: "turan-1",
  organizationId: "org-1",
  turanType: "NIGHT_TURAN" as const,
  status: "SCHEDULED" as const,
  startAt: "2026-01-15T20:00:00.000Z",
  endAt: "2026-01-16T04:00:00.000Z",
  notes: null,
  assignedWorkerProfileId: "worker-2",
  backupWorkerProfileId: null,
};
const ELIGIBLE: EmergencyEligibility = { eligible: true, reason: null, turanAssignment: NIGHT_TURAN, activeCallout: null };
const NOT_ELIGIBLE: EmergencyEligibility = { eligible: false, reason: "EMERGENCY_NOT_ELIGIBLE", turanAssignment: null, activeCallout: null };
const POSITION: Location.LocationObject = {
  coords: { latitude: 32.1093, longitude: 34.8555, accuracy: 9, altitude: 12, altitudeAccuracy: null, heading: null, speed: null },
  timestamp: 0,
};
const START_RESULT = {
  timeEntryId: "te-9",
  calloutId: "callout-9",
  actualStartClick: NOW,
  compensatedStart: "2026-01-15T23:10:00.000Z",
  retroactiveMinutes: 60,
  explanation: "Your compensated start time is set to 60 minutes before you pressed Start, per policy.",
};
// Ended at 04:25 (02:25Z), 2 h 15 min after the press.
const END_RESULT = {
  timeEntryId: "te-9",
  actualEndClick: "2026-01-16T02:25:00.000Z",
  compensatedEnd: "2026-01-16T02:40:00.000Z",
  actualWorkedMinutes: 135,
  retroactiveMinutes: 60,
  returnBufferMinutes: 15,
  compensatedDurationMinutes: 210,
};

/** "+60" / "+15" sit in a left-to-right isolate inside the Arabic text, so the sign stays on the left of the number. */
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const RETRO = fill(ar.emergency.retroBadge, { amount: `${LRI}+60${PDI}` });
const RETURN = fill(ar.emergency.returnBadge, { amount: `${LRI}+15${PDI}` });
const withoutIsolates = (text: string) => text.split(LRI).join("").split(PDI).join("");

let client: { getEmergencyEligibility: jest.Mock; startEmergencyCallout: jest.Mock; endEmergencyCallout: jest.Mock };
let online: boolean;
let navigation: { navigate: jest.Mock; goBack: jest.Mock; popTo: jest.Mock };

beforeEach(() => {
  // Only Date is frozen (timers stay real): device timestamps, idempotency keys and the timer are exact.
  freezeDate(NOW);
  resetLocationHistory();
  online = true;
  client = {
    getEmergencyEligibility: jest.fn(async () => ELIGIBLE),
    startEmergencyCallout: jest.fn(async () => START_RESULT),
    endEmergencyCallout: jest.fn(async () => END_RESULT),
  };
  navigation = { navigate: jest.fn(), goBack: jest.fn(), popTo: jest.fn() };
  const session = { client };
  jest.mocked(useAuth).mockImplementation(() => session as unknown as ReturnType<typeof useAuth>);
  jest.mocked(useOfflineSync).mockImplementation(() => ({ isOnline: online, pendingCount: 0, queue: [], queueOfflineEvent: jest.fn(), syncNow: jest.fn() }) as unknown as ReturnType<typeof useOfflineSync>);
  jest.mocked(getDeviceId).mockResolvedValue("device-1");
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" });
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(POSITION);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

function renderScreen() {
  return renderInArabic(<EmergencyScreen navigation={navigation as unknown as Navigation} route={{ key: "Emergency-1", name: "Emergency", params: undefined }} />);
}

/** The value of a breakdown line (its last text). */
const lineValue = (testID: string) => {
  const texts = within(screen.getByTestId(testID)).getAllByText(/./);
  return texts[texts.length - 1].props.children as string;
};

async function startCallout() {
  await fireEvent.press(await screen.findByRole("button", { name: ar.emergency.start }));
  await fireEvent.press(screen.getByRole("button", { name: ar.emergency.confirmYes }));
  return screen.findByTestId("emergency-running");
}

describe("EmergencyScreen (Arabic, RTL)", () => {
  it("shows the loading state while eligibility loads", async () => {
    client.getEmergencyEligibility.mockReturnValue(new Promise(() => undefined));
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.emergency.title })).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the load error in Arabic and retries", async () => {
    client.getEmergencyEligibility.mockRejectedValueOnce(new ApiRequestError(500, { statusCode: 500, code: "INTERNAL_ERROR", message: "boom", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(`${ar.emergency.loadError}\n${ar.errors.INTERNAL_ERROR}`)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(ar.emergency.eligible)).toBeOnTheScreen();
    expect(client.getEmergencyEligibility).toHaveBeenCalledTimes(2);
  });

  it("not eligible: says why in Arabic, with no start button", async () => {
    client.getEmergencyEligibility.mockResolvedValue(NOT_ELIGIBLE);
    await renderScreen();
    expect(await screen.findByText(ar.emergency.notEligible)).toBeOnTheScreen();
    expect(screen.getByText("لا يمكن بدء استدعاء طوارئ الآن: لا توجد مناوبة ليلية نشطة.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.emergency.start })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("not eligible while a shift is open: asks to end the shift first", async () => {
    client.getEmergencyEligibility.mockResolvedValue({ ...NOT_ELIGIBLE, reason: "ACTIVE_TIME_ENTRY_EXISTS", turanAssignment: NIGHT_TURAN });
    await renderScreen();
    expect(await screen.findByText(ar.emergency.activeEntryExists)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.emergency.turan, { start: "15 يناير 2026 في 22:00", end: "16 يناير 2026 في 06:00" }))).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.emergency.start })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("eligible: explains «+60 دقيقة قبل البدء» before starting, and asks for confirmation", async () => {
    await renderScreen();
    expect(await screen.findByText(ar.emergency.eligible)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.emergency.turan, { start: "15 يناير 2026 في 22:00", end: "16 يناير 2026 في 06:00" }))).toBeOnTheScreen();
    expect(screen.getByText(RETRO)).toBeOnTheScreen();
    expect(withoutIsolates(RETRO)).toBe("+60 دقيقة قبل البدء");
    expect(screen.getByText(fill(ar.emergency.confirmBody, { minutes: "60" }))).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.start }));
    expect(client.startEmergencyCallout).not.toHaveBeenCalled();
    const confirm = screen.getByTestId("emergency-confirm");
    expect(within(confirm).getByText(ar.emergency.confirmTitle)).toBeOnTheScreen();
    expect(within(confirm).getByText(RETRO)).toBeOnTheScreen();
    expect(within(confirm).getByText("يُحتسب أجر الاستدعاء من 60 دقيقة قبل لحظة الضغط على زر البدء.")).toBeOnTheScreen();
    expectArabicOnly();

    // Cancel: nothing starts.
    await fireEvent.press(screen.getByRole("button", { name: ar.common.cancel }));
    expect(screen.queryByTestId("emergency-confirm")).not.toBeOnTheScreen();
    expect(client.startEmergencyCallout).not.toHaveBeenCalled();
  });

  it("starts with the location and only the fields the API takes, then shows a live timer", async () => {
    await renderScreen();
    await startCallout();

    const key = `emergency-start-${NOW_MS}`;
    expect(client.startEmergencyCallout).toHaveBeenCalledTimes(1);
    // Never a workerProfileId (that is the manager's path), never another worker.
    expect(client.startEmergencyCallout).toHaveBeenCalledWith(
      { turanAssignmentId: "turan-1", deviceId: "device-1", clientEventId: key, deviceTimestamp: NOW, latitude: 32.1093, longitude: 34.8555, accuracyMeters: 9 },
      key,
    );
    expect(screen.getByTestId("emergency-timer")).toHaveTextContent("00:00:00");
    expect(screen.getByText(fill(ar.emergency.startedAt, { time: "16 يناير 2026 في 02:10" }))).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.emergency.compensatedFrom, { time: "16 يناير 2026 في 01:10" }))).toBeOnTheScreen();
    // The API's English explanation is never shown.
    expect(screen.queryByText(/compensated start time/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("opens on the running call-out (from eligibility) with its timer", async () => {
    // Started 1 h 5 min 9 s ago.
    client.getEmergencyEligibility.mockResolvedValue({
      eligible: false,
      reason: "ACTIVE_TIME_ENTRY_EXISTS",
      turanAssignment: NIGHT_TURAN,
      activeCallout: { calloutId: "callout-9", timeEntryId: "te-9", actualStartClick: "2026-01-15T23:04:51.000Z", compensatedStart: "2026-01-15T22:04:51.000Z" },
    });
    await renderScreen();

    expect(await screen.findByTestId("emergency-timer")).toHaveTextContent("01:05:09");
    expect(screen.getByText(ar.emergency.running)).toBeOnTheScreen();
    expect(screen.getByText(RETURN)).toBeOnTheScreen();
    expect(withoutIsolates(RETURN)).toBe("+15 دقيقة للعودة");
    expect(screen.getByText("عند الإنهاء تُضاف 15 دقيقة لوقت العودة.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.emergency.start })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("ends only with a summary: an Arabic error first, without locating or calling the API", async () => {
    await renderScreen();
    await startCallout();

    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.end }));
    expect(screen.getByText(ar.emergency.summaryRequired)).toBeOnTheScreen();
    expect(client.endEmergencyCallout).not.toHaveBeenCalled();
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expectArabicOnly();

    await fireEvent.changeText(screen.getByLabelText(ar.emergency.summaryLabel), "   ");
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.end }));
    expect(client.endEmergencyCallout).not.toHaveBeenCalled();

    // Typing clears the message.
    await fireEvent.changeText(screen.getByLabelText(ar.emergency.summaryLabel), "إصلاح");
    expect(screen.queryByText(ar.emergency.summaryRequired)).not.toBeOnTheScreen();
  });

  it("ends with the summary and shows the breakdown: actual and compensated start and end, and the total", async () => {
    await renderScreen();
    await startCallout();
    await fireEvent.press(screen.getByRole("radio", { name: ar.enums.TaskCategory.TRAFFIC_LIGHT_REPAIR }));
    await fireEvent.changeText(screen.getByLabelText(ar.emergency.summaryLabel), "  أصلحنا إشارة المفترق المعطلة.  ");
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.end }));

    expect(await screen.findByRole("header", { name: ar.emergency.endedTitle })).toBeOnTheScreen();
    const key = `emergency-end-${NOW_MS}`;
    expect(client.endEmergencyCallout).toHaveBeenCalledWith(
      {
        deviceId: "device-1",
        clientEventId: key,
        deviceTimestamp: NOW,
        latitude: 32.1093,
        longitude: 34.8555,
        accuracyMeters: 9,
        summaryText: "أصلحنا إشارة المفترق المعطلة.",
        taskCategory: "TRAFFIC_LIGHT_REPAIR",
      },
      key,
    );

    // All from the server's answers, in Asia/Jerusalem.
    expect(lineValue("emergency-actual-start")).toBe("16 يناير 2026 في 02:10");
    expect(lineValue("emergency-compensated-start")).toBe("16 يناير 2026 في 01:10");
    expect(within(screen.getByTestId("emergency-compensated-start")).getByText(RETRO)).toBeOnTheScreen();
    expect(lineValue("emergency-actual-end")).toBe("16 يناير 2026 في 04:25");
    expect(lineValue("emergency-compensated-end")).toBe("16 يناير 2026 في 04:40");
    expect(within(screen.getByTestId("emergency-compensated-end")).getByText(RETURN)).toBeOnTheScreen();
    expect(lineValue("emergency-actual-worked")).toBe("2 س 15 د");
    expect(lineValue("emergency-compensated-total")).toBe("3 س 30 د");
    expect(screen.getByText(ar.emergency.pendingApproval)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.backHome }));
    expect(navigation.popTo).toHaveBeenCalledWith("Home");
  });

  it("uses the emergency repair category unless another one is chosen", async () => {
    await renderScreen();
    await startCallout();
    expect(screen.getByRole("radio", { name: ar.enums.TaskCategory.EMERGENCY_REPAIR })).toBeChecked();
    await fireEvent.changeText(screen.getByLabelText(ar.emergency.summaryLabel), "فحص");
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.end }));
    await screen.findByTestId("emergency-ended");
    expect(client.endEmergencyCallout.mock.calls[0][0]).toMatchObject({ taskCategory: "EMERGENCY_REPAIR", summaryText: "فحص" });
  });

  it("shows the server's «summary required» next to the summary", async () => {
    client.endEmergencyCallout.mockRejectedValue(new ApiRequestError(400, { statusCode: 400, code: "SUMMARY_REQUIRED", message: "A summary is required", correlationId: "c" }));
    await renderScreen();
    await startCallout();
    await fireEvent.changeText(screen.getByLabelText(ar.emergency.summaryLabel), "عمل");
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.end }));

    expect(await screen.findByText(ar.emergency.summaryRequired)).toBeOnTheScreen();
    expect(screen.queryByText(/A summary is required/)).not.toBeOnTheScreen();
  });

  it("shows the API's refusal in Arabic (never its English message)", async () => {
    client.startEmergencyCallout.mockRejectedValue(
      new ApiRequestError(403, { statusCode: 403, code: "EMERGENCY_NOT_ELIGIBLE", message: "You do not have an active Night Turan", correlationId: "c" }),
    );
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: ar.emergency.start }));
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.confirmYes }));

    expect(await screen.findByText(ar.errors.EMERGENCY_NOT_ELIGIBLE)).toBeOnTheScreen();
    expect(screen.queryByText(/Night Turan/)).not.toBeOnTheScreen();
    expect(screen.queryByTestId("emergency-running")).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("explains a refused location permission without calling the API", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: "never" });
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: ar.emergency.start }));
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.confirmYes }));

    expect(await screen.findByText(ar.location.actionPermissionDenied)).toBeOnTheScreen();
    expect(client.startEmergencyCallout).not.toHaveBeenCalled();
  });

  it("shows what it is doing while starting, and blocks a second press", async () => {
    const request = deferred<typeof START_RESULT>();
    client.startEmergencyCallout.mockReturnValue(request.promise);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: ar.emergency.start }));
    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(screen.getByRole("button", { name: ar.emergency.confirmYes }));

    const busy = await screen.findByRole("button", { name: ar.emergency.starting });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("button", { name: ar.common.cancel })).toBeDisabled();
    await act(async () => request.resolve(START_RESULT));
    await pressing;
    expect(await screen.findByTestId("emergency-running")).toBeOnTheScreen();
    expect(client.startEmergencyCallout).toHaveBeenCalledTimes(1);
  });

  it("offline: the call-out needs the network, so starting is switched off and says why", async () => {
    online = false;
    await renderScreen();
    expect(await screen.findByText(ar.emergency.offline)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.emergency.start })).toBeDisabled();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("a request that finds no connection says the call-out needs the network", async () => {
    client.startEmergencyCallout.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: ar.emergency.start }));
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.confirmYes }));
    expect(await screen.findByText(ar.emergency.offline)).toBeOnTheScreen();
  });

  it("calls only the caller's own emergency endpoints", async () => {
    await renderScreen();
    await startCallout();
    await fireEvent.changeText(screen.getByLabelText(ar.emergency.summaryLabel), "عمل");
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.end }));
    await screen.findByTestId("emergency-ended");

    expect(client.getEmergencyEligibility).toHaveBeenCalledWith();
    for (const call of [...client.startEmergencyCallout.mock.calls, ...client.endEmergencyCallout.mock.calls]) {
      expect(call[0]).not.toHaveProperty("workerProfileId");
    }
  });
});
