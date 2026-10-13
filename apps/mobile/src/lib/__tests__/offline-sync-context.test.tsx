import { act, render } from "@testing-library/react-native";
import NetInfo from "@react-native-community/netinfo";
import * as SecureStore from "expo-secure-store";
import { ApiRequestError } from "@fieldmaster/api-client";
import { enqueueEvent, getQueue } from "../offline-queue";
import { OfflineSyncProvider, useOfflineSync } from "../offline-sync-context";
import { SECURE_KEYS } from "../secure-storage";

const mockClient = { registerDevicePublicKey: jest.fn(), submitOfflineSyncBatch: jest.fn() };
const mockAuth = { client: mockClient, isAuthenticated: true, reportDeviceKeyRevoked: jest.fn(async () => undefined) };
jest.mock("../auth-context", () => ({ useAuth: () => mockAuth }));

const DEVICE_ID = "mobile-sync-test";

let sync: ReturnType<typeof useOfflineSync>;
function Probe() {
  sync = useOfflineSync();
  return null;
}

async function renderSync() {
  await render(
    <OfflineSyncProvider>
      <Probe />
    </OfflineSyncProvider>,
  );
  await act(async () => undefined);
}

const event = (clientEventId: string) => ({
  clientEventId,
  eventType: "CLOCK_IN",
  deviceTimestamp: "2026-01-15T08:30:00.000Z",
  latitude: 32.0853,
  longitude: 34.7818,
  accuracyMeters: 8,
});

beforeEach(async () => {
  await SecureStore.setItemAsync(SECURE_KEYS.deviceId, DEVICE_ID);
  mockAuth.isAuthenticated = true;
  mockClient.registerDevicePublicKey.mockResolvedValue({});
  mockClient.submitOfflineSyncBatch.mockImplementation(async (input: { events: { clientEventId: string }[] }) => ({
    batchId: "b1",
    results: input.events.map((e) => ({ clientEventId: e.clientEventId, status: "VERIFIED" })),
  }));
});

describe("OfflineSyncProvider", () => {
  it("registers the key and sends what is waiting when signed in", async () => {
    await enqueueEvent(event("evt-1"));
    await renderSync();

    expect(mockClient.registerDevicePublicKey).toHaveBeenCalledWith(expect.objectContaining({ deviceId: DEVICE_ID }));
    expect(mockClient.submitOfflineSyncBatch).toHaveBeenCalledTimes(1);
    expect(sync.pendingCount).toBe(0);
    expect(sync.queue[0].localStatus).toBe("VERIFIED");
    expect(sync.storageAvailable).toBe(true);
    expect(sync.notice).toBeNull();
  });

  it("keeps events waiting (instead of having them refused for good) while the key is not registered", async () => {
    mockClient.registerDevicePublicKey.mockRejectedValue(new ApiRequestError(500, { statusCode: 500, code: "INTERNAL_ERROR", message: "x", correlationId: "c" }));
    await enqueueEvent(event("evt-1"));
    await renderSync();

    expect(mockClient.submitOfflineSyncBatch).not.toHaveBeenCalled();
    expect(sync.pendingCount).toBe(1);
  });

  it("hands over to the auth provider when the server says the key was revoked (sync answer)", async () => {
    mockClient.submitOfflineSyncBatch.mockResolvedValue({ batchId: "b1", results: [{ clientEventId: "evt-1", status: "REJECTED", reason: "DEVICE_KEY_REVOKED" }] });
    await enqueueEvent(event("evt-1"));
    await renderSync();
    expect(mockAuth.reportDeviceKeyRevoked).toHaveBeenCalledTimes(1);
  });

  it("hands over to the auth provider when registering a key is refused as revoked", async () => {
    mockClient.registerDevicePublicKey.mockRejectedValue(new ApiRequestError(403, { statusCode: 403, code: "DEVICE_KEY_REVOKED", message: "x", correlationId: "c" }));
    await enqueueEvent(event("evt-1"));
    await renderSync();
    expect(mockAuth.reportDeviceKeyRevoked).toHaveBeenCalledTimes(1);
    expect(mockClient.submitOfflineSyncBatch).not.toHaveBeenCalled();
  });

  it("queues an event and sends it at once when online", async () => {
    await renderSync();
    await act(async () => sync.queueOfflineEvent(event("evt-2")));
    await act(async () => undefined);
    expect((await getQueue())[0]).toMatchObject({ clientEventId: "evt-2", localStatus: "VERIFIED" });
  });

  it("says when the secure storage cannot be read, keeps the records, and reads them again later", async () => {
    await enqueueEvent(event("evt-1"));
    mockAuth.isAuthenticated = false;
    // The queue key cannot be read once (e.g. the phone was locked).
    const read = jest.mocked(SecureStore.getItemAsync).getMockImplementation() as (key: string) => Promise<string | null>;
    let failed = false;
    const spy = jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key: string) => {
      if (key === SECURE_KEYS.offlineQueueKey && !failed) {
        failed = true;
        throw new Error("locked");
      }
      return read(key);
    });
    const view = await render(
      <OfflineSyncProvider>
        <Probe />
      </OfflineSyncProvider>,
    );
    await act(async () => undefined);
    expect(sync.storageAvailable).toBe(false);
    spy.mockImplementation(read);

    const listener = jest.mocked(NetInfo.addEventListener).mock.calls[0][0] as (state: object) => void;
    await act(async () => listener({ isConnected: false, isInternetReachable: false }));
    expect(sync.isOnline).toBe(false);

    // Signing in reads the queue again: the record is still there, and it is sent.
    mockAuth.isAuthenticated = true;
    await view.rerender(
      <OfflineSyncProvider>
        <Probe />
      </OfflineSyncProvider>,
    );
    await act(async () => undefined);
    expect(sync.storageAvailable).toBe(true);
    expect(mockClient.submitOfflineSyncBatch).toHaveBeenCalledWith(expect.objectContaining({ events: [expect.objectContaining({ clientEventId: "evt-1" })] }), expect.any(String));
  });
});
