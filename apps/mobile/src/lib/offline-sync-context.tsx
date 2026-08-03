import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import type { OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import { useAuth } from "./auth-context";
import { getDeviceId } from "./device-id";
import { ensureDeviceKeyRegistered } from "./device-key";
import { enqueueEvent, flushQueue, getPendingCount, getQueue, type QueuedEvent } from "./offline-queue";

interface OfflineSyncContextValue {
  isOnline: boolean;
  pendingCount: number;
  queue: QueuedEvent[];
  /** Signs and locally queues a clock event for later sync (network already known to be unavailable). */
  queueOfflineEvent: (payload: OfflineEventSignablePayload) => Promise<void>;
  /** Registers the device key if needed and flushes any pending queued events. Safe to call anytime. */
  syncNow: () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncContextValue | null>(null);

/**
 * Drives spec section 20's mobile half: watches connectivity via NetInfo
 * and automatically flushes the local offline queue (offline-queue.ts)
 * whenever the device comes back online, on an interval as a fallback, and
 * whenever the app returns to the foreground -- so a worker who clocked in
 * offline and simply carries on with their day gets synced without having
 * to remember to do anything.
 */
export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const { client, isAuthenticated } = useAuth();
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const deviceIdRef = useRef<string | null>(null);
  const syncingRef = useRef(false);

  const refresh = useCallback(async () => {
    const [count, q] = await Promise.all([getPendingCount(), getQueue()]);
    setPendingCount(count);
    setQueue(q);
  }, []);

  const syncNow = useCallback(async () => {
    if (!isAuthenticated || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const deviceId = deviceIdRef.current ?? (deviceIdRef.current = await getDeviceId());
      try {
        await ensureDeviceKeyRegistered(client, deviceId);
      } catch {
        // Best-effort -- offline events still queue locally without a
        // registered key; they simply won't verify until registration
        // succeeds on a later sync attempt.
      }
      await flushQueue(client, deviceId);
      await refresh();
    } finally {
      syncingRef.current = false;
    }
  }, [client, isAuthenticated, refresh]);

  useEffect(() => {
    getDeviceId().then((id) => {
      deviceIdRef.current = id;
    });
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (isAuthenticated) syncNow();
  }, [isAuthenticated, syncNow]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      if (online) syncNow();
    });
    return unsubscribe;
  }, [syncNow]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") syncNow();
    });
    return () => subscription.remove();
  }, [syncNow]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => syncNow(), 60_000);
    return () => clearInterval(interval);
  }, [isAuthenticated, syncNow]);

  const queueOfflineEvent = useCallback(
    async (payload: OfflineEventSignablePayload) => {
      await enqueueEvent(payload);
      await refresh();
      syncNow();
    },
    [refresh, syncNow],
  );

  const value: OfflineSyncContextValue = { isOnline, pendingCount, queue, queueOfflineEvent, syncNow };
  return <OfflineSyncContext.Provider value={value}>{children}</OfflineSyncContext.Provider>;
}

export function useOfflineSync(): OfflineSyncContextValue {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx) throw new Error("useOfflineSync must be used within OfflineSyncProvider");
  return ctx;
}
