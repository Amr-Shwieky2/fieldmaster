import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { NotificationItem } from "@fieldmaster/api-client";
import { useAuth } from "./auth-context";
import { addPushReceivedListener } from "./push";

/** How often the unread count is refreshed while the app is in the foreground. */
export const UNREAD_REFRESH_INTERVAL_MS = 60_000;

export interface NotificationsContextValue {
  /** The signed-in member's unread in-app notifications (0 when signed out or not loaded yet). */
  unreadCount: number;
  /** Reloads the unread count from the API. Never throws: a failure keeps the last known count. */
  refresh(): Promise<void>;
  /** A screen that already loaded the list (or marked items read) reports it, so the count updates without another request. */
  report(items: Pick<NotificationItem, "readAt">[]): void;
}

const signedOut: NotificationsContextValue = {
  unreadCount: 0,
  refresh: async () => undefined,
  report: () => undefined,
};

// Outside the provider (a screen rendered on its own) the count is simply 0.
const NotificationsContext = createContext<NotificationsContextValue>(signedOut);

const countUnread = (items: Pick<NotificationItem, "readAt">[]) => items.filter((item) => item.readAt === null).length;

/**
 * Keeps the unread notification count fresh for the badge on Home:
 * on sign-in, when the app returns to the foreground, when a push
 * notification arrives while the app is open, on an interval while the app is
 * active, and whenever a screen calls `refresh()` (Home does on focus).
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { client, isAuthenticated } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [appActive, setAppActive] = useState(AppState.currentState !== "background");
  // A response that arrives after sign-out (or for an older session) must not overwrite the count.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    const current = generation.current;
    try {
      const items = await client.listNotifications();
      if (current === generation.current) setUnreadCount(countUnread(items));
    } catch {
      // Offline or a server error: keep the last known count; the next trigger tries again.
    }
  }, [client, isAuthenticated]);

  const report = useCallback((items: Pick<NotificationItem, "readAt">[]) => {
    setUnreadCount(countUnread(items));
  }, []);

  useEffect(() => {
    generation.current += 1;
    if (!isAuthenticated) {
      setUnreadCount(0);
      return;
    }
    void refresh();
  }, [isAuthenticated, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      const active = state === "active";
      setAppActive(active);
      if (active) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  useEffect(() => {
    if (!isAuthenticated || !appActive) return;
    const interval = setInterval(() => void refresh(), UNREAD_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [appActive, isAuthenticated, refresh]);

  useEffect(() => addPushReceivedListener(() => void refresh()), [refresh]);

  const value = useMemo<NotificationsContextValue>(() => ({ unreadCount, refresh, report }), [unreadCount, refresh, report]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/** `{ unreadCount, refresh }` for the notification badge; 0 outside the provider. */
export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext);
}
