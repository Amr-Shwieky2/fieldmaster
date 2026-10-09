import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { isolateLtr } from "../../components/LtrText";
import ar from "../../i18n/messages";
import type { QueuedEvent, QueuedEventLocalStatus } from "../../lib/offline-queue";
import { useOfflineSync } from "../../lib/offline-sync-context";
import type { RootStackParamList } from "../../navigation/types";
import { OfflineQueueScreen } from "../OfflineQueueScreen";
import { deferred, expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: jest.fn() }));

type Navigation = NativeStackScreenProps<RootStackParamList, "OfflineQueue">["navigation"];

let navigation: { navigate: jest.Mock; replace: jest.Mock; goBack: jest.Mock };
let syncNow: jest.Mock;
let syncState: { isOnline: boolean; queue: QueuedEvent[] };

function queued(overrides: Partial<QueuedEvent> & { clientEventId: string; queuedAt: string }): QueuedEvent {
  return {
    eventType: "CLOCK_IN",
    shiftId: "shift-1",
    deviceTimestamp: overrides.queuedAt,
    latitude: 32.0853,
    longitude: 34.7818,
    accuracyMeters: 7.6,
    locationProvider: "expo-location",
    mockLocationSuspected: false,
    signature: "c2lnbmF0dXJl",
    localStatus: "PENDING",
    ...overrides,
  };
}

beforeEach(() => {
  navigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
  syncNow = jest.fn(async () => undefined);
  syncState = { isOnline: true, queue: [] };
  jest
    .mocked(useOfflineSync)
    .mockImplementation(() => ({ ...syncState, pendingCount: 0, queueOfflineEvent: jest.fn(), syncNow }) as unknown as ReturnType<typeof useOfflineSync>);
});

function renderScreen() {
  return renderInArabic(
    <OfflineQueueScreen navigation={navigation as unknown as Navigation} route={{ key: "OfflineQueue-1", name: "OfflineQueue", params: undefined }} />,
  );
}

const syncButton = () => screen.getByRole("button", { name: ar.offlineQueue.syncNow });

describe("OfflineQueueScreen (Arabic, RTL)", () => {
  it("shows the empty state, the online banner and the sync button in Arabic", async () => {
    await renderScreen();

    expect(screen.getByRole("header", { name: ar.offlineQueue.title })).toBeOnTheScreen();
    expect(screen.getByText(ar.offlineQueue.online)).toBeOnTheScreen();
    expect(screen.queryByText(ar.offlineQueue.offline)).not.toBeOnTheScreen();
    expect(screen.getByText(ar.offlineQueue.empty)).toBeOnTheScreen();
    expect(syncButton()).toBeEnabled();
    expectArabicOnly();
  });

  it("shows the offline banner while offline, and a manual sync is not offered until the connection is back", async () => {
    syncState = { isOnline: false, queue: [queued({ clientEventId: "a", queuedAt: "2026-01-15T08:30:00.000Z" })] };
    await renderScreen();

    expect(screen.getByText(ar.offlineQueue.offline)).toBeOnTheScreen();
    expect(screen.getByText("لا يوجد اتصال. ستُرسل التسجيلات تلقائيًا عند عودة الاتصال.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.offlineQueue.online)).not.toBeOnTheScreen();
    expect(screen.getByText(ar.offlineQueue.status.PENDING)).toBeOnTheScreen();
    expectArabicOnly();

    // Offline, "sync now" cannot reach anyone: it is disabled instead of spinning and silently doing nothing.
    expect(syncButton()).toBeDisabled();
    await fireEvent.press(syncButton());
    expect(syncNow).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: ar.offlineQueue.syncing })).not.toBeOnTheScreen();
  });

  it("lists the saved events newest first, with Arabic event type, status, capture time (Asia/Jerusalem), location and accuracy", async () => {
    syncState = {
      isOnline: false,
      queue: [
        // 10:30 / 17:45 in Jerusalem (winter, UTC+2); 00:30 on 16 July (summer, UTC+3).
        queued({ clientEventId: "a", eventType: "CLOCK_IN", queuedAt: "2026-01-15T08:30:00.000Z" }),
        queued({ clientEventId: "c", eventType: "CLOCK_IN", queuedAt: "2026-07-15T21:30:00.000Z", localStatus: "SYNCING", accuracyMeters: 12.4 }),
        queued({ clientEventId: "b", eventType: "CLOCK_OUT", queuedAt: "2026-01-15T15:45:00.000Z", localStatus: "VERIFIED", latitude: 31.7683, longitude: 35.2137 }),
      ],
    };
    await renderScreen();

    const captured = screen.getAllByText(/^وقت التسجيل: /).map((node) => node.props.children);
    expect(captured).toEqual([
      fill(ar.offlineQueue.capturedAt, { time: "16 يوليو 2026 في 00:30" }),
      fill(ar.offlineQueue.capturedAt, { time: "15 يناير 2026 في 17:45" }),
      fill(ar.offlineQueue.capturedAt, { time: "15 يناير 2026 في 10:30" }),
    ]);
    expect(screen.getByText("وقت التسجيل: 15 يناير 2026 في 10:30")).toBeOnTheScreen();

    expect(screen.getAllByText(ar.enums.ClockEventType.CLOCK_IN)).toHaveLength(2);
    expect(screen.getByText(ar.enums.ClockEventType.CLOCK_OUT)).toBeOnTheScreen();
    expect(screen.getByText("إنهاء الدوام")).toBeOnTheScreen();

    expect(screen.getByText(ar.offlineQueue.status.PENDING)).toBeOnTheScreen();
    expect(screen.getByText(ar.offlineQueue.status.SYNCING)).toBeOnTheScreen();
    expect(screen.getByText(ar.offlineQueue.status.VERIFIED)).toBeOnTheScreen();

    // Coordinates are a left-to-right run inside the Arabic sentence, 5 decimals.
    expect(screen.getAllByText(fill(ar.offlineQueue.location, { coordinates: isolateLtr("32.08530, 34.78180") }))).toHaveLength(2);
    expect(screen.getByText(fill(ar.offlineQueue.location, { coordinates: isolateLtr("31.76830, 35.21370") }))).toBeOnTheScreen();
    // Accuracy in whole meters.
    expect(screen.getAllByText("الدقة: 8 م")).toHaveLength(2);
    expect(screen.getByText(fill(ar.offlineQueue.accuracy, { meters: "12" }))).toBeOnTheScreen();

    expect(screen.queryByText(ar.offlineQueue.empty)).not.toBeOnTheScreen();
    expect(screen.getByText(ar.offlineQueue.offline)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows every local status as an Arabic badge (worker wording), and the next step only on the rejected one", async () => {
    const statuses: QueuedEventLocalStatus[] = ["PENDING", "SYNCING", "VERIFIED", "FLAGGED", "REJECTED", "DUPLICATE"];
    syncState = {
      isOnline: true,
      queue: statuses.map((localStatus, i) => queued({ clientEventId: localStatus, queuedAt: `2026-01-15T0${i}:00:00.000Z`, localStatus })),
    };
    await renderScreen();

    for (const status of statuses) expect(screen.getByText(ar.offlineQueue.status[status])).toBeOnTheScreen();
    for (const status of statuses) expect(screen.queryByText(status)).not.toBeOnTheScreen();
    expect(screen.getByText("تم القبول")).toBeOnTheScreen();
    expect(screen.getByText("بحاجة إلى مراجعة")).toBeOnTheScreen();
    expect(screen.getByText("تمت مزامنته سابقًا")).toBeOnTheScreen();
    expect(screen.getAllByText(ar.offlineQueue.rejectedHint)).toHaveLength(1);
    // A rejected record without a reason gets no reason line, only the next step.
    expect(screen.queryByText(ar.offlineQueue.unknownReason)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("explains why each rejected record was refused, in the past tense, with the next step, never as raw codes", async () => {
    // The server sends a reason only with REJECTED, and a rejection is final (only waiting records are sent again).
    const rejected = (clientEventId: string, minute: number, reason: string) =>
      queued({ clientEventId, queuedAt: `2026-01-15T08:0${minute}:00.000Z`, localStatus: "REJECTED", reason });
    syncState = {
      isOnline: true,
      queue: [
        rejected("geo", 0, "GEOFENCE_OUTSIDE_ALLOWED_RADIUS"),
        rejected("open", 1, "ACTIVE_TIME_ENTRY_EXISTS"),
        rejected("closed", 2, "CONFLICT"),
        rejected("gps", 3, "GPS_ACCURACY_TOO_LOW"),
        // A code with a shared message but no past-tense one: the shared Arabic message.
        rejected("emergency", 4, "EMERGENCY_NOT_ELIGIBLE"),
        // A code the app has no message for at all.
        rejected("new", 5, "OFFLINE_EVENT_PROCESSING_FAILED"),
        queued({ clientEventId: "ok", queuedAt: "2026-01-15T08:06:00.000Z", localStatus: "VERIFIED" }),
      ],
    };
    await renderScreen();

    expect(screen.getByText(ar.offlineQueue.reasons.GEOFENCE_OUTSIDE_ALLOWED_RADIUS)).toBeOnTheScreen();
    expect(screen.getByText("كنت خارج نطاق الموقع عند حفظ هذا التسجيل.")).toBeOnTheScreen();
    expect(screen.getByText("كان لديك دوام جارٍ عند حفظ هذا التسجيل.")).toBeOnTheScreen();
    expect(screen.getByText("لم تعد هذه الوردية مفتوحة عند إرسال التسجيل.")).toBeOnTheScreen();
    expect(screen.getByText("كانت دقة تحديد موقعك ضعيفة عند حفظ هذا التسجيل.")).toBeOnTheScreen();
    expect(screen.getByText(ar.errors.EMERGENCY_NOT_ELIGIBLE)).toBeOnTheScreen();
    expect(screen.getByText("تعذّرت معالجة هذا التسجيل.")).toBeOnTheScreen();
    expect(screen.getAllByText(ar.offlineQueue.unknownReason)).toHaveLength(1);

    // Not the present-tense advice written for an action done now ("refresh the page", "move to an open area", ...).
    for (const text of [
      ar.errors.GEOFENCE_OUTSIDE_ALLOWED_RADIUS_NO_DETAILS,
      ar.errors.ACTIVE_TIME_ENTRY_EXISTS,
      ar.errors.CONFLICT,
      ar.errors.GPS_ACCURACY_TOO_LOW_NO_DETAILS,
    ]) {
      expect(screen.queryByText(text)).not.toBeOnTheScreen();
    }
    expect(screen.queryByText(/حاول مرة أخرى|حدّث الصفحة|الخادم/)).not.toBeOnTheScreen();

    // Every rejected record (and only those) says what to do next.
    expect(screen.getAllByText(ar.offlineQueue.rejectedHint)).toHaveLength(6);
    expect(screen.getAllByText("لم يُسجَّل هذا الحضور. تواصل مع المدير لتصحيحه.")).toHaveLength(6);

    expect(screen.queryByText(/GEOFENCE|ACTIVE_TIME|CONFLICT|GPS_|EMERGENCY|OFFLINE_EVENT/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/\{|\}/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("has a past-tense explanation for every code the server rejects an offline record with", async () => {
    // Codes from the API's offline-sync and clock-in/clock-out rules (offline-sync.service.ts, clock-events.service.ts).
    const codes = [
      "DEVICE_KEY_NOT_REGISTERED",
      "INVALID_OFFLINE_SIGNATURE",
      "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
      "GPS_ACCURACY_TOO_LOW",
      "MOCK_LOCATION_BLOCKED",
      "DEVICE_TIME_DEVIATION_EXCEEDED",
      "ACTIVE_TIME_ENTRY_EXISTS",
      "NO_ACTIVE_TIME_ENTRY",
      "SUMMARY_REQUIRED",
      "VALIDATION_FAILED",
      "CONFLICT",
      "NOT_FOUND",
      "FORBIDDEN",
    ] as const;
    expect(Object.keys(ar.offlineQueue.reasons).sort()).toEqual([...codes].sort());

    // The list renders its first rows only, so the codes are shown a few at a time.
    for (const chunk of [codes.slice(0, 7), codes.slice(7)]) {
      syncState = {
        isOnline: true,
        queue: chunk.map((reason, i) => queued({ clientEventId: reason, queuedAt: `2026-01-15T08:0${i}:00.000Z`, localStatus: "REJECTED", reason })),
      };
      const { unmount } = await renderScreen();

      for (const code of chunk) expect(screen.getByText(ar.offlineQueue.reasons[code])).toBeOnTheScreen();
      expect(screen.getAllByText(ar.offlineQueue.rejectedHint)).toHaveLength(chunk.length);
      expect(screen.queryByText(ar.offlineQueue.unknownReason)).not.toBeOnTheScreen();
      expectArabicOnly();
      await unmount();
    }
  });

  it("syncs now when asked, showing the busy label until it finishes", async () => {
    const sync = deferred<void>();
    syncNow.mockReturnValue(sync.promise);
    syncState = { isOnline: true, queue: [queued({ clientEventId: "a", queuedAt: "2026-01-15T08:30:00.000Z" })] };
    await renderScreen();

    // fireEvent.press resolves when the handler's promise does, so it is awaited at the end.
    const pressing = fireEvent.press(syncButton());
    const busy = await screen.findByRole("button", { name: ar.offlineQueue.syncing });
    expect(busy).toBeDisabled();
    expect(busy).toBeBusy();
    expect(syncNow).toHaveBeenCalledTimes(1);
    expectArabicOnly();

    await act(async () => sync.resolve());
    await pressing;
    expect(syncButton()).toBeEnabled();
    expect(screen.queryByText(ar.errors.unknown)).not.toBeOnTheScreen();
  });

  it("shows an Arabic error with a retry when syncing fails unexpectedly", async () => {
    syncNow.mockRejectedValueOnce(new Error("SecureStore is unavailable"));
    await renderScreen();

    await fireEvent.press(syncButton());

    expect(await screen.findByText(ar.errors.unknown)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(syncNow).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(ar.errors.unknown)).not.toBeOnTheScreen();
  });

  it("goes back with the mirrored back button", async () => {
    await renderScreen();

    const back = screen.getByRole("button", { name: ar.common.back });
    expect(within(back).getByTestId("chevron-icon")).toHaveStyle({ transform: [{ scaleX: -1 }] });
    await fireEvent.press(back);

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
