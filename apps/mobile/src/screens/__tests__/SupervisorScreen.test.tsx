import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type SupervisedShift } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import { readLocation } from "../../lib/location";
import type { RootStackParamList } from "../../navigation/types";
import { SupervisorScreen } from "../SupervisorScreen";
import { deferred, expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { getSupervisedShift: jest.fn(), createTemporaryCheckInPoint: jest.fn(), closeTemporaryCheckInPoint: jest.fn(), reportSupervisorIssue: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "WORKER", workerProfileId: "worker-sup" } }) }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));
jest.mock("../../lib/location", () => ({ readLocation: jest.fn() }));
// The work-flow screens' map (WebView + Leaflet): its props are what matters here.
jest.mock("../../components/SiteMap", () => {
  const { View } = jest.requireActual("react-native");
  return { SiteMap: (props: object) => <View testID="supervisor-map" {...props} /> };
});

type Navigation = NativeStackScreenProps<RootStackParamList, "Supervisor">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

const iso = (value: string) => `⁨${value}⁩`;

function shift(overrides: Partial<SupervisedShift> = {}): SupervisedShift {
  return {
    assignment: { id: "as-1", activatedAt: "2026-01-15T05:00:00.000Z", expiresAt: "2026-01-15T16:00:00.000Z", canOpenCheckInPoints: true },
    shift: {
      id: "shift-1",
      title: "تقاطع تل أبيب المركزي",
      shiftType: "STANDARD",
      status: "ACTIVE",
      scheduledStart: "2026-01-15T05:00:00.000Z",
      scheduledEnd: "2026-01-15T14:00:00.000Z",
      businessDate: "2026-01-15",
      checkInMethod: "GEOFENCED",
      projectName: null,
      site: { name: "تقاطع تل أبيب", latitude: 32.0853, longitude: 34.7818 },
      geofence: { centerLatitude: 32.0853, centerLongitude: 34.7818, radiusMeters: 150 },
    },
    workers: [
      { workerProfileId: "w-1", fullLegalName: "خالد ناصر", presence: "CLOCKED_IN", clockInAt: "2026-01-15T05:10:00.000Z", clockOutAt: null, locationOutcome: "PASSED", flags: ["TEMPORARY_POINT"] },
      { workerProfileId: "w-2", fullLegalName: "كريم حمدان", presence: "NOT_CLOCKED_IN", clockInAt: null, clockOutAt: null, locationOutcome: null, flags: [] },
    ],
    temporaryCheckInPoints: [{ id: "pt-1", name: "البوابة الشمالية", latitude: 32.086, longitude: 34.782, radiusMeters: 100, expiresAt: "2026-01-15T14:00:00.000Z", createdAt: "2026-01-15T06:00:00.000Z" }],
    ...overrides,
  };
}

const READING = { latitude: 32.0861, longitude: 34.7822, accuracy: 6, timestamp: 0, altitude: null, mockLocationState: "UNAVAILABLE", locationSignals: [] };
const inactive = () => new ApiRequestError(403, { statusCode: 403, code: "TEMPORARY_SUPERVISOR_INACTIVE", message: "Not active", correlationId: "c" });

function renderScreen() {
  return renderInArabic(<SupervisorScreen navigation={navigation as unknown as Navigation} route={{ key: "Supervisor-1", name: "Supervisor", params: { assignmentId: "as-1" } }} />);
}

beforeEach(() => {
  for (const fn of Object.values(mockClient)) fn.mockReset();
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockClient.getSupervisedShift.mockResolvedValue(shift());
  mockClient.createTemporaryCheckInPoint.mockResolvedValue({ id: "pt-2" });
  mockClient.closeTemporaryCheckInPoint.mockResolvedValue({ id: "pt-1" });
  mockClient.reportSupervisorIssue.mockResolvedValue({ reportedAt: "2026-01-15T08:00:00.000Z", notifiedCount: 2 });
  jest.mocked(readLocation).mockResolvedValue({ ok: true, reading: READING as never });
});

describe("SupervisorScreen (Arabic, RTL)", () => {
  it("shows the loading state, then the shift and its workers with their status (no money, no phone numbers)", async () => {
    const answer = deferred<SupervisedShift>();
    mockClient.getSupervisedShift.mockReturnValue(answer.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    await act(async () => answer.resolve(shift()));

    expect(mockClient.getSupervisedShift).toHaveBeenCalledWith("as-1");
    expect(screen.getByRole("header", { name: iso("تقاطع تل أبيب المركزي") })).toBeOnTheScreen();
    expect(screen.getByText("من 07:00 إلى 16:00")).toBeOnTheScreen();
    expect(screen.getByText("الصلاحية حتى 15 يناير 2026 في 18:00")).toBeOnTheScreen();
    expect(screen.getByText(iso("خالد ناصر"))).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.ShiftWorkerPresence.CLOCKED_IN)).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.ShiftWorkerPresence.NOT_CLOCKED_IN)).toBeOnTheScreen();
    expect(screen.getByText("بدء الدوام: 07:10")).toBeOnTheScreen();
    expect(screen.getByText(`الموقع: ${ar.enums.LocationValidationStatus.PASSED}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.AttendanceFlag.TEMPORARY_POINT)).toBeOnTheScreen();
    expect(screen.queryByText(/₪|\+972/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the geofence and the open points on the map, and lists the points", async () => {
    await renderScreen();
    const map = await screen.findByTestId("supervisor-map");
    expect(map).toHaveProp("geofence", { latitude: 32.0853, longitude: 34.7818, radiusMeters: 150 });
    expect(map).toHaveProp("points", [{ latitude: 32.086, longitude: 34.782, radiusMeters: 100, name: "البوابة الشمالية" }]);
    expect(screen.getByText(iso("البوابة الشمالية"))).toBeOnTheScreen();
    expect(screen.getByText("تنتهي في 15 يناير 2026 في 16:00")).toBeOnTheScreen();
    expect(screen.getByText("نصف القطر: 100 م")).toBeOnTheScreen();
  });

  it("opens a temporary point at the current location", async () => {
    await renderScreen();
    await screen.findByText(iso("خالد ناصر"));
    await fireEvent.changeText(screen.getByLabelText(ar.supervisor.pointName), "  مدخل الورشة ");
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.openPoint }));

    expect(readLocation).toHaveBeenCalledTimes(1);
    expect(mockClient.createTemporaryCheckInPoint).toHaveBeenCalledWith({ shiftId: "shift-1", name: "مدخل الورشة", latitude: 32.0861, longitude: 34.7822 });
    expect(await screen.findByText(ar.supervisor.pointOpened)).toBeOnTheScreen();
    expect(screen.getByText(`الموقع الحالي: ⁦32.08610, 34.78220⁩`)).toBeOnTheScreen();
    expect(screen.getByTestId("supervisor-map")).toHaveProp("worker", { latitude: 32.0861, longitude: 34.7822, accuracy: 6 });
    expect(mockClient.getSupervisedShift).toHaveBeenCalledTimes(2);
    expectArabicOnly();
  });

  it("names an unnamed point with the time", async () => {
    await renderScreen();
    await screen.findByText(iso("خالد ناصر"));
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.openPoint }));
    expect(mockClient.createTemporaryCheckInPoint.mock.calls[0][0].name).toMatch(/^نقطة مؤقتة \d{2}:\d{2}$/);
  });

  it.each([
    [{ kind: "permission", canAskAgain: true }, ar.supervisor.locationPermission],
    [{ kind: "servicesOff" }, ar.supervisor.locationServicesOff],
    [{ kind: "location" }, ar.supervisor.locationUnavailable],
  ] as const)("explains in Arabic when the location cannot be read (%o)", async (failure, message) => {
    jest.mocked(readLocation).mockResolvedValue({ ok: false, failure } as never);
    await renderScreen();
    await screen.findByText(iso("خالد ناصر"));
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.openPoint }));
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(mockClient.createTemporaryCheckInPoint).not.toHaveBeenCalled();
  });

  it("closes a point", async () => {
    await renderScreen();
    await screen.findByText(iso("البوابة الشمالية"));
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.closePoint }));
    expect(mockClient.closeTemporaryCheckInPoint).toHaveBeenCalledWith("pt-1");
    expect(await screen.findByText(ar.supervisor.pointClosed)).toBeOnTheScreen();
  });

  it("offers no point controls without the permission to open points", async () => {
    mockClient.getSupervisedShift.mockResolvedValue(shift({ assignment: { id: "as-1", activatedAt: "2026-01-15T05:00:00.000Z", expiresAt: "2026-01-15T16:00:00.000Z", canOpenCheckInPoints: false } }));
    await renderScreen();
    expect(await screen.findByText(ar.supervisor.cannotOpenPoints)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.supervisor.openPoint })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.supervisor.closePoint })).not.toBeOnTheScreen();
  });

  it("reports an issue to management: the text is required", async () => {
    await renderScreen();
    await screen.findByText(iso("خالد ناصر"));
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.sendReport }));
    expect(screen.getByText(ar.supervisor.reportIssueRequired)).toBeOnTheScreen();
    expect(mockClient.reportSupervisorIssue).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText(ar.supervisor.reportIssueLabel), "  الإشارة معطلة في المدخل  ");
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.sendReport }));
    expect(mockClient.reportSupervisorIssue).toHaveBeenCalledWith("as-1", "الإشارة معطلة في المدخل");
    expect(await screen.findByText(ar.supervisor.reportSent)).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.supervisor.reportIssueLabel)).toHaveDisplayValue("");
    expectArabicOnly();
  });

  it("shows an Arabic message and nothing else when the assignment is not active", async () => {
    mockClient.getSupervisedShift.mockRejectedValue(inactive());
    await renderScreen();
    expect(await screen.findByText(ar.supervisor.inactiveTitle)).toBeOnTheScreen();
    expect(screen.getByText(ar.errors.TEMPORARY_SUPERVISOR_INACTIVE)).toBeOnTheScreen();
    expect(screen.queryByText(ar.supervisor.workers)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.supervisor.openPoint })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.supervisor.sendReport })).not.toBeOnTheScreen();
    expect(screen.getAllByRole("button")).toHaveLength(1); // back
    expectArabicOnly();
  });

  it("switches to the inactive message when the assignment ends while the screen is open", async () => {
    mockClient.reportSupervisorIssue.mockRejectedValue(inactive());
    await renderScreen();
    await screen.findByText(iso("خالد ناصر"));
    await fireEvent.changeText(screen.getByLabelText(ar.supervisor.reportIssueLabel), "مشكلة");
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.sendReport }));
    expect(await screen.findByText(ar.supervisor.inactiveTitle)).toBeOnTheScreen();
    expect(screen.queryByText(iso("خالد ناصر"))).not.toBeOnTheScreen();
  });

  it("shows the empty states: no workers and no open points", async () => {
    mockClient.getSupervisedShift.mockResolvedValue(shift({ workers: [], temporaryCheckInPoints: [] }));
    await renderScreen();
    expect(await screen.findByText(ar.supervisor.noWorkers)).toBeOnTheScreen();
    expect(screen.getByText(ar.supervisor.noPoints)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.supervisor.closePoint })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("says the assignment was not found (another member's or unknown id)", async () => {
    mockClient.getSupervisedShift.mockRejectedValue(new ApiRequestError(404, { statusCode: 404, code: "NOT_FOUND", message: "Not found", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(ar.supervisor.notFound)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("offline: the connection banner and the Arabic network error with a retry", async () => {
    mockSync.isOnline = false;
    mockClient.getSupervisedShift.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.supervisor.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly();
    await fireEvent.press(within(screen.getByTestId("supervisor")).getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(iso("خالد ناصر"))).toBeOnTheScreen();
  });

  it("shows an error from opening a point in Arabic", async () => {
    mockClient.createTemporaryCheckInPoint.mockRejectedValue(new ApiRequestError(403, { statusCode: 403, code: "TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS", message: "No", correlationId: "c" }));
    await renderScreen();
    await screen.findByText(iso("خالد ناصر"));
    await fireEvent.press(screen.getByRole("button", { name: ar.supervisor.openPoint }));
    expect(await screen.findByText(ar.errors.TEMPORARY_SUPERVISOR_CANNOT_OPEN_POINTS)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.supervisor.shiftHours, { start: "07:00", end: "16:00" }))).toBeOnTheScreen();
  });
});
