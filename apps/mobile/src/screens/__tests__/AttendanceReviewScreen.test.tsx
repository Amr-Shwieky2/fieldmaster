import { Linking, Platform } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import {
  ApiRequestError,
  NetworkError,
  type EntryCostEstimate,
  type EvidenceClockEvent,
  type NotificationSubject,
  type RejectedClockAttempt,
  type TimeEntryEvidence,
} from "@fieldmaster/api-client";
import { ALL_PERMISSIONS, Permission, SYSTEM_ROLE_PERMISSIONS } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import { fromJerusalemText } from "../../components/review/JerusalemDateTimeField";
import type { RootStackParamList } from "../../navigation/types";
import { AttendanceReviewScreen, reviewTiming } from "../AttendanceReviewScreen";
import { deferred, expectArabicOnly, fill, freezeDate, renderInArabic, renderedStrings } from "./clock-screens-test-utils";

const mockClient = {
  getTimeEntryEvidence: jest.fn(),
  getTimeEntryEstimatedCost: jest.fn(),
  approveTimeEntry: jest.fn(),
  rejectTimeEntry: jest.fn(),
  applyFullDayCredit: jest.fn(),
  requestTimeEntryCorrection: jest.fn(),
  createManualCorrection: jest.fn(),
  getEntryPhotoViewUrl: jest.fn(),
  getNotificationSubject: jest.fn(),
  handleNotificationSubject: jest.fn(),
};
const mockAuth = { client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

/** The member's effective permissions (GET /auth/me); each test sets them. */
let mockPermissions: ReadonlySet<string> = new Set();
jest.mock("../../lib/access-context", () => ({
  useAccess: () => ({
    status: "ready",
    access: null,
    permissions: mockPermissions,
    can: (permission: string) => mockPermissions.has(permission),
    canAny: (list: string[]) => list.some((permission) => mockPermissions.has(permission)),
    isManager: true,
    hasWorkerHome: false,
    restricted: false,
    workRules: null,
    refresh: async () => undefined,
  }),
}));

const FIELD_MANAGER = SYSTEM_ROLE_PERMISSIONS.FIELD_MANAGER;
const OWNER = ALL_PERMISSIONS;

type Navigation = NativeStackScreenProps<RootStackParamList, "AttendanceReview">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock; canGoBack: jest.Mock; isFocused: jest.Mock };

/** User text inside a first-strong isolate, and a left-to-right value (phone, money) inside a left-to-right isolate. */
const iso = (value: string) => `⁨${value}⁩`;
const ltr = (value: string) => `⁦${value}⁩`;

const NAME = "محمد خليل";
const PHONE = "+972501234567";
/** A standard day (and overtime threshold) of 8 hours on the entry's business date: not the 9-hour default. */
const DAY_RULES = { standardDayMinutes: 480, overtimeThresholdMinutes: 480 };

function clockEvent(overrides: Partial<EvidenceClockEvent> & Pick<EvidenceClockEvent, "id" | "eventType">): EvidenceClockEvent {
  return {
    origin: "ONLINE",
    deviceId: "device-1",
    deviceTimestamp: "2026-10-14T04:59:30.000Z",
    serverReceivedAt: "2026-10-14T05:00:00.000Z",
    validatedAt: "2026-10-14T05:00:00.000Z",
    deviceTimeDeviationSeconds: 30,
    latitude: 31.7802,
    longitude: 35.2103,
    accuracyMeters: 8.4,
    mockLocationSuspected: false,
    distanceFromSiteMeters: 42.4,
    locationValidationStatus: "PASSED",
    isManualCorrection: false,
    appVersion: null,
    temporaryCheckInPoint: null,
    offlineSync: null,
    ...overrides,
  };
}

const ATTEMPT: RejectedClockAttempt = {
  id: "attempt-1",
  eventType: "CLOCK_IN",
  origin: "ONLINE",
  code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
  deviceTimestamp: "2026-10-14T04:55:00.000Z",
  serverReceivedAt: "2026-10-14T04:55:05.000Z",
  deviationSeconds: null,
  latitude: 31.783,
  longitude: 35.213,
  accuracyMeters: 9,
  mockLocationSuspected: false,
  distanceMeters: 340.2,
  allowedRadiusMeters: 120,
  requiredAccuracyMeters: null,
  temporaryCheckInPoint: null,
};

/** A closed entry waiting for approval: 08:00-15:00 in Jerusalem on 14 October 2026 (7 hours). */
function evidence(overrides: Partial<TimeEntryEvidence> = {}): TimeEntryEvidence {
  return {
    id: "te-1",
    status: "PENDING_APPROVAL",
    businessDate: "2026-10-14",
    flags: ["OUTSIDE_GEOFENCE_ATTEMPT"],
    checkInMethod: "GEOFENCED",
    isEmergency: false,
    devRewoundAt: null,
    createdAt: "2026-10-14T05:00:00.000Z",
    clockInAt: "2026-10-14T05:00:00.000Z",
    clockOutAt: "2026-10-14T12:00:00.000Z",
    rejectedReason: null,
    approvedAt: null,
    approvedByName: null,
    periodFinalized: false,
    dayRules: DAY_RULES,
    photos: [{ id: "photo-1", contentType: "image/jpeg", uploadedAt: "2026-10-14T05:00:10.000Z", eventType: "CLOCK_IN" }],
    worker: { id: "worker-1", fullLegalName: NAME, phoneNumber: PHONE },
    shift: {
      id: "shift-1",
      title: "صيانة إشارات شارع يافا",
      shiftType: "STANDARD",
      status: "PENDING_APPROVAL",
      scheduledStart: "2026-10-14T05:00:00.000Z",
      scheduledEnd: "2026-10-14T14:00:00.000Z",
      checkInMethod: "GEOFENCED",
      project: { id: "project-1", name: "مشروع القدس", client: null, projectCode: "P-1" },
      site: { id: "site-1", name: "شارع يافا", address: null, latitude: 31.78, longitude: 35.21, defaultGeofenceRadiusMeters: 150 },
      geofence: { id: "geofence-1", centerLatitude: 31.7801, centerLongitude: 35.2102, radiusMeters: 120, minAccuracyMeters: 50 },
    },
    duration: { rawDurationMinutes: 420, unpaidBreakMinutes: 0, workedMinutes: 420, regularMinutes: 420, overtimeMinutes: 0, basis: "EXPECTED", approvedSplitOutdated: false },
    fullDayCredit: { applied: false, reason: null, appliedByName: null, appliedAt: null, eligible: true },
    emergency: null,
    clockEvents: [
      clockEvent({ id: "event-in", eventType: "CLOCK_IN" }),
      clockEvent({
        id: "event-out",
        eventType: "CLOCK_OUT",
        origin: "OFFLINE",
        deviceTimestamp: "2026-10-14T12:00:00.000Z",
        serverReceivedAt: "2026-10-14T12:20:00.000Z",
        validatedAt: "2026-10-14T12:00:00.000Z",
        latitude: 31.7799,
        longitude: 35.21,
        accuracyMeters: 25,
        distanceFromSiteMeters: null,
        locationValidationStatus: "FLAGGED",
        offlineSync: { status: "VERIFIED", syncedAt: "2026-10-14T12:20:00.000Z", offlineEventAgeSeconds: 1200, batchId: "batch-1", duplicateSyncs: 0 },
      }),
    ],
    rejectedAttempts: [ATTEMPT],
    dailySummary: {
      text: "ركّبنا إشارتين جديدتين.",
      voiceNoteUrl: null,
      taskCategory: "TRAFFIC_LIGHT_INSTALLATION",
      materialsUsed: "كابلات",
      problemsEncountered: "انقطاع الكهرباء",
      followUpRequired: true,
      createdAt: "2026-10-14T12:00:00.000Z",
    },
    history: {
      corrections: [
        {
          id: "correction-1",
          field: "clockOutAt",
          oldValue: "2026-10-14T11:00:00.000Z",
          newValue: "2026-10-14T12:00:00.000Z",
          reason: "FORGOTTEN_CLOCK_OUT",
          note: "نسي العامل التسجيل",
          editedByName: "سامي حداد",
          createdAt: "2026-10-14T16:00:00.000Z",
          infraction: { id: "infraction-1", businessMonth: "2026-10", monthlySequenceNumber: 1, reversedAt: null, reversalReason: null },
        },
      ],
      approvals: [{ id: "approval-1", action: "REQUEST_CORRECTION", actedByName: "ليلى منصور", notes: "راجع وقت الخروج", createdAt: "2026-10-14T15:00:00.000Z" }],
      auditEvents: [],
    },
    allowedActions: { approve: true, reject: true, requestCorrection: true, fullDayCredit: true, correct: true },
    ...overrides,
  };
}

/** An entry still running (no clock-out): opened from a "9 hours / overtime" notification. */
function openEntry(overrides: Partial<TimeEntryEvidence> = {}): TimeEntryEvidence {
  const base = evidence();
  return evidence({
    status: "ACTIVE",
    clockOutAt: null,
    flags: [],
    duration: { rawDurationMinutes: null, unpaidBreakMinutes: 0, workedMinutes: null, regularMinutes: null, overtimeMinutes: null, basis: "OPEN", approvedSplitOutdated: false },
    fullDayCredit: { applied: false, reason: null, appliedByName: null, appliedAt: null, eligible: false },
    clockEvents: [base.clockEvents[0]],
    rejectedAttempts: [],
    dailySummary: null,
    photos: [],
    history: { corrections: [], approvals: [], auditEvents: [] },
    allowedActions: { approve: false, reject: false, requestCorrection: false, fullDayCredit: false, correct: true },
    ...overrides,
  });
}

const COST: EntryCostEstimate = {
  timeEntryId: "te-1",
  basis: "ESTIMATED",
  compensationType: "DAILY",
  regularMinutes: 420,
  overtimeMinutes: 0,
  baseAgorot: 42000,
  overtimeAgorot: 0,
  estimatedCostAgorot: 42000,
};

const UNHANDLED: NotificationSubject = { id: "subject-1", kind: "ATTENDANCE", handled: null };

function apiError(status: number, code: string) {
  return new ApiRequestError(status, { statusCode: status, code, message: "English text that is never shown.", correlationId: "c" });
}

function renderScreen(params: { timeEntryId: string; subjectId?: string } = { timeEntryId: "te-1" }) {
  return renderInArabic(
    <AttendanceReviewScreen navigation={navigation as unknown as Navigation} route={{ key: "AttendanceReview-1", name: "AttendanceReview", params }} />,
  );
}

async function renderLoaded(params?: { timeEntryId: string; subjectId?: string }) {
  await renderScreen(params);
  await screen.findByText(iso(NAME));
}

const actions = () => within(screen.getByTestId("actions"));

/** Moves a native date/time picker (as iOS reports a change) to an instant. */
async function pick(testID: string, instant: string) {
  await fireEvent(screen.getByTestId(testID), "change", { nativeEvent: { timestamp: Date.parse(instant), utcOffset: 0 } });
}

beforeEach(() => {
  navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true), isFocused: jest.fn(() => true) };
  mockPermissions = new Set(FIELD_MANAGER);
  mockSync.isOnline = true;
  reviewTiming.backDelayMs = 0;
  mockClient.getTimeEntryEvidence.mockResolvedValue(evidence());
  mockClient.getTimeEntryEstimatedCost.mockResolvedValue(COST);
  mockClient.approveTimeEntry.mockResolvedValue({});
  mockClient.rejectTimeEntry.mockResolvedValue({});
  mockClient.applyFullDayCredit.mockResolvedValue({});
  mockClient.requestTimeEntryCorrection.mockResolvedValue({});
  mockClient.createManualCorrection.mockResolvedValue({ timeEntry: { id: "te-1" }, correction: { id: "correction-2" } });
  mockClient.getEntryPhotoViewUrl.mockResolvedValue({ url: "https://files.example.test/photo-1.jpg?signature=abc", expiresInSeconds: 60, contentType: "image/jpeg" });
  mockClient.getNotificationSubject.mockResolvedValue(UNHANDLED);
  mockClient.handleNotificationSubject.mockResolvedValue({ ...UNHANDLED, handled: null });
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("AttendanceReviewScreen (Arabic, RTL)", () => {
  it("shows the loading state, then the entry: worker, status, flags, shift, times (Asia/Jerusalem) and minutes", async () => {
    const answer = deferred<TimeEntryEvidence>();
    mockClient.getTimeEntryEvidence.mockReturnValue(answer.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.review.title })).toBeOnTheScreen();

    await act(async () => answer.resolve(evidence()));
    expect(mockClient.getTimeEntryEvidence).toHaveBeenCalledWith("te-1");
    expect(screen.getByText(iso(NAME))).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.TimeEntryStatus.PENDING_APPROVAL)).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.AttendanceFlag.OUTSIDE_GEOFENCE_ATTEMPT)).toBeOnTheScreen();
    expect(screen.getByText("يوم العمل: 14 أكتوبر 2026")).toBeOnTheScreen();
    expect(screen.getByText(`الوردية: ${iso("صيانة إشارات شارع يافا")}`)).toBeOnTheScreen();
    expect(screen.getByText(`المشروع: ${iso("مشروع القدس")}`)).toBeOnTheScreen();
    expect(screen.getByText(`الموقع: ${iso("شارع يافا")}`)).toBeOnTheScreen();
    expect(screen.getByText("موعد الوردية: من 14 أكتوبر 2026 في 08:00 إلى 14 أكتوبر 2026 في 17:00")).toBeOnTheScreen();
    expect(screen.getByText(`رقم الهاتف: ${ltr(PHONE)}`)).toBeOnTheScreen();

    const times = within(screen.getByTestId("times"));
    expect(times.getByText("الوقت المعتمد: 14 أكتوبر 2026 في 08:00")).toBeOnTheScreen();
    expect(times.getByText("الوقت المعتمد: 14 أكتوبر 2026 في 15:00")).toBeOnTheScreen();
    expect(times.getByText("وقت الهاتف: 14 أكتوبر 2026 في 07:59")).toBeOnTheScreen();
    expect(times.getByText("وقت الوصول إلى الخادم: 14 أكتوبر 2026 في 15:20")).toBeOnTheScreen();
    expect(times.getByText(fill(ar.review.times.offline, { status: ar.enums.OfflineSyncEventStatus.VERIFIED, time: "14 أكتوبر 2026 في 15:20" }))).toBeOnTheScreen();
    expect(times.getByText(ar.enums.LocationValidationStatus.PASSED)).toBeOnTheScreen();
    expect(times.getByText(ar.enums.LocationValidationStatus.FLAGGED)).toBeOnTheScreen();
    expect(times.getByText("المسافة من الموقع: 42 م")).toBeOnTheScreen();
    expect(times.getByText(ar.review.times.corrected)).toBeOnTheScreen();

    const duration = within(screen.getByTestId("duration"));
    expect(duration.getByText("مدة العمل: 7 س 0 د")).toBeOnTheScreen();
    expect(duration.getByText("ساعات عادية: 7 س 0 د")).toBeOnTheScreen();
    expect(duration.getByText("ساعات إضافية: 0 س 0 د")).toBeOnTheScreen();
    // The split's explanation and the full-day credit use the entry's day rules (8 hours), not a constant.
    expect(duration.getByText(fill(ar.review.duration.basisExpected, { threshold: "8 س 0 د" }))).toBeOnTheScreen();
    expect(duration.getByText(fill(ar.review.duration.fullDayCreditEligible, { standard: "8 س 0 د" }))).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the daily summary and the history (corrections with their reasons and who, decisions)", async () => {
    await renderLoaded();
    const summary = within(screen.getByTestId("daily-summary"));
    expect(summary.getByText(iso("ركّبنا إشارتين جديدتين."))).toBeOnTheScreen();
    expect(summary.getByText(`نوع العمل: ${ar.enums.TaskCategory.TRAFFIC_LIGHT_INSTALLATION}`)).toBeOnTheScreen();
    expect(summary.getByText(`مشاكل واجهها العامل: ${iso("انقطاع الكهرباء")}`)).toBeOnTheScreen();
    expect(summary.getByText(`المواد المستخدمة: ${iso("كابلات")}`)).toBeOnTheScreen();
    expect(summary.getByText(ar.review.summary.followUp)).toBeOnTheScreen();

    const history = within(screen.getByTestId("history"));
    expect(history.getByText(ar.review.history.fields.clockOutAt)).toBeOnTheScreen();
    expect(history.getByText("من 14 أكتوبر 2026 في 14:00 إلى 14 أكتوبر 2026 في 15:00")).toBeOnTheScreen();
    expect(history.getByText(`السبب: ${ar.enums.CorrectionReason.FORGOTTEN_CLOCK_OUT}`)).toBeOnTheScreen();
    expect(history.getByText(`ملاحظة: ${iso("نسي العامل التسجيل")}`)).toBeOnTheScreen();
    expect(history.getByText("نسيان تسجيل رقم 1 في شهر أكتوبر 2026")).toBeOnTheScreen();
    expect(history.getByText(`بواسطة ${iso("سامي حداد")} في 14 أكتوبر 2026 في 19:00`)).toBeOnTheScreen();
    expect(history.getByText(ar.enums.ApprovalAction.REQUEST_CORRECTION)).toBeOnTheScreen();
    expect(history.getByText(iso("راجع وقت الخروج"))).toBeOnTheScreen();
    expect(history.getByText(`بواسطة ${iso("ليلى منصور")} في 14 أكتوبر 2026 في 18:00`)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("draws the evidence map: the geofence circle, a marker per clock event and per refused attempt, all listed in text", async () => {
    await renderLoaded();
    const circles = screen.getAllByTestId("map-circle");
    expect(circles).toHaveLength(1);
    expect(circles[0].props.center).toEqual({ latitude: 31.7801, longitude: 35.2102 });
    expect(circles[0].props.radius).toBe(120);

    const markers = screen.getAllByTestId("map-marker");
    expect(markers.map((marker) => marker.props.coordinate)).toEqual([
      { latitude: 31.7802, longitude: 35.2103 },
      { latitude: 31.7799, longitude: 35.21 },
      { latitude: 31.783, longitude: 35.213 },
    ]);
    expect(markers.map((marker) => marker.props.pinColor)).toEqual(["#059669", "#4f46e5", "#dc2626"]);
    expect(markers[2].props.title).toBe(fill(ar.review.attempts.marker, { event: ar.enums.ClockEventType.CLOCK_IN, reason: ar.review.attempts.codes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS }));
    expect(screen.getByTestId("map").props.initialRegion).toEqual(expect.objectContaining({ latitude: expect.any(Number), longitude: expect.any(Number) }));

    const map = within(screen.getByTestId("evidence-map"));
    expect(map.getByText(fill(ar.review.map.geofence, { radius: "120" }))).toBeOnTheScreen();
    expect(
      map.getByText(fill(ar.review.map.eventPoint, { event: ar.enums.ClockEventType.CLOCK_IN, accuracy: "8", distance: "42", outcome: ar.enums.LocationValidationStatus.PASSED })),
    ).toBeOnTheScreen();
    expect(map.getByText("محاولة مرفوضة واحدة")).toBeOnTheScreen();
    expect(
      map.getByText(fill(ar.review.attempts.item, { event: ar.enums.ClockEventType.CLOCK_IN, time: "14 أكتوبر 2026 في 07:55", reason: ar.review.attempts.codes.GEOFENCE_OUTSIDE_ALLOWED_RADIUS })),
    ).toBeOnTheScreen();
    expect(map.getByText("المسافة 340 م (المسموح 120 م)")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the load error with a retry", async () => {
    mockClient.getTimeEntryEvidence.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.review.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(iso(NAME))).toBeOnTheScreen();
    expect(mockClient.getTimeEntryEvidence).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["404", apiError(404, "NOT_FOUND")],
    ["403", apiError(403, "FORBIDDEN")],
  ])("says the entry cannot be found on a %s, with no actions", async (_status, error) => {
    mockClient.getTimeEntryEvidence.mockRejectedValue(error);
    await renderScreen();
    expect(await screen.findByText(ar.review.notFound)).toBeOnTheScreen();
    expect(screen.queryByTestId("actions")).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("Field Manager on a pending entry: the decisions the entry allows, and no money anywhere (the cost is never asked for)", async () => {
    await renderLoaded();
    expect(actions().getByRole("button", { name: ar.review.actions.approve })).toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.common.reject })).toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.review.actions.requestCorrection })).toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.common.creditAsFullDay })).toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.review.actions.manualCorrection })).toBeOnTheScreen();
    // Not opened from a notification: no «تمت المتابعة», and no subject is read.
    expect(actions().queryByRole("button", { name: ar.review.actions.followUp })).not.toBeOnTheScreen();
    expect(mockClient.getNotificationSubject).not.toHaveBeenCalled();

    expect(screen.queryByTestId("entry-cost")).not.toBeOnTheScreen();
    expect(renderedStrings().join("\n")).not.toContain("₪");
    expect(mockClient.getTimeEntryEstimatedCost).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("shows only what the entry allows now AND the member may do", async () => {
    // The entry allows only a correction request and a manual correction (e.g. already approved).
    mockClient.getTimeEntryEvidence.mockResolvedValue(
      evidence({ status: "APPROVED", allowedActions: { approve: false, reject: false, requestCorrection: true, fullDayCredit: false, correct: true } }),
    );
    await renderLoaded();
    expect(actions().queryByRole("button", { name: ar.review.actions.approve })).not.toBeOnTheScreen();
    expect(actions().queryByRole("button", { name: ar.common.reject })).not.toBeOnTheScreen();
    expect(actions().queryByRole("button", { name: ar.common.creditAsFullDay })).not.toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.review.actions.requestCorrection })).toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.review.actions.manualCorrection })).toBeOnTheScreen();
    await screen.unmount();

    // A custom role that approves but neither corrects nor credits a full day.
    mockPermissions = new Set([Permission.VIEW_ATTENDANCE, Permission.APPROVE_ATTENDANCE]);
    mockClient.getTimeEntryEvidence.mockResolvedValue(evidence());
    await renderLoaded();
    expect(actions().getByRole("button", { name: ar.review.actions.approve })).toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.common.reject })).toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.review.actions.requestCorrection })).toBeOnTheScreen();
    expect(actions().queryByRole("button", { name: ar.common.creditAsFullDay })).not.toBeOnTheScreen();
    expect(actions().queryByRole("button", { name: ar.review.actions.manualCorrection })).not.toBeOnTheScreen();
    await screen.unmount();

    // Read-only attendance: nothing to do.
    mockPermissions = new Set([Permission.VIEW_ATTENDANCE]);
    await renderLoaded();
    expect(actions().getByText(ar.review.actions.none)).toBeOnTheScreen();
    expect(actions().queryAllByRole("button")).toHaveLength(0);
  });

  it("Owner: the estimated cost in ₪ from its own endpoint", async () => {
    mockPermissions = new Set(OWNER);
    await renderLoaded();
    const cost = within(await screen.findByTestId("entry-cost"));
    expect(await cost.findByText(`الإجمالي: ${ltr("₪ 420.00")}`)).toBeOnTheScreen();
    expect(cost.getByText(`الأجر الأساسي: ${ltr("₪ 420.00")}`)).toBeOnTheScreen();
    expect(cost.getByText(`الساعات الإضافية: ${ltr("₪ 0.00")}`)).toBeOnTheScreen();
    expect(cost.getByText(ar.review.cost.basis.ESTIMATED)).toBeOnTheScreen();
    expect(mockClient.getTimeEntryEstimatedCost).toHaveBeenCalledWith("te-1");
    expectArabicOnly();
  });

  it("needs both VIEW_FINANCIALS and VIEW_COMPENSATION for the cost", async () => {
    mockPermissions = new Set([...FIELD_MANAGER, Permission.VIEW_FINANCIALS]);
    await renderLoaded();
    expect(screen.queryByTestId("entry-cost")).not.toBeOnTheScreen();
    expect(mockClient.getTimeEntryEstimatedCost).not.toHaveBeenCalled();
    expect(renderedStrings().join("\n")).not.toContain("₪");
  });

  it("approve: calls the API, shows the success message, reads the entry and the subject again, then goes back", async () => {
    mockClient.getNotificationSubject
      .mockResolvedValueOnce(UNHANDLED)
      .mockResolvedValueOnce({ ...UNHANDLED, handled: { at: "2026-10-14T16:30:00.000Z", by: { userId: "user-1", fullLegalName: "ليلى منصور" }, outcome: "APPROVED", note: null } });
    mockClient.getTimeEntryEvidence
      .mockResolvedValueOnce(evidence())
      .mockResolvedValueOnce(evidence({ status: "APPROVED", allowedActions: { approve: false, reject: false, requestCorrection: true, fullDayCredit: false, correct: true } }));
    await renderLoaded({ timeEntryId: "te-1", subjectId: "subject-1" });
    expect(mockClient.getNotificationSubject).toHaveBeenCalledWith("subject-1");

    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.approve }));
    expect(mockClient.approveTimeEntry).toHaveBeenCalledWith("te-1");
    expect(await screen.findByText(fill(ar.review.messages.approved, { name: iso(NAME) }))).toBeOnTheScreen();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockClient.getTimeEntryEvidence).toHaveBeenCalledTimes(2);
    expect(mockClient.getNotificationSubject).toHaveBeenCalledTimes(2);
    expect(screen.getByText(ar.enums.TimeEntryStatus.APPROVED)).toBeOnTheScreen();
    expect(screen.getByText(`النتيجة: ${ar.enums.NotificationHandledOutcome.APPROVED}`)).toBeOnTheScreen();
    expect(mockClient.getTimeEntryEstimatedCost).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("reject needs a reason: a blank one is refused before any request, then the reason is sent", async () => {
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.common.reject }));
    const input = screen.getByLabelText(ar.review.reasonPrompt.rejectLabel);
    expect(input.props.value).toBe(ar.review.reasonPrompt.rejectDefault);
    expect(screen.getByText(ar.review.reasonPrompt.rejectHint)).toBeOnTheScreen();

    await fireEvent.changeText(input, "   ");
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmReject }));
    expect(screen.getByText(ar.review.reasonPrompt.required)).toBeOnTheScreen();
    expect(mockClient.rejectTimeEntry).not.toHaveBeenCalled();

    await fireEvent.changeText(input, "  لم يكن العامل في الموقع  ");
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmReject }));
    expect(mockClient.rejectTimeEntry).toHaveBeenCalledWith("te-1", "لم يكن العامل في الموقع");
    expect(await screen.findByText(fill(ar.review.messages.rejected, { name: iso(NAME) }))).toBeOnTheScreen();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expectArabicOnly();
  });

  it("full-day credit needs a reason (the admin web's default is offered)", async () => {
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.common.creditAsFullDay }));
    const input = screen.getByLabelText(ar.review.reasonPrompt.fullDayCreditLabel);
    await fireEvent.changeText(input, "");
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmFullDayCredit }));
    expect(screen.getByText(ar.review.reasonPrompt.required)).toBeOnTheScreen();
    expect(mockClient.applyFullDayCredit).not.toHaveBeenCalled();

    await fireEvent.changeText(input, ar.review.reasonPrompt.fullDayCreditDefault);
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmFullDayCredit }));
    expect(mockClient.applyFullDayCredit).toHaveBeenCalledWith("te-1", ar.review.reasonPrompt.fullDayCreditDefault);
    expect(await screen.findByText(fill(ar.review.messages.fullDayCreditApplied, { name: iso(NAME) }))).toBeOnTheScreen();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it("request correction needs a reason, then sends it", async () => {
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.requestCorrection }));
    const input = screen.getByLabelText(ar.review.reasonPrompt.requestCorrectionLabel);
    await fireEvent.changeText(input, " ");
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmRequestCorrection }));
    expect(screen.getByText(ar.review.reasonPrompt.required)).toBeOnTheScreen();
    expect(mockClient.requestTimeEntryCorrection).not.toHaveBeenCalled();

    await fireEvent.changeText(input, "وقت الخروج غير صحيح");
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmRequestCorrection }));
    expect(mockClient.requestTimeEntryCorrection).toHaveBeenCalledWith("te-1", "وقت الخروج غير صحيح");
    expect(await screen.findByText(fill(ar.review.messages.correctionRequested, { name: iso(NAME) }))).toBeOnTheScreen();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it("a refused action (409: already decided) shows the Arabic error, reads the entry again and stays", async () => {
    mockClient.approveTimeEntry.mockRejectedValue(apiError(409, "CONFLICT"));
    mockClient.getTimeEntryEvidence
      .mockResolvedValueOnce(evidence())
      .mockResolvedValueOnce(evidence({ status: "APPROVED", allowedActions: { approve: false, reject: false, requestCorrection: true, fullDayCredit: false, correct: true } }));
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.approve }));
    expect(await screen.findByText(ar.errors.CONFLICT)).toBeOnTheScreen();
    await waitFor(() => expect(actions().queryByRole("button", { name: ar.review.actions.approve })).not.toBeOnTheScreen());
    expect(mockClient.getTimeEntryEvidence).toHaveBeenCalledTimes(2);
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(screen.queryByTestId("review-success")).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("manual correction: the preview splits the minutes with the entry's day rules, and the API gets the admin web's input", async () => {
    freezeDate("2026-10-15T09:00:00.000Z");
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.manualCorrection }));
    const form = within(screen.getByTestId("correction-form"));
    // A closed entry: correct either time or the break (no "add a clock-out").
    expect(form.queryByRole("radio", { name: ar.review.correction.types.ADD_MISSING_CLOCK_OUT })).not.toBeOnTheScreen();
    expect(form.getByRole("radio", { name: ar.review.correction.types.CORRECT_CLOCK_IN })).toBeChecked();

    await fireEvent.press(form.getByRole("radio", { name: ar.review.correction.types.CORRECT_CLOCK_OUT }));
    expect(screen.getByTestId("correction-time-value")).toHaveTextContent("14 أكتوبر 2026 في 15:00");
    expect(form.getByText(fill(ar.review.correction.currentTime, { time: "14 أكتوبر 2026 في 15:00" }))).toBeOnTheScreen();
    // Times are entered in Asia/Jerusalem whatever the phone's zone.
    expect(screen.getByTestId("correction-time-time").props.timeZoneName).toBe("Asia/Jerusalem");
    expect(screen.getByTestId("correction-time-date").props.timeZoneName).toBe("Asia/Jerusalem");
    expect(screen.getByTestId("preview-now-worked")).toHaveTextContent("7 س 0 د");
    expect(screen.getByTestId("preview-now-overtime")).toHaveTextContent("0 س 0 د");

    // 17:00 in Jerusalem: 9 hours, of which 8 regular (the entry's standard day of 480 minutes) and 60 overtime minutes.
    await pick("correction-time-time", "2026-10-14T14:00:00.000Z");
    expect(screen.getByTestId("correction-time-value")).toHaveTextContent("14 أكتوبر 2026 في 17:00");
    expect(screen.getByTestId("preview-worked")).toHaveTextContent("9 س 0 د");
    expect(screen.getByTestId("preview-regular")).toHaveTextContent("8 س 0 د");
    expect(screen.getByTestId("preview-overtime")).toHaveTextContent("1 س 0 د");
    expect(form.getByText(fill(ar.review.correction.preview.rules, { date: "14 أكتوبر 2026", standard: "8 س 0 د", threshold: "8 س 0 د" }))).toBeOnTheScreen();

    await fireEvent.press(form.getByRole("radio", { name: ar.enums.CorrectionReason.FORGOTTEN_CLOCK_OUT }));
    expect(form.getByText(fill(ar.review.correction.forgottenStamp, { month: "أكتوبر 2026" }))).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(ar.review.correction.note), "  أكّد العامل الوقت هاتفيًا ");
    expectArabicOnly();
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));

    expect(mockClient.createManualCorrection).toHaveBeenCalledWith({
      timeEntryId: "te-1",
      field: "CLOCK_OUT",
      newValue: "2026-10-14T14:00:00.000Z",
      reason: "FORGOTTEN_CLOCK_OUT",
      note: "أكّد العامل الوقت هاتفيًا",
    });
    expect(await screen.findByText(fill(ar.review.messages.corrected, { name: iso(NAME) }))).toBeOnTheScreen();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockClient.getTimeEntryEvidence).toHaveBeenCalledTimes(2);
  });

  it("manual correction validation: clock-out after clock-in, clock-in before clock-out, a reason, a note for «أخرى»", async () => {
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.manualCorrection }));
    const form = within(screen.getByTestId("correction-form"));

    // A clock-in after the clock-out (16:00 > 15:00).
    await pick("correction-time-time", "2026-10-14T13:00:00.000Z");
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(form.getByText(ar.review.correction.errors.clockInAfterClockOut)).toBeOnTheScreen();
    expect(form.getByText(ar.review.correction.errors.reasonRequired)).toBeOnTheScreen();
    expect(form.getByText(ar.review.correction.errors.summary)).toBeOnTheScreen();

    // A clock-out before the clock-in (07:00 < 08:00).
    await fireEvent.press(form.getByRole("radio", { name: ar.review.correction.types.CORRECT_CLOCK_OUT }));
    await pick("correction-time-time", "2026-10-14T04:00:00.000Z");
    expect(form.getByText(ar.review.correction.errors.clockOutBeforeClockIn)).toBeOnTheScreen();

    // «أخرى» needs a note.
    await fireEvent.press(form.getByRole("radio", { name: ar.enums.CorrectionReason.OTHER }));
    expect(screen.getByLabelText(ar.review.correction.noteRequired)).toBeOnTheScreen();
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(form.getByText(ar.review.correction.errors.noteRequired)).toBeOnTheScreen();
    expect(mockClient.createManualCorrection).not.toHaveBeenCalled();

    await pick("correction-time-time", "2026-10-14T13:00:00.000Z");
    await fireEvent.changeText(screen.getByLabelText(ar.review.correction.noteRequired), "طلب المدير");
    expect(form.queryByText(ar.review.correction.errors.clockOutBeforeClockIn)).not.toBeOnTheScreen();
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(mockClient.createManualCorrection).toHaveBeenCalledWith({
      timeEntryId: "te-1",
      field: "CLOCK_OUT",
      newValue: "2026-10-14T13:00:00.000Z",
      reason: "OTHER",
      note: "طلب المدير",
    });
  });

  it("manual correction of the unpaid break: whole minutes only, previewed, sent as UNPAID_BREAK_MINUTES", async () => {
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.manualCorrection }));
    const form = within(screen.getByTestId("correction-form"));
    await fireEvent.press(form.getByRole("radio", { name: ar.review.correction.types.CORRECT_UNPAID_BREAK }));
    const input = screen.getByLabelText(ar.review.correction.breakMinutes);
    expect(input.props.value).toBe("0");
    expect(form.getByText("لا توجد استراحة مسجّلة الآن.")).toBeOnTheScreen();

    await fireEvent.changeText(input, "12.5");
    await fireEvent.press(form.getByRole("radio", { name: ar.enums.CorrectionReason.MANAGER_INSTRUCTION }));
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(form.getByText(ar.review.correction.errors.breakInvalid)).toBeOnTheScreen();
    expect(mockClient.createManualCorrection).not.toHaveBeenCalled();

    await fireEvent.changeText(input, "30");
    expect(screen.getByTestId("preview-worked")).toHaveTextContent("6 س 30 د");
    expect(screen.getByTestId("preview-regular")).toHaveTextContent("6 س 30 د");
    expect(screen.getByTestId("preview-overtime")).toHaveTextContent("0 س 0 د");
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(mockClient.createManualCorrection).toHaveBeenCalledWith({ timeEntryId: "te-1", field: "UNPAID_BREAK_MINUTES", newValue: "30", reason: "MANAGER_INSTRUCTION" });
  });

  it("photos open one at a time through getEntryPhotoViewUrl and are shown without any cache", async () => {
    await renderLoaded();
    expect(mockClient.getEntryPhotoViewUrl).not.toHaveBeenCalled();
    const label = fill(ar.review.photos.item, { event: ar.enums.ClockEventType.CLOCK_IN, time: "14 أكتوبر 2026 في 08:00" });
    await fireEvent.press(screen.getByRole("button", { name: label }));
    expect(mockClient.getEntryPhotoViewUrl).toHaveBeenCalledWith("te-1", "photo-1");

    const image = await screen.findByTestId("photo-viewer-image");
    expect(image.props.cachePolicy).toBe("none");
    expect(image.props.source).toEqual({ uri: "https://files.example.test/photo-1.jpg?signature=abc" });
    expect(screen.getByText(ar.review.photos.privacy)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.common.close }));
    expect(screen.queryByTestId("photo-viewer-image")).not.toBeOnTheScreen();
  });

  it("a photo that cannot be opened shows the Arabic error and a retry asks for a new URL", async () => {
    mockClient.getEntryPhotoViewUrl.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderLoaded();
    await fireEvent.press(screen.getByRole("button", { name: fill(ar.review.photos.item, { event: ar.enums.ClockEventType.CLOCK_IN, time: "14 أكتوبر 2026 في 08:00" }) }));
    expect(await screen.findByText(`${ar.review.photos.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: ar.common.retry }));
    expect(await screen.findByTestId("photo-viewer-image")).toBeOnTheScreen();
    expect(mockClient.getEntryPhotoViewUrl).toHaveBeenCalledTimes(2);
  });

  it("opened from a notification another manager already settled: who did what, and when", async () => {
    mockClient.getTimeEntryEvidence.mockResolvedValue(
      evidence({ status: "APPROVED", allowedActions: { approve: false, reject: false, requestCorrection: true, fullDayCredit: false, correct: true } }),
    );
    mockClient.getNotificationSubject.mockResolvedValue({
      ...UNHANDLED,
      handled: { at: "2026-10-14T15:30:00.000Z", by: { userId: "user-2", fullLegalName: "سامي حداد" }, outcome: "APPROVED", note: "بعد الاتصال بالعامل" },
    });
    await renderLoaded({ timeEntryId: "te-1", subjectId: "subject-1" });
    const banner = within(await screen.findByTestId("handled-banner"));
    expect(banner.getByText(fill(ar.review.handled.title, { name: iso("سامي حداد"), time: "14 أكتوبر 2026 في 18:30" }))).toBeOnTheScreen();
    expect(banner.getByText(`النتيجة: ${ar.enums.NotificationHandledOutcome.APPROVED}`)).toBeOnTheScreen();
    expect(banner.getByText(`ملاحظة: ${iso("بعد الاتصال بالعامل")}`)).toBeOnTheScreen();
    // The actions stay only what the entry allows now.
    expect(actions().queryByRole("button", { name: ar.review.actions.approve })).not.toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.review.actions.requestCorrection })).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("open entry: how long it has been open (with the overtime so far by the day rules), call the worker, «تمت المتابعة»", async () => {
    freezeDate("2026-10-14T14:15:00.000Z");
    mockClient.getTimeEntryEvidence.mockResolvedValue(openEntry());
    mockClient.getNotificationSubject.mockResolvedValue({ ...UNHANDLED, id: "subject-9" });
    await renderLoaded({ timeEntryId: "te-1", subjectId: "subject-9" });

    const open = within(screen.getByTestId("open-entry"));
    expect(open.getByText("الدوام مفتوح منذ 9 س 15 د")).toBeOnTheScreen();
    expect(open.getByText("بدء الدوام: 14 أكتوبر 2026 في 08:00")).toBeOnTheScreen();
    expect(open.getByText("ساعات إضافية حتى الآن: 1 س 15 د")).toBeOnTheScreen();
    expect(open.getByText(fill(ar.review.open.threshold, { duration: "8 س 0 د" }))).toBeOnTheScreen();
    // Approve and reject are not offered for a running entry (allowedActions).
    expect(actions().queryByRole("button", { name: ar.review.actions.approve })).not.toBeOnTheScreen();
    expect(actions().queryByRole("button", { name: ar.common.reject })).not.toBeOnTheScreen();
    expect(actions().getByRole("button", { name: ar.review.actions.manualCorrection })).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.review.worker.call }));
    expect(Linking.openURL).toHaveBeenCalledWith(`tel:${PHONE}`);

    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.followUp }));
    await fireEvent.changeText(screen.getByLabelText(ar.review.followUp.label), " اتصلت بالعامل وسيُنهي الدوام ");
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmFollowUp }));
    expect(mockClient.handleNotificationSubject).toHaveBeenCalledWith("subject-9", "اتصلت بالعامل وسيُنهي الدوام");
    expect(await screen.findByText(fill(ar.review.messages.followedUp, { name: iso(NAME) }))).toBeOnTheScreen();
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockClient.getNotificationSubject).toHaveBeenCalledTimes(2);
  });

  it("«تمت المتابعة» works without a note, and is not offered once the alert was settled", async () => {
    mockClient.getTimeEntryEvidence.mockResolvedValue(openEntry());
    await renderLoaded({ timeEntryId: "te-1", subjectId: "subject-1" });
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.followUp }));
    await fireEvent.press(screen.getByRole("button", { name: ar.review.actions.confirmFollowUp }));
    expect(mockClient.handleNotificationSubject).toHaveBeenCalledWith("subject-1", undefined);
    await screen.unmount();

    mockClient.getNotificationSubject.mockResolvedValue({
      ...UNHANDLED,
      handled: { at: "2026-10-14T15:30:00.000Z", by: { userId: "user-2", fullLegalName: "سامي حداد" }, outcome: "REVIEWED", note: null },
    });
    await renderLoaded({ timeEntryId: "te-1", subjectId: "subject-1" });
    expect(await screen.findByText(`النتيجة: ${ar.enums.NotificationHandledOutcome.REVIEWED}`)).toBeOnTheScreen();
    expect(actions().queryByRole("button", { name: ar.review.actions.followUp })).not.toBeOnTheScreen();
  });

  it("«تمت المتابعة» is only for a member who may settle attendance (approve or correct), like the API", async () => {
    mockClient.getTimeEntryEvidence.mockResolvedValue(openEntry());
    // «محاسب»: reads attendance and money, settles nothing.
    mockPermissions = new Set([Permission.VIEW_ATTENDANCE, Permission.VIEW_FINANCIALS, Permission.VIEW_PAYROLL]);
    await renderLoaded({ timeEntryId: "te-1", subjectId: "subject-1" });
    expect(screen.queryByRole("button", { name: ar.review.actions.followUp })).not.toBeOnTheScreen();
    await screen.unmount();

    mockPermissions = new Set([Permission.VIEW_ATTENDANCE, Permission.CORRECT_TIME_ENTRIES]);
    await renderLoaded({ timeEntryId: "te-1", subjectId: "subject-1" });
    expect(actions().getByRole("button", { name: ar.review.actions.followUp })).toBeOnTheScreen();
  });

  it("open entry: the manual correction adds the missing clock-out (a 9-hour day with a 480-minute standard day gives 60 overtime minutes)", async () => {
    freezeDate("2026-10-14T14:15:00.000Z");
    mockClient.getTimeEntryEvidence.mockResolvedValue(openEntry());
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.manualCorrection }));
    const form = within(screen.getByTestId("correction-form"));
    expect(form.getByRole("radio", { name: ar.review.correction.types.ADD_MISSING_CLOCK_OUT })).toBeChecked();
    expect(form.queryByRole("radio", { name: ar.review.correction.types.CORRECT_UNPAID_BREAK })).not.toBeOnTheScreen();
    // Starts at now (to the minute), in Jerusalem.
    expect(screen.getByTestId("correction-time-value")).toHaveTextContent("14 أكتوبر 2026 في 17:15");
    expect(screen.getByTestId("preview-now-worked")).toHaveTextContent("—");

    await pick("correction-time-time", "2026-10-14T14:00:00.000Z");
    expect(screen.getByTestId("preview-worked")).toHaveTextContent("9 س 0 د");
    expect(screen.getByTestId("preview-regular")).toHaveTextContent("8 س 0 د");
    expect(screen.getByTestId("preview-overtime")).toHaveTextContent("1 س 0 د");

    // A new clock-in on a running entry leaves it running: nothing to count yet.
    await fireEvent.press(form.getByRole("radio", { name: ar.review.correction.types.CORRECT_CLOCK_IN }));
    expect(form.getByText(ar.review.correction.preview.stillOpen)).toBeOnTheScreen();
    await fireEvent.press(form.getByRole("radio", { name: ar.review.correction.types.ADD_MISSING_CLOCK_OUT }));
    await pick("correction-time-time", "2026-10-14T14:00:00.000Z");

    await fireEvent.press(form.getByRole("radio", { name: ar.enums.CorrectionReason.FORGOTTEN_CLOCK_OUT }));
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(mockClient.createManualCorrection).toHaveBeenCalledWith({ timeEntryId: "te-1", field: "CLOCK_OUT", newValue: "2026-10-14T14:00:00.000Z", reason: "FORGOTTEN_CLOCK_OUT" });
    expect(await screen.findByText(fill(ar.review.messages.corrected, { name: iso(NAME) }))).toBeOnTheScreen();
  });

  it("Android: the date and time buttons open the system pickers in Asia/Jerusalem", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const open = jest.spyOn(DateTimePickerAndroid, "open").mockImplementation(() => undefined);
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.manualCorrection }));
    await fireEvent.press(screen.getByRole("button", { name: ar.review.correction.changeTime }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ mode: "time", timeZoneName: "Asia/Jerusalem", is24Hour: true }));
    const { onValueChange } = open.mock.calls[0][0];
    await act(async () => onValueChange?.({ nativeEvent: { timestamp: Date.parse("2026-10-14T04:30:00.000Z"), utcOffset: 180 } }, new Date("2026-10-14T04:30:00.000Z")));
    expect(screen.getByTestId("correction-time-value")).toHaveTextContent("14 أكتوبر 2026 في 07:30");

    await fireEvent.press(screen.getByRole("button", { name: ar.review.correction.changeDate }));
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "date", timeZoneName: "Asia/Jerusalem" }));
  });

  it("web (no native picker): the time is typed as Jerusalem wall-clock time", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.manualCorrection }));
    const form = within(screen.getByTestId("correction-form"));
    await fireEvent.press(form.getByRole("radio", { name: ar.review.correction.types.CORRECT_CLOCK_OUT }));
    const input = screen.getByLabelText(ar.review.correction.timeInput);
    expect(input.props.value).toBe("2026-10-14 15:00");

    await fireEvent.changeText(input, "2026-10-14 17:00");
    expect(screen.getByTestId("preview-overtime")).toHaveTextContent("1 س 0 د");
    await fireEvent.changeText(input, "2026-10-14 25:00");
    await fireEvent.press(form.getByRole("radio", { name: ar.enums.CorrectionReason.SYSTEM_ERROR }));
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(form.getByText(ar.review.correction.errors.timeRequired)).toBeOnTheScreen();
    expect(mockClient.createManualCorrection).not.toHaveBeenCalled();

    await fireEvent.changeText(input, "2026-10-14 17:00");
    await fireEvent.press(form.getByRole("button", { name: ar.review.correction.submit }));
    expect(mockClient.createManualCorrection).toHaveBeenCalledWith({ timeEntryId: "te-1", field: "CLOCK_OUT", newValue: "2026-10-14T14:00:00.000Z", reason: "SYSTEM_ERROR" });
  });

  it("after a decision: back to the manager home when there is nothing to go back to, and never from a screen opened on top meanwhile", async () => {
    navigation.canGoBack.mockReturnValue(false);
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.approve }));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith("Main"));
    expect(navigation.goBack).not.toHaveBeenCalled();
    await screen.unmount();

    navigation.canGoBack.mockReturnValue(true);
    navigation.isFocused.mockReturnValue(false);
    await renderLoaded();
    await fireEvent.press(actions().getByRole("button", { name: ar.review.actions.approve }));
    expect(await screen.findByText(fill(ar.review.messages.approved, { name: iso(NAME) }))).toBeOnTheScreen();
    await waitFor(() => expect(navigation.isFocused).toHaveBeenCalled());
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("a call that the phone cannot start shows the number to dial", async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("no dialer"));
    await renderLoaded();
    await fireEvent.press(screen.getByRole("button", { name: ar.review.worker.call }));
    expect(await screen.findByText(fill(ar.review.worker.callFailed, { phone: ltr(PHONE) }))).toBeOnTheScreen();
  });
});

describe("fromJerusalemText", () => {
  it("reads Asia/Jerusalem wall-clock time in summer and winter, and refuses malformed text", () => {
    expect(fromJerusalemText("2026-10-14 17:00")?.toISOString()).toBe("2026-10-14T14:00:00.000Z");
    expect(fromJerusalemText("2026-12-01T08:30")?.toISOString()).toBe("2026-12-01T06:30:00.000Z");
    expect(fromJerusalemText("2026-02-30 10:00")).toBeNull();
    expect(fromJerusalemText("2026-10-14 24:00")).toBeNull();
    expect(fromJerusalemText("غدًا")).toBeNull();
  });
});
