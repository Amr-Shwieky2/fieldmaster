import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { NetworkError, type MyAccess, type OperationsSnapshot } from "@fieldmaster/api-client";
import { Permission, permissionsForScope, SYSTEM_ROLE_PERMISSIONS } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import type { AccessValue } from "../../lib/access-context";
import { colors } from "../../lib/theme";
import { fitRegion, initialRegionFor } from "../../components/manager/LiveOperationsMap";
import { LIVE_OPERATIONS_REFRESH_MS, LiveOperationsScreen } from "../LiveOperationsScreen";
import { deferred, expectArabicOnly, fill, inArabic, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = { getOperationsLive: jest.fn() };
const mockAuth = { client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } };
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

const AHMAD = { id: "worker-1", fullLegalName: "أحمد خليل" };
const SAMER = { id: "worker-2", fullLegalName: "سامر عودة" };
const RAMI = { id: "worker-3", fullLegalName: "رامي حداد" };
const KHALED = { id: "worker-4", fullLegalName: "خالد ناصر" };
const MAINTENANCE = { id: "shift-1", title: "صيانة شارع يافا", shiftType: "STANDARD" as const };
/** The API's English placeholder title of a call-out shift: shown as the Arabic shift type. */
const CALLOUT = { id: "shift-2", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" as const };
const SIGNALS = { id: "shift-3", title: "تركيب إشارات", shiftType: "STANDARD" as const };
const DIGGING = { id: "shift-4", title: "حفريات", shiftType: "STANDARD" as const };

function snapshot(overrides: Partial<OperationsSnapshot> = {}): OperationsSnapshot {
  return {
    generatedAt: "2026-10-15T09:40:00.000Z",
    workersOnShift: [
      {
        timeEntryId: "entry-1",
        worker: AHMAD,
        shift: MAINTENANCE,
        clockInAt: "2026-10-15T05:00:00.000Z",
        openMinutes: 280,
        isEmergency: false,
        position: { latitude: 32.05, longitude: 34.75, accuracyMeters: 8, at: "2026-10-15T05:00:00.000Z", eventType: "CLOCK_IN", locationValidationStatus: "PASSED" },
      },
      { timeEntryId: "entry-2", worker: SAMER, shift: CALLOUT, clockInAt: "2026-10-15T09:00:00.000Z", openMinutes: 40, isEmergency: true, position: null },
    ],
    sites: [{ siteId: "site-1", name: "مفترق الساعة", centerLatitude: 32.05, centerLongitude: 34.75, radiusMeters: 150 }],
    temporaryPoints: [{ id: "point-1", name: "نقطة الجسر", latitude: 32.07, longitude: 34.77, radiusMeters: 80, expiresAt: "2026-10-15T15:00:00.000Z", shift: MAINTENANCE }],
    activeEmergencies: [
      {
        calloutId: "callout-1",
        timeEntryId: "entry-2",
        worker: SAMER,
        authorizationSource: "NIGHT_TURAN_ASSIGNMENT",
        actualStartClick: "2026-10-15T09:00:00.000Z",
        compensatedStart: "2026-10-15T08:30:00.000Z",
        start: { latitude: 32.06, longitude: 34.76 },
      },
    ],
    activeShifts: [],
    lateWorkers: [{ worker: RAMI, shift: SIGNALS, scheduledStart: "2026-10-15T06:00:00.000Z", graceMinutes: 10, lateMinutes: 25 }],
    longOpenEntries: [],
    recentRejectedAttempts: [
      {
        id: "attempt-1",
        eventType: "CLOCK_IN",
        code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
        at: "2026-10-15T06:30:00.000Z",
        latitude: 32.1,
        longitude: 34.8,
        accuracyMeters: 12,
        distanceMeters: 350.4,
        allowedRadiusMeters: 150,
        requiredAccuracyMeters: null,
        timeEntryId: null,
        worker: RAMI,
        shift: SIGNALS,
      },
    ],
    suspiciousLocations: [
      {
        clockEventId: "event-1",
        eventType: "CLOCK_IN",
        origin: "OFFLINE",
        at: "2026-10-15T07:00:00.000Z",
        latitude: 32,
        longitude: 34.7,
        mockLocationSuspected: true,
        locationValidationStatus: "FLAGGED",
        timeEntryId: "entry-9",
        worker: KHALED,
        shift: DIGGING,
      },
    ],
    offlineReview: [],
    ...overrides,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const realNow = Date.now.bind(Date);
/** Moves "now" to a given instant (the clock keeps running from there). */
function setNow(instant: string) {
  const offset = new Date(instant).getTime() - realNow();
  jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
}

const iso = (value: string) => `⁨${value}⁩`;

type Focus = "onShift" | "late" | "alerts";

function liveElement(focus?: Focus) {
  return (
    <LiveOperationsScreen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      navigation={navigation as any}
      route={{ key: "LiveOperations-1", name: "LiveOperations", params: focus ? { focus } : undefined }}
    />
  );
}

async function renderLive(focus?: Focus) {
  await renderInArabic(liveElement(focus));
  await act(async () => undefined);
}

const row = (testID: string) => within(screen.getByTestId(testID));
const rowKeys = () => (screen.getByTestId("live-operations-list").props.data as { key: string }[]).map((item) => item.key);

async function blur() {
  await act(async () => {
    mockFocus.cleanup?.();
    mockFocus.cleanup = undefined;
  });
}

async function pullToRefresh() {
  const list = screen.getByTestId("live-operations-list");
  await act(async () => {
    await (list.props.refreshControl as { props: { onRefresh: () => Promise<void> } }).props.onRefresh();
  });
}

const networkError = () => new NetworkError(new TypeError("Network request failed"));

beforeEach(() => {
  // 15 October 2026, 12:45 in Jerusalem.
  setNow("2026-10-15T09:45:00.000Z");
  mockClient.getOperationsLive.mockReset();
  mockClient.getOperationsLive.mockResolvedValue(snapshot());
  mockFocus.effect = null;
  mockFocus.cleanup = undefined;
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockAccess = accessFor(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("LiveOperationsScreen (Arabic, RTL)", () => {
  it("shows the loading state, then the map, the three lists' counts and who is on shift now (no money)", async () => {
    const live = deferred<OperationsSnapshot>();
    mockClient.getOperationsLive.mockReturnValueOnce(live.promise);
    await renderLive();
    expect(screen.getByRole("header", { name: ar.liveOperations.title })).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expectArabicOnly();

    await act(async () => live.resolve(snapshot()));
    expect(mockClient.getOperationsLive).toHaveBeenCalledTimes(1);
    expect(mockClient.getOperationsLive).toHaveBeenCalledWith();
    expect(screen.getByText(fill(ar.liveOperations.updatedAt, { time: "12:40" }))).toBeOnTheScreen();

    // The map: a circle per site and temporary point, a pin per worker with a position and per running call-out.
    const map = screen.getByTestId("live-map");
    expect(map.props.accessibilityLabel).toBe(ar.liveOperations.mapLabel);
    const circles = screen.getAllByTestId("map-circle");
    expect(circles).toHaveLength(2);
    expect(circles[0].props.center).toEqual({ latitude: 32.05, longitude: 34.75 });
    expect(circles[0].props.radius).toBe(150);
    expect(circles[0].props.strokeColor).toBe(colors.primary);
    expect(circles[1].props.center).toEqual({ latitude: 32.07, longitude: 34.77 });
    expect(circles[1].props.radius).toBe(80);
    const markers = screen.getAllByTestId("map-marker");
    expect(markers).toHaveLength(2);
    expect(markers[0].props.coordinate).toEqual({ latitude: 32.05, longitude: 34.75 });
    expect(markers[0].props.title).toBe("أحمد خليل");
    expect(markers[0].props.description).toBe(fill(ar.liveOperations.mapWorker, { shift: "صيانة شارع يافا", time: "08:00" }));
    expect(markers[0].props.pinColor).toBe(colors.success);
    expect(markers[1].props.coordinate).toEqual({ latitude: 32.06, longitude: 34.76 });
    expect(markers[1].props.title).toBe("سامر عودة");
    expect(markers[1].props.description).toBe(fill(ar.liveOperations.mapEmergency, { time: "12:00" }));
    expect(markers[1].props.pinColor).toBe(colors.danger);
    // It opens around the workers and the call-out.
    const region = map.props.initialRegion as { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
    expect(region.latitude).toBeCloseTo(32.055, 6);
    expect(region.longitude).toBeCloseTo(34.755, 6);
    expect(region.latitudeDelta).toBeCloseTo(0.014, 6);
    expect(region.longitudeDelta).toBeCloseTo(0.014, 6);

    expect(screen.getByRole("tab", { name: "في الدوام الآن: 2", selected: true })).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "متأخرون: 1", selected: false })).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "تنبيهات الموقع: 2", selected: false })).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "متأخرون: 1" })).toHaveStyle({ minHeight: 56 });

    expect(rowKeys()).toEqual(["on-shift-entry-1", "on-shift-entry-2"]);
    const ahmad = row("live-on-shift-entry-1");
    expect(ahmad.getByText(iso("أحمد خليل"))).toBeOnTheScreen();
    expect(ahmad.getByText(fill(ar.liveOperations.shift, { shift: iso("صيانة شارع يافا") }))).toBeOnTheScreen();
    expect(ahmad.getByText("بدء الدوام: 08:00")).toBeOnTheScreen();
    expect(ahmad.getByText("مدة الدوام حتى الآن: 4 س 40 د")).toBeOnTheScreen();
    expect(ahmad.queryByText(ar.common.emergencyCallout)).not.toBeOnTheScreen();
    const samer = row("live-on-shift-entry-2");
    expect(samer.getByText(ar.common.emergencyCallout)).toBeOnTheScreen();
    expect(samer.getByText(fill(ar.liveOperations.shift, { shift: iso("استدعاء طوارئ") }))).toBeOnTheScreen();
    expect(samer.getByText(ar.liveOperations.noPosition)).toBeOnTheScreen();
    expect(screen.queryByText(iso("رامي حداد"))).not.toBeOnTheScreen();

    expect(screen.queryByText(ar.managerHome.restricted)).not.toBeOnTheScreen();
    expect(renderedStrings().join("\n")).not.toContain("₪");
    expectArabicOnly();
  });

  it("opens on the late workers when asked", async () => {
    await renderLive("late");
    expect(screen.getByRole("tab", { name: "متأخرون: 1", selected: true })).toBeOnTheScreen();
    expect(rowKeys()).toEqual(["late-worker-3-shift-3"]);
    const rami = row("live-late-worker-3-shift-3");
    expect(rami.getByText(iso("رامي حداد"))).toBeOnTheScreen();
    expect(rami.getByText(fill(ar.liveOperations.shift, { shift: iso("تركيب إشارات") }))).toBeOnTheScreen();
    expect(rami.getByText("التأخير: 0 س 25 د")).toBeOnTheScreen();
    expect(rami.getByText("بداية الوردية: 09:00")).toBeOnTheScreen();
    // Nothing to open for a worker who has not clocked in.
    expect(screen.queryByRole("button", { name: /رامي/ })).not.toBeOnTheScreen();
    expect(screen.queryByText(iso("أحمد خليل"))).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("opens on the site alerts when asked: refused attempts with the reason the worker saw, and suspicious locations, newest first", async () => {
    await renderLive("alerts");
    expect(screen.getByRole("tab", { name: "تنبيهات الموقع: 2", selected: true })).toBeOnTheScreen();
    expect(rowKeys()).toEqual(["suspicious-event-1", "rejected-attempt-1"]);

    const refused = row("live-rejected-attempt-1");
    expect(refused.getByText(iso("رامي حداد"))).toBeOnTheScreen();
    expect(refused.getByText(ar.liveOperations.rejectedBadge)).toBeOnTheScreen();
    expect(refused.getByText("رُفضت محاولة بدء الدوام")).toBeOnTheScreen();
    const reason = fill(ar.errors.GEOFENCE_OUTSIDE_ALLOWED_RADIUS, { distanceMeters: "350", allowedRadiusMeters: "150" });
    expect(refused.getByText(fill(ar.liveOperations.rejectedReason, { reason }))).toBeOnTheScreen();
    expect(refused.getByText("سبب الرفض كما ظهر للعامل: أنت خارج نطاق الموقع. المسافة: 350 م، المسموح: 150 م.")).toBeOnTheScreen();
    expect(refused.getByText(fill(ar.liveOperations.shift, { shift: iso("تركيب إشارات") }))).toBeOnTheScreen();
    expect(refused.getByText("الوقت: 09:30")).toBeOnTheScreen();

    const suspicious = row("live-suspicious-event-1");
    expect(suspicious.getByText(iso("خالد ناصر"))).toBeOnTheScreen();
    expect(suspicious.getByText(ar.liveOperations.mock)).toBeOnTheScreen();
    expect(suspicious.getByText("بدء الدوام: موقع وهمي")).toBeOnTheScreen();
    expect(suspicious.getByText(fill(ar.liveOperations.suspiciousWhen, { origin: ar.enums.EventOrigin.OFFLINE, time: "10:00" }))).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows a flagged location's status, a code without an Arabic text as unknown, and an alert of another day with its date", async () => {
    const base = snapshot();
    mockClient.getOperationsLive.mockResolvedValue(
      snapshot({
        recentRejectedAttempts: [{ ...base.recentRejectedAttempts[0], code: "SOME_NEW_CODE", at: "2026-10-14T20:15:00.000Z" }],
        suspiciousLocations: [{ ...base.suspiciousLocations[0], mockLocationSuspected: false, locationValidationStatus: "FLAGGED" }],
      }),
    );
    await renderLive("alerts");
    const refused = row("live-rejected-attempt-1");
    expect(refused.getByText(ar.liveOperations.rejectedNoReason)).toBeOnTheScreen();
    expect(refused.getByText("الوقت: 14 أكتوبر 2026 في 23:15")).toBeOnTheScreen();
    const suspicious = row("live-suspicious-event-1");
    expect(suspicious.getByText(ar.liveOperations.suspiciousBadge)).toBeOnTheScreen();
    expect(suspicious.getByText(`بدء الدوام: ${ar.enums.LocationValidationStatus.FLAGGED}`)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("switches between the lists, each with its empty state", async () => {
    mockClient.getOperationsLive.mockResolvedValue(snapshot({ lateWorkers: [], recentRejectedAttempts: [], suspiciousLocations: [] }));
    await renderLive();
    expect(rowKeys()).toEqual(["on-shift-entry-1", "on-shift-entry-2"]);

    await fireEvent.press(screen.getByRole("tab", { name: "متأخرون: 0" }));
    expect(screen.getByRole("tab", { name: "متأخرون: 0", selected: true })).toBeOnTheScreen();
    expect(screen.getByRole("tab", { name: "في الدوام الآن: 2", selected: false })).toBeOnTheScreen();
    expect(screen.getByText(ar.liveOperations.lateEmpty)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("tab", { name: "تنبيهات الموقع: 0" }));
    expect(screen.getByText(ar.liveOperations.alertsEmpty)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("tab", { name: "في الدوام الآن: 2" }));
    expect(screen.getByTestId("live-on-shift-entry-1")).toBeOnTheScreen();
  });

  it("says when nobody is on shift", async () => {
    mockClient.getOperationsLive.mockResolvedValue(snapshot({ workersOnShift: [], activeEmergencies: [] }));
    await renderLive();
    expect(screen.getByText(ar.liveOperations.onShiftEmpty)).toBeOnTheScreen();
    expect(screen.getByText("لا يوجد أحد في الدوام الآن.")).toBeOnTheScreen();
  });

  it("shows the list asked for when opened again with another focus", async () => {
    const view = await renderInArabic(liveElement("onShift"));
    await act(async () => undefined);
    expect(screen.getByRole("tab", { name: "في الدوام الآن: 2", selected: true })).toBeOnTheScreen();
    await view.rerender(inArabic(liveElement("alerts")));
    expect(screen.getByRole("tab", { name: "تنبيهات الموقع: 2", selected: true })).toBeOnTheScreen();
    expect(screen.getByTestId("live-suspicious-event-1")).toBeOnTheScreen();
  });

  it("opens the entry's review from a worker on shift, a suspicious location or a refused attempt with an entry", async () => {
    const base = snapshot();
    mockClient.getOperationsLive.mockResolvedValue(
      snapshot({ recentRejectedAttempts: [...base.recentRejectedAttempts, { ...base.recentRejectedAttempts[0], id: "attempt-2", eventType: "CLOCK_OUT", timeEntryId: "entry-7" }] }),
    );
    await renderLive();
    const ahmad = screen.getByTestId("live-on-shift-entry-1");
    expect(ahmad).toHaveStyle({ minHeight: 56 });
    expect(screen.getAllByRole("button", { name: /أحمد خليل/ })).toHaveLength(1);
    await fireEvent.press(ahmad);
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "entry-1" });

    await fireEvent.press(screen.getByRole("tab", { name: "تنبيهات الموقع: 3" }));
    navigation.navigate.mockClear();
    await fireEvent.press(screen.getByTestId("live-suspicious-event-1"));
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "entry-9" });

    navigation.navigate.mockClear();
    await fireEvent.press(screen.getByTestId("live-rejected-attempt-2"));
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "entry-7" });

    // An attempt without an entry has nothing to open.
    navigation.navigate.mockClear();
    await fireEvent.press(screen.getByTestId("live-rejected-attempt-1"));
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("رُفضت محاولة إنهاء الدوام")).toBeOnTheScreen();
  });

  it("opens the entry's review from a pin's callout", async () => {
    await renderLive();
    const [worker, emergency] = screen.getAllByTestId("map-marker");
    await fireEvent(worker, "calloutPress");
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "entry-1" });
    await fireEvent(emergency, "calloutPress");
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "entry-2" });
  });

  it("pins a call-out only once when its worker already has a pin, coloured red, and a location that needs review in orange", async () => {
    const base = snapshot();
    const position = { latitude: 32.06, longitude: 34.76, accuracyMeters: 5, at: "2026-10-15T09:00:00.000Z", eventType: "CLOCK_IN" as const, locationValidationStatus: "PASSED" as const };
    mockClient.getOperationsLive.mockResolvedValue(
      snapshot({
        workersOnShift: [
          { ...base.workersOnShift[0], position: { ...base.workersOnShift[0].position!, locationValidationStatus: "FLAGGED" } },
          { ...base.workersOnShift[1], position },
        ],
      }),
    );
    await renderLive();
    const markers = screen.getAllByTestId("map-marker");
    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.props.identifier)).toEqual(["worker-entry-1", "worker-entry-2"]);
    expect(markers[0].props.pinColor).toBe(colors.warning);
    expect(markers[1].props.pinColor).toBe(colors.danger);
    expect(row("live-on-shift-entry-1").getByText(fill(ar.liveOperations.positionStatus, { status: ar.enums.LocationValidationStatus.FLAGGED }))).toBeOnTheScreen();
  });

  it("opens the map on the first site when nobody is on shift, and says so when there is nothing to show", async () => {
    mockClient.getOperationsLive.mockResolvedValue(snapshot({ workersOnShift: [], activeEmergencies: [] }));
    const view = await renderInArabic(liveElement());
    await act(async () => undefined);
    const region = screen.getByTestId("live-map").props.initialRegion as { latitude: number; longitude: number; latitudeDelta: number };
    expect(region.latitude).toBeCloseTo(32.05, 6);
    expect(region.longitude).toBeCloseTo(34.75, 6);
    expect(region.latitudeDelta).toBeCloseTo(0.01, 6);
    expect(screen.queryAllByTestId("map-marker")).toHaveLength(0);
    await view.unmount();

    mockClient.getOperationsLive.mockResolvedValue(snapshot({ workersOnShift: [], activeEmergencies: [], sites: [], temporaryPoints: [] }));
    await renderLive();
    expect(screen.queryByTestId("live-map")).not.toBeOnTheScreen();
    expect(screen.getByText(ar.liveOperations.noMap)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("without the attendance permission, rows and pins are not links to the review", async () => {
    mockAccess = accessFor([Permission.VIEW_OPERATIONS]);
    await renderLive();
    expect(screen.queryByRole("button", { name: /أحمد خليل/ })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("live-on-shift-entry-1"));
    expect(screen.getAllByTestId("map-marker")[0].props.onCalloutPress).toBeUndefined();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it("without the live operations permission, asks nothing and says so", async () => {
    mockAccess = accessFor([Permission.VIEW_FINANCIALS, Permission.VIEW_FINANCIAL_DASHBOARD]);
    await renderLive();
    expect(screen.getByText(ar.liveOperations.noPermission)).toBeOnTheScreen();
    expect(mockClient.getOperationsLive).not.toHaveBeenCalled();
    expect(screen.queryByTestId("live-map")).not.toBeOnTheScreen();
    expectArabicOnly();
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("shows the scope hint to a member restricted to some projects", async () => {
    mockAccess = accessFor(permissionsForScope(SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER, true), true);
    await renderLive();
    expect(screen.getByText(ar.managerHome.restricted)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows an Arabic error with a retry, and keeps the last snapshot when a refresh fails", async () => {
    mockClient.getOperationsLive.mockRejectedValueOnce(networkError());
    await renderLive();
    expect(screen.getByText(`${ar.liveOperations.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.queryByTestId("live-map")).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(mockClient.getOperationsLive).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(`${ar.liveOperations.loadError}\n${ar.errors.network}`)).not.toBeOnTheScreen();
    expect(screen.getByTestId("live-on-shift-entry-1")).toBeOnTheScreen();

    mockClient.getOperationsLive.mockRejectedValueOnce(networkError());
    await pullToRefresh();
    expect(screen.getByText(`${ar.liveOperations.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByTestId("live-on-shift-entry-1")).toBeOnTheScreen();
    expect(screen.getByTestId("live-map")).toBeOnTheScreen();
  });

  it("reloads on focus, every 30 seconds while focused (not after leaving), and on pull", async () => {
    jest.useFakeTimers({ now: new Date("2026-10-15T09:45:00.000Z") });
    await renderLive();
    expect(mockClient.getOperationsLive).toHaveBeenCalledTimes(1);

    mockClient.getOperationsLive.mockResolvedValue(snapshot({ lateWorkers: [] }));
    await act(async () => jest.advanceTimersByTime(LIVE_OPERATIONS_REFRESH_MS));
    expect(mockClient.getOperationsLive).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("tab", { name: "متأخرون: 0" })).toBeOnTheScreen();

    await blur();
    await act(async () => jest.advanceTimersByTime(LIVE_OPERATIONS_REFRESH_MS * 4));
    expect(mockClient.getOperationsLive).toHaveBeenCalledTimes(2);

    await pullToRefresh();
    expect(mockClient.getOperationsLive).toHaveBeenCalledTimes(3);
    expect((screen.getByTestId("live-operations-list").props.refreshControl as { props: { refreshing: boolean } }).props.refreshing).toBe(false);
  });
});

describe("the live map's opening region", () => {
  it("fits every point and circle with some room, never closer than about a kilometre", () => {
    expect(fitRegion([])).toBeNull();
    expect(fitRegion([{ latitude: Number.NaN, longitude: 34.7 }, { latitude: 120, longitude: 34.7 }])).toBeNull();

    const one = fitRegion([{ latitude: 32, longitude: 35 }]);
    expect(one).toEqual({ latitude: 32, longitude: 35, latitudeDelta: 0.01, longitudeDelta: 0.01 });

    const spread = fitRegion([
      { latitude: 31, longitude: 34 },
      { latitude: 33, longitude: 35 },
      { latitude: Number.NaN, longitude: 0 },
    ])!;
    expect(spread.latitude).toBeCloseTo(32, 6);
    expect(spread.longitude).toBeCloseTo(34.5, 6);
    expect(spread.latitudeDelta).toBeCloseTo(2.8, 6);
    expect(spread.longitudeDelta).toBeCloseTo(1.4, 6);

    // A large geofence makes the region grow around it.
    const site = fitRegion([{ latitude: 32, longitude: 35, radiusMeters: 5000 }])!;
    expect(site.latitudeDelta).toBeCloseTo(((2 * 5000) / 111_320) * 1.4, 6);
    expect(site.longitudeDelta).toBeGreaterThan(site.latitudeDelta);
  });

  it("opens on the people and call-outs, else the first site, else the first temporary point, else nothing", () => {
    expect(initialRegionFor(snapshot())!.latitude).toBeCloseTo(32.055, 6);
    expect(initialRegionFor(snapshot({ workersOnShift: [], activeEmergencies: [] }))!.latitude).toBeCloseTo(32.05, 6);
    expect(initialRegionFor(snapshot({ workersOnShift: [], activeEmergencies: [], sites: [] }))!.latitude).toBeCloseTo(32.07, 6);
    expect(initialRegionFor(snapshot({ workersOnShift: [], activeEmergencies: [], sites: [], temporaryPoints: [] }))).toBeNull();
  });
});
