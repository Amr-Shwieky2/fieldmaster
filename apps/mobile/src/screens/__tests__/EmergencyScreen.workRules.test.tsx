import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { fireEvent, screen, within } from "@testing-library/react-native";
import type { EmergencyEligibility, MyAccess } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import type { AccessValue } from "../../lib/access-context";
import { useAuth } from "../../lib/auth-context";
import { getDeviceId } from "../../lib/device-id";
import { resetLocationHistory } from "../../lib/location";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { RootStackParamList } from "../../navigation/types";
import { EmergencyScreen } from "../EmergencyScreen";
import { expectArabicOnly, fill, freezeDate, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

jest.mock("../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: jest.fn() }));
jest.mock("../../lib/device-id", () => ({ getDeviceId: jest.fn() }));
let mockAccess: Partial<AccessValue> = { workRules: null };
jest.mock("../../lib/access-context", () => ({ useAccess: () => mockAccess }));
jest.mock("expo-location", () => ({
  ...jest.requireActual("expo-location"),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));

type Navigation = NativeStackScreenProps<RootStackParamList, "Emergency">["navigation"];

// 02:10 on 16 January in Jerusalem (winter, UTC+2): a night call-out.
const NOW = "2026-01-16T00:10:00.000Z";

/** The rules in force now, as GET /auth/me gives them (minutes only). */
function rules(emergencyMinutesBefore: number, emergencyMinutesAfter: number): MyAccess["workRules"] {
  return { standardDayMinutes: 540, overtimeThresholdMinutes: 540, emergencyMinutesBefore, emergencyMinutesAfter, clockInEarlyWindowMinutes: 60 };
}

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
/** Started at 01:04:51; the server paid from 45 minutes before the press. */
const RUNNING: EmergencyEligibility = {
  eligible: false,
  reason: "ACTIVE_TIME_ENTRY_EXISTS",
  turanAssignment: NIGHT_TURAN,
  activeCallout: { calloutId: "callout-9", timeEntryId: "te-9", actualStartClick: "2026-01-15T23:04:51.000Z", compensatedStart: "2026-01-15T22:19:51.000Z" },
};
const START_RESULT = {
  timeEntryId: "te-9",
  calloutId: "callout-9",
  actualStartClick: NOW,
  compensatedStart: "2026-01-15T23:25:00.000Z",
  retroactiveMinutes: 45,
  explanation: "Your compensated start time is set to 45 minutes before you pressed Start, per policy.",
};
const END_RESULT = {
  timeEntryId: "te-9",
  actualEndClick: "2026-01-16T02:25:00.000Z",
  compensatedEnd: "2026-01-16T02:45:00.000Z",
  actualWorkedMinutes: 135,
  retroactiveMinutes: 45,
  returnBufferMinutes: 20,
  compensatedDurationMinutes: 200,
};

/** "+45" / "+20" sit in a left-to-right isolate inside the Arabic text. */
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const retro = (minutes: number) => fill(ar.emergency.retroBadge, { amount: `${LRI}+${minutes}${PDI}` });
const back = (minutes: number) => fill(ar.emergency.returnBadge, { amount: `${LRI}+${minutes}${PDI}` });
const withoutIsolates = (text: string) => text.split(LRI).join("").split(PDI).join("");

let client: { getEmergencyEligibility: jest.Mock; startEmergencyCallout: jest.Mock; endEmergencyCallout: jest.Mock };
const navigation = { navigate: jest.fn(), goBack: jest.fn(), popTo: jest.fn() };

function renderScreen() {
  return renderInArabic(<EmergencyScreen navigation={navigation as unknown as Navigation} route={{ key: "Emergency-1", name: "Emergency", params: undefined }} />);
}

/** No assumed default anywhere on screen: neither 60 nor 15 minutes. */
function expectNoFixedMinutes() {
  const text = withoutIsolates(renderedStrings().join("\n"));
  expect(text).not.toMatch(/(^|\D)60 دقيقة/);
  expect(text).not.toMatch(/(^|\D)15 دقيقة/);
  expect(text).not.toMatch(/\+(60|15)(\D|$)/);
}

beforeEach(() => {
  freezeDate(NOW);
  resetLocationHistory();
  mockAccess = { workRules: rules(45, 20) };
  client = {
    getEmergencyEligibility: jest.fn(async () => ELIGIBLE),
    startEmergencyCallout: jest.fn(async () => START_RESULT),
    endEmergencyCallout: jest.fn(async () => END_RESULT),
  };
  const session = { client };
  jest.mocked(useAuth).mockImplementation(() => session as unknown as ReturnType<typeof useAuth>);
  jest.mocked(useOfflineSync).mockImplementation(() => ({ isOnline: true, pendingCount: 0, queue: [], queueOfflineEvent: jest.fn(), syncNow: jest.fn() }) as unknown as ReturnType<typeof useOfflineSync>);
  jest.mocked(getDeviceId).mockResolvedValue("device-1");
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({ status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" });
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue({
    coords: { latitude: 32.1093, longitude: 34.8555, accuracy: 9, altitude: 12, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: 0,
  });
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("EmergencyScreen: the minutes come from the work rules in force (GET /auth/me)", () => {
  it("before the start: «+45 دقيقة قبل البدء» and 45 minutes in the explanation, also when confirming", async () => {
    await renderScreen();
    expect(await screen.findByText(ar.emergency.eligible)).toBeOnTheScreen();
    expect(screen.getByText(retro(45))).toBeOnTheScreen();
    expect(withoutIsolates(retro(45))).toBe("+45 دقيقة قبل البدء");
    expect(screen.getByText("يُحتسب أجر الاستدعاء من 45 دقيقة قبل لحظة الضغط على زر البدء.")).toBeOnTheScreen();
    expectNoFixedMinutes();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.start }));
    const confirm = within(screen.getByTestId("emergency-confirm"));
    expect(confirm.getByText(retro(45))).toBeOnTheScreen();
    expect(confirm.getByText(fill(ar.emergency.confirmBody, { minutes: "45" }))).toBeOnTheScreen();
    expectNoFixedMinutes();
  });

  it("while running: «+20 دقيقة للعودة» from the rules, and the minutes the server applied before the press", async () => {
    client.getEmergencyEligibility.mockResolvedValue(RUNNING);
    await renderScreen();
    const running = within(await screen.findByTestId("emergency-running"));
    expect(running.getByText(retro(45))).toBeOnTheScreen();
    expect(screen.getByText(back(20))).toBeOnTheScreen();
    expect(withoutIsolates(back(20))).toBe("+20 دقيقة للعودة");
    expect(screen.getByText("عند الإنهاء تُضاف 20 دقيقة لوقت العودة.")).toBeOnTheScreen();
    expectNoFixedMinutes();
    expectArabicOnly();
  });

  it("started here: the running card shows the server's minutes, and the breakdown the server's final ones", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: ar.emergency.start }));
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.confirmYes }));
    const running = within(await screen.findByTestId("emergency-running"));
    expect(running.getByText(retro(45))).toBeOnTheScreen();
    expect(running.getByText(fill(ar.emergency.compensatedFrom, { time: "16 يناير 2026 في 01:25" }))).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByLabelText(ar.emergency.summaryLabel), "إصلاح");
    await fireEvent.press(screen.getByRole("button", { name: ar.emergency.end }));
    expect(within(await screen.findByTestId("emergency-compensated-start")).getByText(retro(45))).toBeOnTheScreen();
    expect(within(screen.getByTestId("emergency-compensated-end")).getByText(back(20))).toBeOnTheScreen();
    expectNoFixedMinutes();
  });

  it("rules not known yet: the explanation without any number (never an assumed one), and no badge", async () => {
    mockAccess = { workRules: null };
    await renderScreen();
    expect(await screen.findByText(ar.emergency.confirmBodyUnknown)).toBeOnTheScreen();
    expect(screen.queryByText(/دقيقة قبل البدء/)).not.toBeOnTheScreen();
    expectNoFixedMinutes();
    expectArabicOnly();

    client.getEmergencyEligibility.mockResolvedValue(RUNNING);
    await screen.unmount();
    await renderScreen();
    expect(await screen.findByText(ar.emergency.endBodyUnknown)).toBeOnTheScreen();
    expect(screen.queryByText(/دقيقة للعودة/)).not.toBeOnTheScreen();
    // The running call-out's own minutes are known from the server's times.
    expect(screen.getByText(retro(45))).toBeOnTheScreen();
    expectNoFixedMinutes();
  });

  it("rules of zero minutes: paid from the press, and nothing added for the way back", async () => {
    mockAccess = { workRules: rules(0, 0) };
    await renderScreen();
    expect(await screen.findByText(ar.emergency.confirmBodyFromPress)).toBeOnTheScreen();
    expect(screen.queryByText(/دقيقة قبل البدء/)).not.toBeOnTheScreen();

    client.getEmergencyEligibility.mockResolvedValue({
      ...RUNNING,
      activeCallout: { ...RUNNING.activeCallout!, compensatedStart: RUNNING.activeCallout!.actualStartClick },
    });
    await screen.unmount();
    await renderScreen();
    expect(await screen.findByText(ar.emergency.endBodyNoReturn)).toBeOnTheScreen();
    expect(screen.queryByText(/دقيقة للعودة/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/دقيقة قبل البدء/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });
});
