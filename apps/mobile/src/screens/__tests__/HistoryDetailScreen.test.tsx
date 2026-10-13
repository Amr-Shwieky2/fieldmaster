import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type ClockEvent, type MyEntryPay, type MyTimeEntryDetail } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { HistoryDetailScreen } from "../HistoryDetailScreen";
import { deferred, expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { getMyTimeEntry: jest.fn(), getMyEntryPay: jest.fn() };
const mockAuth = { client: mockClient, session: { role: "WORKER", workerProfileId: "worker-1" } as { role: string; workerProfileId: string | null } };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

type Navigation = NativeStackScreenProps<RootStackParamList, "HistoryDetail">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

const iso = (value: string) => `⁨${value}⁩`;
const ltr = (value: string) => `⁦${value}⁩`;

function clockEvent(overrides: Partial<ClockEvent> & Pick<ClockEvent, "eventType">): ClockEvent {
  return {
    id: `ce-${overrides.eventType}`,
    timeEntryId: "te-1",
    origin: "ONLINE",
    deviceId: "mobile-1",
    clientEventId: `evt-${overrides.eventType}`,
    deviceTimestamp: "2026-01-15T08:29:30.000Z",
    serverReceivedAt: "2026-01-15T08:30:00.000Z",
    deviceTimeDeviationSeconds: 30,
    latitude: 32.0853,
    longitude: 34.7818,
    accuracyMeters: 7.6,
    mockLocationSuspected: false,
    mockLocationState: "NOT_DETECTED",
    distanceFromSiteMeters: 42.4,
    locationValidationStatus: "PASSED",
    ...overrides,
  };
}

function detail(overrides: Partial<MyTimeEntryDetail> = {}): MyTimeEntryDetail {
  return {
    id: "te-1",
    organizationId: "org-1",
    workerProfileId: "worker-1",
    shiftId: "shift-1",
    status: "APPROVED",
    businessDate: "2026-01-15",
    clockInAt: "2026-01-15T08:30:00.000Z",
    clockOutAt: "2026-01-15T17:45:00.000Z",
    rawDurationMinutes: 555,
    approvedRegularMinutes: 540,
    approvedOvertimeMinutes: 15,
    fullDayCredit: false,
    shift: { id: "shift-1", title: "صيانة إشارات شارع يافا", shiftType: "STANDARD" } as MyTimeEntryDetail["shift"],
    clockEvents: [
      clockEvent({ eventType: "CLOCK_IN" }),
      clockEvent({
        eventType: "CLOCK_OUT",
        origin: "OFFLINE",
        deviceTimestamp: "2026-01-15T17:45:00.000Z",
        serverReceivedAt: "2026-01-15T18:10:00.000Z",
        locationValidationStatus: "FLAGGED",
        distanceFromSiteMeters: null,
        accuracyMeters: 25,
        mockLocationState: "UNAVAILABLE",
      }),
    ],
    corrections: [
      {
        field: "clockOutAt",
        oldValue: "2026-01-15T16:00:00.000Z",
        newValue: "2026-01-15T17:45:00.000Z",
        reason: "FORGOTTEN_CLOCK_OUT",
        note: "نسي العامل التسجيل",
        correctedAt: "2026-01-16T07:00:00.000Z",
        correctedByName: "سامي حداد",
      },
      { field: "unpaidBreakMinutes", oldValue: "0", newValue: "30", reason: "MANAGER_INSTRUCTION", note: null, correctedAt: "2026-01-16T07:05:00.000Z", correctedByName: null },
    ],
    summary: { text: "ركّبنا إشارتين جديدتين.", taskCategory: "TRAFFIC_LIGHT_INSTALLATION", followUpRequired: true, summarySource: "VOICE", hasVoiceNote: true },
    photoCount: 3,
    ...overrides,
  };
}

const PAY: MyEntryPay = {
  timeEntryId: "te-1",
  approved: true,
  compensationType: "DAILY",
  regularMinutes: 540,
  overtimeMinutes: 15,
  compensatedMinutes: null,
  baseAgorot: 45000,
  overtimeAgorot: 1500,
  totalAgorot: 46500,
  finalized: false,
};

function renderScreen(timeEntryId = "te-1") {
  return renderInArabic(<HistoryDetailScreen navigation={navigation as unknown as Navigation} route={{ key: "HistoryDetail-1", name: "HistoryDetail", params: { timeEntryId } }} />);
}

beforeEach(() => {
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockAuth.session = { role: "WORKER", workerProfileId: "worker-1" };
  mockClient.getMyTimeEntry.mockResolvedValue(detail());
  mockClient.getMyEntryPay.mockResolvedValue(PAY);
});

describe("HistoryDetailScreen (Arabic, RTL)", () => {
  it("shows the loading state, then the entry's times as validated, on the phone and at the server (Asia/Jerusalem)", async () => {
    const answer = deferred<MyTimeEntryDetail>();
    mockClient.getMyTimeEntry.mockReturnValue(answer.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.history.detail.title })).toBeOnTheScreen();

    await act(async () => answer.resolve(detail()));
    expect(mockClient.getMyTimeEntry).toHaveBeenCalledWith("te-1");
    expect(screen.getByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.TimeEntryStatus.APPROVED)).toBeOnTheScreen();
    expect(screen.getByText("15 يناير 2026")).toBeOnTheScreen();
    expect(screen.getByText("بدء الدوام: 15 يناير 2026 في 10:30")).toBeOnTheScreen();
    expect(screen.getByText("وقت الهاتف: 15 يناير 2026 في 10:29")).toBeOnTheScreen();
    expect(screen.getByText("وقت الوصول إلى الخادم: 15 يناير 2026 في 10:30")).toBeOnTheScreen();
    expect(screen.getByText("إنهاء الدوام: 15 يناير 2026 في 19:45")).toBeOnTheScreen();
    expect(screen.getByText("وقت الوصول إلى الخادم: 15 يناير 2026 في 20:10")).toBeOnTheScreen();
    expect(screen.getByText(ar.history.detail.offline)).toBeOnTheScreen();
    expect(screen.getByText("مدة الدوام: 9 س 15 د")).toBeOnTheScreen();
    expect(screen.getByText("ساعات عادية معتمدة: 9 س 0 د")).toBeOnTheScreen();
    expect(screen.getByText("ساعات إضافية معتمدة: 0 س 15 د")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the location result of each event: inside or not, distance, accuracy and the fake-location state", async () => {
    await renderScreen();
    expect(await screen.findByText(ar.history.detail.locationResult.PASSED)).toBeOnTheScreen();
    expect(screen.getByText("داخل نطاق الموقع")).toBeOnTheScreen();
    expect(screen.getByText("المسافة عن الموقع: 42 م")).toBeOnTheScreen();
    expect(screen.getByText("دقة تحديد الموقع: 8 م")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.history.detail.mockLocation, { state: ar.enums.MockLocationState.NOT_DETECTED }))).toBeOnTheScreen();
    expect(screen.getByText(ar.history.detail.locationResult.FLAGGED)).toBeOnTheScreen();
    expect(screen.getByText("دقة تحديد الموقع: 25 م")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.history.detail.mockLocation, { state: ar.enums.MockLocationState.UNAVAILABLE }))).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("lists the corrections with their reasons and notes", async () => {
    await renderScreen();
    expect(await screen.findByText(ar.history.detail.correctionField.clockOutAt)).toBeOnTheScreen();
    expect(screen.getByText("من 15 يناير 2026 في 18:00 إلى 15 يناير 2026 في 19:45")).toBeOnTheScreen();
    expect(screen.getByText(`السبب: ${ar.enums.CorrectionReason.FORGOTTEN_CLOCK_OUT}`)).toBeOnTheScreen();
    expect(screen.getByText(`ملاحظة: ${iso("نسي العامل التسجيل")}`)).toBeOnTheScreen();
    expect(screen.getByText(`بواسطة ${iso("سامي حداد")} في 16 يناير 2026 في 09:00`)).toBeOnTheScreen();
    expect(screen.getByText(ar.history.detail.correctionField.unpaidBreakMinutes)).toBeOnTheScreen();
    expect(screen.getByText("من 0 س 0 د إلى 0 س 30 د")).toBeOnTheScreen();
    expect(screen.getByText(`السبب: ${ar.enums.CorrectionReason.MANAGER_INSTRUCTION}`)).toBeOnTheScreen();
    expect(screen.getByText("في 16 يناير 2026 في 09:05")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the daily summary (text, category, follow-up, voice note) and the photo count", async () => {
    await renderScreen();
    expect(await screen.findByText(iso("ركّبنا إشارتين جديدتين."))).toBeOnTheScreen();
    expect(screen.getByText(`نوع العمل: ${ar.enums.TaskCategory.TRAFFIC_LIGHT_INSTALLATION}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.SummarySource.VOICE)).toBeOnTheScreen();
    expect(screen.getByText(ar.history.detail.voiceNote)).toBeOnTheScreen();
    expect(screen.getByText(ar.history.detail.followUp)).toBeOnTheScreen();
    expect(screen.getByText("الصور المرفقة: 3")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the worker's own pay once approved, labelled «تقدير» before the month is final", async () => {
    await renderScreen();
    expect(await screen.findByText(`المجموع: ${ltr("₪ 465.00")}`)).toBeOnTheScreen();
    expect(mockClient.getMyEntryPay).toHaveBeenCalledWith("te-1");
    expect(screen.getByText("تقدير")).toBeOnTheScreen();
    expect(screen.queryByText("نهائي")).not.toBeOnTheScreen();
    expect(screen.getByText(`الأجر الأساسي: ${ltr("₪ 450.00")}`)).toBeOnTheScreen();
    expect(screen.getByText(`أجر الساعات الإضافية: ${ltr("₪ 15.00")}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.history.detail.payEstimateHint)).toBeOnTheScreen();
    expectArabicOnly(["₪"]);
  });

  it("labels the pay «نهائي» when the month is finalized, with the emergency minutes", async () => {
    mockClient.getMyEntryPay.mockResolvedValue({ ...PAY, finalized: true, compensatedMinutes: 255 });
    await renderScreen();
    expect(await screen.findByText("نهائي")).toBeOnTheScreen();
    expect(screen.queryByText("تقدير")).not.toBeOnTheScreen();
    expect(screen.getByText("المدة المحتسبة لاستدعاء الطوارئ: 4 س 15 د")).toBeOnTheScreen();
  });

  it("asks for no pay before approval, and says when it will show", async () => {
    mockClient.getMyTimeEntry.mockResolvedValue(detail({ status: "PENDING_APPROVAL", approvedRegularMinutes: null, approvedOvertimeMinutes: null }));
    await renderScreen();
    expect(await screen.findByText(ar.history.detail.payPending)).toBeOnTheScreen();
    expect(mockClient.getMyEntryPay).not.toHaveBeenCalled();
    expect(screen.queryByText(/₪/)).not.toBeOnTheScreen();
  });

  it("shows the manager's reason on a rejected entry", async () => {
    mockClient.getMyTimeEntry.mockResolvedValue(detail({ status: "REJECTED", rejectedReason: "Wrong site" }));
    await renderScreen();
    expect(await screen.findByText(`سبب الرفض: ${iso("Wrong site")}`)).toBeOnTheScreen();
    expect(mockClient.getMyEntryPay).not.toHaveBeenCalled();
  });

  it("shows a pay error with a retry, without hiding the rest", async () => {
    mockClient.getMyEntryPay.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.history.detail.payLoadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(`المجموع: ${ltr("₪ 465.00")}`)).toBeOnTheScreen();
  });

  it("never shows (or asks the pay of) another worker's entry", async () => {
    mockClient.getMyTimeEntry.mockResolvedValue(detail({ workerProfileId: "worker-2" }));
    await renderScreen();
    expect(await screen.findByText(ar.history.detail.notFound)).toBeOnTheScreen();
    expect(screen.queryByText(iso("صيانة إشارات شارع يافا"))).not.toBeOnTheScreen();
    expect(mockClient.getMyEntryPay).not.toHaveBeenCalled();
  });

  it.each([
    ["404", new ApiRequestError(404, { statusCode: 404, code: "NOT_FOUND", message: "Time entry not found.", correlationId: "c" })],
    ["403", new ApiRequestError(403, { statusCode: 403, code: "FORBIDDEN", message: "You cannot view another worker's attendance record.", correlationId: "c" })],
  ])("says the entry is not in the worker's history on a %s", async (_status, error) => {
    mockClient.getMyTimeEntry.mockRejectedValue(error);
    await renderScreen();
    expect(await screen.findByText(ar.history.detail.notFound)).toBeOnTheScreen();
    expect(screen.queryByText(/not found|another worker/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("offline: the connection banner and the Arabic network error with a retry", async () => {
    mockSync.isOnline = false;
    mockClient.getMyTimeEntry.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.history.detail.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
  });
});
