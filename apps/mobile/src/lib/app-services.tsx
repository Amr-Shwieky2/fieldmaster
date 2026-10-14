import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "./auth-context";
import { registerThisDevice } from "./device-registration";
import { openLinkTarget, parseNotificationData, targetForNotification } from "./linking";
import { useNotifications } from "./notifications-context";
import { useOfflineSync } from "./offline-sync-context";
import { addPushTapListener, configureNotificationHandling, takeLaunchPushData } from "./push";

type RegistrationStatus = "running" | "done" | "retry";

/**
 * App-wide device work with no screen of its own (rendered once, inside the
 * providers, by App.tsx):
 * - registers the device (PUT /devices/me) on sign-in and app start, and
 *   again when the phone is back online or returns to the foreground if the
 *   last attempt could not reach the API; a revoked key hands over to the
 *   auth provider (sign in again);
 * - opens the screen of a tapped push notification (also the one that
 *   started the app), marks it read and refreshes the unread count.
 */
export function AppServices() {
  const { client, isAuthenticated, reportDeviceKeyRevoked } = useAuth();
  const { isOnline } = useOfflineSync();
  const { refresh } = useNotifications();

  // Latest values for listeners registered once.
  const latest = useRef({ client, isAuthenticated, reportDeviceKeyRevoked, refresh });
  latest.current = { client, isAuthenticated, reportDeviceKeyRevoked, refresh };

  const generation = useRef(0);
  const registration = useRef<{ generation: number; status: RegistrationStatus } | null>(null);

  const register = useCallback(async () => {
    const current = generation.current;
    if (registration.current?.generation === current && registration.current.status === "running") return;
    registration.current = { generation: current, status: "running" };
    const outcome = await registerThisDevice(latest.current.client);
    if (generation.current !== current) return; // signed out (or in again) meanwhile
    registration.current = { generation: current, status: outcome === "RETRY" ? "retry" : "done" };
    if (outcome === "REVOKED") await latest.current.reportDeviceKeyRevoked();
  }, []);

  useEffect(() => {
    generation.current += 1;
    registration.current = null;
    if (isAuthenticated) void register();
  }, [isAuthenticated, register]);

  useEffect(() => {
    if (isAuthenticated && isOnline && registration.current?.status === "retry") void register();
  }, [isAuthenticated, isOnline, register]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && latest.current.isAuthenticated && registration.current?.status === "retry") void register();
    });
    return () => subscription.remove();
  }, [register]);

  useEffect(() => {
    configureNotificationHandling();

    const openTapped = (raw: Record<string, unknown>) => {
      const data = parseNotificationData(raw);
      const { client: api, isAuthenticated: signedIn, refresh: refreshUnread } = latest.current;
      if (data.notificationId && signedIn) {
        api
          .markNotificationRead(data.notificationId)
          .then(() => refreshUnread())
          .catch(() => undefined);
      }
      openLinkTarget(targetForNotification(data));
    };

    const removeTapListener = addPushTapListener(openTapped);
    let active = true;
    void takeLaunchPushData().then((data) => {
      if (active && data) openTapped(data);
    });
    return () => {
      active = false;
      removeTapListener();
    };
  }, []);

  return null;
}
