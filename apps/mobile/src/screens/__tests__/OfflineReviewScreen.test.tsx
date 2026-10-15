import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { NetworkError, type NotificationSubject, type OfflineSyncBatchRecord } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { OfflineReviewScreen } from "../OfflineReviewScreen";
import { deferred, doubleTap, expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { listWorkerOfflineSyncBatches: jest.fn(), getNotificationSubject: jest.fn(), handleNotificationSubject: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } }) }));
const mockPermissions = new Set<string>();
jest.mock("../../lib/access-context", () => ({ useAccess: () => ({ can: (permission: string) => mockPermissions.has(permission), isManager: true }) }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

type Props = NativeStackScreenProps<RootStackParamList, "OfflineReview">;
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

const t = ar.offlineReview;
const FSI = "⁨";
const PDI = "⁩";
const iso = (value: string) => `${FSI}${value}${PDI}`;

type Event = OfflineSyncBatchRecord["events"][number] & { resultTimeEntryId?: string | null };
const event = (overrides: Partial<Event> & Pick<Event, "id" | "status">): Event => ({
  clientEventId: `c-${overrides.id}`,
  eventType: "CLOCK_IN",
  rejectionReason: null,
  deviceTimestamp: "2026-10-15T05:00:00.000Z",
  resultTimeEntryId: null,
  ...overrides,
});

const BATCHES: OfflineSyncBatchRecord[] = [
  {
    id: "b-2",
    deviceId: "device-1",
    eventCount: 3,
    submittedAt: "2026-10-15T09:00:00.000Z",
    events: [
      event({ id: "e-geo", status: "REJECTED", eventType: "CLOCK_OUT", rejectionReason: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS", deviceTimestamp: "2026-10-15T08:00:00.000Z" }),
      event({ id: "e-flag", status: "FLAGGED", deviceTimestamp: "2026-10-15T07:00:00.000Z", resultTimeEntryId: "te-flagged" }),
      event({ id: "e-ok", status: "VERIFIED", deviceTimestamp: "2026-10-15T06:00:00.000Z", resultTimeEntryId: "te-ok" }),
    ],
  },
  {
    id: "b-1",
    deviceId: "device-1",
    eventCount: 4,
    submittedAt: "2026-10-14T18:00:00.000Z",
    events: [
      // A code without a manager's wording: the API code's Arabic text.
      event({ id: "e-early", status: "REJECTED", rejectionReason: "CLOCK_IN_TOO_EARLY", deviceTimestamp: "2026-10-14T03:00:00.000Z" }),
      event({ id: "e-odd", status: "REJECTED", rejectionReason: "SOMETHING_UNKNOWN", deviceTimestamp: "2026-10-14T02:00:00.000Z" }),
      // Flagged, but the API did not say which entry it made.
      event({ id: "e-flag-old", status: "FLAGGED", eventType: "CLOCK_OUT", deviceTimestamp: "2026-10-14T15:00:00.000Z" }),
      event({ id: "e-dup", status: "DUPLICATE", deviceTimestamp: "2026-10-14T01:00:00.000Z", resultTimeEntryId: "te-ok" }),
    ],
  },
];

const OPEN_SUBJECT: NotificationSubject = { id: "subj-offline", kind: "OFFLINE_REVIEW", handled: null };
const HANDLED_SUBJECT: NotificationSubject = {
  id: "subj-offline",
  kind: "OFFLINE_REVIEW",
  handled: { at: "2026-10-15T10:00:00.000Z", by: { userId: "u-9", fullLegalName: "سارة لوي" }, outcome: "REVIEWED", note: "تواصلت مع العامل" },
};

function renderScreen(params: Props["route"]["params"] = { workerProfileId: "wp-2", subjectId: "subj-offline" }) {
  return renderInArabic(<OfflineReviewScreen navigation={navigation as unknown as Props["navigation"]} route={{ key: "OfflineReview-1", name: "OfflineReview", params }} />);
}

const reviewedButton = () => screen.getByRole("button", { name: t.markReviewed });

beforeEach(() => {
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockPermissions.clear();
  mockPermissions.add(Permission.VIEW_ATTENDANCE);
  mockSync.isOnline = true;
  mockClient.listWorkerOfflineSyncBatches.mockResolvedValue(BATCHES);
  mockClient.getNotificationSubject.mockResolvedValue(OPEN_SUBJECT);
  mockClient.handleNotificationSubject.mockResolvedValue(HANDLED_SUBJECT);
});

describe("OfflineReviewScreen (Arabic, RTL)", () => {
  it("names the worker when opened from the in-app notification", async () => {
    mockClient.listWorkerOfflineSyncBatches.mockResolvedValue(BATCHES);
    await renderScreen({ workerProfileId: "wp-2", subjectId: "subj-offline", workerName: "ليلى ناصر" });
    expect(await screen.findByText(fill(t.worker, { name: "ليلى ناصر" }))).toBeOnTheScreen();
  });

  it("lists the worker's refused records with the reason in Arabic, and the flagged ones, newest first", async () => {
    const batches = deferred<OfflineSyncBatchRecord[]>();
    mockClient.listWorkerOfflineSyncBatches.mockReturnValue(batches.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: t.title })).toBeOnTheScreen();
    await act(async () => batches.resolve(BATCHES));

    expect(screen.getByText(t.intro)).toBeOnTheScreen();
    expect(mockClient.listWorkerOfflineSyncBatches).toHaveBeenCalledWith("wp-2");
    expect(screen.getByText("مرفوضة: 3\nتحتاج إلى مراجعة الموقع: 2")).toBeOnTheScreen();

    // Refused: why, about the worker (not "you"); a code without such wording gets the API code's Arabic text; never the code.
    expect(screen.getByText("سبب الرفض: كان العامل خارج نطاق الموقع عند حفظ هذا التسجيل.")).toBeOnTheScreen();
    expect(screen.getByText(`سبب الرفض: ${ar.errors.CLOCK_IN_TOO_EARLY}`)).toBeOnTheScreen();
    expect(screen.getByText(`سبب الرفض: ${t.unknownReason}`)).toBeOnTheScreen();
    expect(screen.getAllByText(t.rejectedHint)).toHaveLength(3);
    expect(screen.getAllByText(ar.enums.OfflineSyncEventStatus.REJECTED)).toHaveLength(3);
    // Flagged: recorded, the location needs a review.
    expect(screen.getAllByText(t.flaggedHint)).toHaveLength(2);
    expect(screen.getAllByText(ar.enums.OfflineSyncEventStatus.FLAGGED)).toHaveLength(2);
    // Accepted and duplicate records need nothing.
    expect(screen.queryByTestId("offline-record-e-ok")).not.toBeOnTheScreen();
    expect(screen.queryByTestId("offline-record-e-dup")).not.toBeOnTheScreen();
    // When the phone saved it and when it reached the server (Asia/Jerusalem, Western digits).
    expect(screen.getByText("وقت التسجيل على الهاتف: 15 أكتوبر 2026 في 11:00")).toBeOnTheScreen();
    expect(screen.getAllByText("وصل إلى الخادم: 15 أكتوبر 2026 في 12:00")).toHaveLength(2);
    expect(screen.getAllByText(ar.enums.ClockEventType.CLOCK_OUT).length).toBeGreaterThan(0);

    const order = ["e-geo", "e-flag", "e-flag-old", "e-early", "e-odd"].map((id) => screen.getByTestId(`offline-record-${id}`));
    const all = screen.getAllByTestId(/^offline-record-/);
    expect(all).toEqual(order);
    expect(screen.queryByText(/GEOFENCE|CLOCK_IN_TOO_EARLY|SOMETHING_UNKNOWN/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("opens the entry a flagged record made («مراجعة الحضور»), without this screen's subject", async () => {
    await renderScreen();
    const buttons = await screen.findAllByRole("button", { name: t.openEntry });
    // The older flagged record has no entry to open.
    expect(buttons).toHaveLength(1);
    await fireEvent.press(buttons[0]);
    expect(navigation.navigate).toHaveBeenCalledWith("AttendanceReview", { timeEntryId: "te-flagged" });
  });

  it("«تمّت المراجعة» with a note settles it for every manager, then goes back", async () => {
    await renderScreen();
    await screen.findByText(t.intro);
    expect(mockClient.getNotificationSubject).toHaveBeenCalledWith("subj-offline");

    await fireEvent.changeText(screen.getByLabelText(t.noteLabel), "  تواصلت مع العامل  ");
    await fireEvent.press(reviewedButton());
    expect(mockClient.handleNotificationSubject).toHaveBeenCalledWith("subj-offline", "تواصلت مع العامل");
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("the note is optional, and a fast double tap settles once", async () => {
    await renderScreen();
    await screen.findByText(t.intro);
    await doubleTap(reviewedButton());
    expect(mockClient.handleNotificationSubject).toHaveBeenCalledTimes(1);
    expect(mockClient.handleNotificationSubject).toHaveBeenCalledWith("subj-offline", undefined);
  });

  it("says in Arabic when settling fails, and stays", async () => {
    mockClient.handleNotificationSubject.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await screen.findByText(t.intro);
    await fireEvent.press(reviewedButton());

    expect(await screen.findByText(ar.errors.network)).toBeOnTheScreen();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(reviewedButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("shows who already settled it, when and how, without «تمّت المراجعة»", async () => {
    mockClient.getNotificationSubject.mockResolvedValue(HANDLED_SUBJECT);
    await renderScreen();
    expect(await screen.findByText(`تمت المعالجة بواسطة ${iso("سارة لوي")} في 15 أكتوبر 2026 في 13:00`)).toBeOnTheScreen();
    expect(screen.getByText("النتيجة: تمت المراجعة")).toBeOnTheScreen();
    expect(screen.getByText(`ملاحظة: ${iso("تواصلت مع العامل")}`)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.markReviewed })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("still offers «تمّت المراجعة» when the state could not be read", async () => {
    mockClient.getNotificationSubject.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(t.subjectLoadError)).toBeOnTheScreen();
    expect(reviewedButton()).toBeOnTheScreen();
  });

  it("opened without a subject (not from a notification): the records only", async () => {
    await renderScreen({ workerProfileId: "wp-2" });
    await screen.findByText(t.intro);
    expect(mockClient.getNotificationSubject).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: t.markReviewed })).not.toBeOnTheScreen();
  });

  it("says when nothing was refused or flagged", async () => {
    mockClient.listWorkerOfflineSyncBatches.mockResolvedValue([{ ...BATCHES[0], events: [BATCHES[0].events[2]] }]);
    await renderScreen();
    expect(await screen.findByText(t.empty)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows an Arabic error and retries", async () => {
    mockClient.listWorkerOfflineSyncBatches.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${t.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(t.intro)).toBeOnTheScreen();
    expect(screen.queryByText(`${t.loadError}\n${ar.errors.network}`)).not.toBeOnTheScreen();
  });

  it("without VIEW_ATTENDANCE: says so, and asks the API nothing", async () => {
    mockPermissions.clear();
    await renderScreen();
    expect(screen.getByText(ar.states.accessDeniedTitle)).toBeOnTheScreen();
    expect(mockClient.listWorkerOfflineSyncBatches).not.toHaveBeenCalled();
    expect(mockClient.getNotificationSubject).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("goes back", async () => {
    await renderScreen();
    await screen.findByText(t.intro);
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
