import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import type { OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import { getErrorCode } from "@fieldmaster/i18n";
import { useAuth } from "./auth-context";
import { getDeviceId } from "./device-id";
import { ensureDeviceKeyRegistered, isDeviceKeyRegistered } from "./device-key";
import { dismissQueueNotice, enqueueEvent, flushQueue, getQueueStatus, type QueueNotice, type QueuedEvent } from "./offline-queue";

interface OfflineSyncContextValue {
  isOnline: boolean;
  pendingCount: number;
  queue: QueuedEvent[];
  /** Signs and locally queues a clock event for later sync (network already known to be unavailable). */
  queueOfflineEvent: (payload: OfflineEventSignablePayload) => Promise<void>;
  /** Registers the device key if needed and flushes any pending queued events. Safe to call anytime. */
  syncNow: () => Promise<void>;
  /** False while the phone's secure storage cannot be read (the saved records are kept; it is tried again). */
  storageAvailable: boolean;
  /** Something the worker must be told about the saved records (unreadable, key lost, device key revoked), until dismissed. */
  notice: QueueNotice | null;
  dismissNotice: () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncContextValue | null>(null);

/**
 * Drives spec section 20's mobile half: watches connectivity via NetInfo
 * and automatically flushes the local offline queue (offline-queue.ts)
 * whenever the device comes back online, on an interval as a fallback, and
 * whenever the app returns to the foreground -- so a worker who clocked in
 * offline and simply carries on with their day gets synced without having
 * to remember to do anything.
 *
 * A sync that finds this device's key revoked (an Owner revoked it) hands
 * over to the auth provider, which clears the queue, the key and the session
 * and asks the worker to sign in again.
 */
export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const { client, isAuthenticated, reportDeviceKeyRevoked } = useAuth();
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [notice, setNotice] = useState<QueueNotice | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const status = await getQueueStatus();
      setQueue(status.events);
      setPendingCount(status.events.filter((e) => e.localStatus === "PENDING").length);
      setNotice(status.notice);
      setStorageAvailable(true);
    } catch {
      // The Keychain / Keystore (or storage) is not readable right now: keep what is shown, try again on the next trigger.
      setStorageAvailable(false);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!isAuthenticated || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const deviceId = deviceIdRef.current ?? (deviceIdRef.current = await getDeviceId());
      try {
        await ensureDeviceKeyRegistered(client, deviceId);
      } catch (error) {
        if (getErrorCode(error) === "DEVICE_KEY_REVOKED") {
          await reportDeviceKeyRevoked();
          return;
        }
        // Offline or a server error: tried again on the next sync.
      }
      // Events sent before the key is registered would be refused for good: they wait until it is.
      if (!(await isDeviceKeyRegistered(deviceId))) return;
      const result = await flushQueue(client, deviceId);
      if (result.keyRevoked) await reportDeviceKeyRevoked();
    } finally {
      syncingRef.current = false;
      await refresh();
    }
  }, [client, isAuthenticated, refresh, reportDeviceKeyRevoked]);

  /** For automatic triggers: a failure is already reflected in the state, and the next trigger tries again. */
  const syncQuietly = useCallback(() => {
    syncNow().catch(() => undefined);
  }, [syncNow]);

  useEffect(() => {
    getDeviceId()
      .then((id) => {
        deviceIdRef.current = id;
      })
      .catch(() => undefined);
  }, []);

  // Signing in or out (including a revoked key clearing the queue) changes what is saved: read it again.
  useEffect(() => {
    void refresh();
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    if (isAuthenticated) syncQuietly();
  }, [isAuthenticated, syncQuietly]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      if (online) syncQuietly();
    });
    return unsubscribe;
  }, [syncQuietly]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") syncQuietly();
    });
    return () => subscription.remove();
  }, [syncQuietly]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(syncQuietly, 60_000);
    return () => clearInterval(interval);
  }, [isAuthenticated, syncQuietly]);

  const queueOfflineEvent = useCallback(
    async (payload: OfflineEventSignablePayload) => {
      await enqueueEvent(payload);
      await refresh();
      syncQuietly();
    },
    [refresh, syncQuietly],
  );

  const dismissNotice = useCallback(async () => {
    await dismissQueueNotice().catch(() => undefined);
    setNotice(null);
  }, []);

  const value: OfflineSyncContextValue = { isOnline, pendingCount, queue, queueOfflineEvent, syncNow, storageAvailable, notice, dismissNotice };
  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

export function useOfflineSync(): OfflineSyncContextValue {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) throw new Error("useOfflineSync must be used within OfflineSyncProvider");
  return ctx;
}
