import { useCallback } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

export interface FocusedRefreshOptions {
  /** Reload this often while the screen stays focused (never while the app is in the background). */
  intervalMs?: number;
  /** What the interval reloads; `onFocus` when omitted (a screen can poll only its light part). */
  onInterval?: () => void;
}

/**
 * Keeps a manager screen fresh while it is on screen (mobile manager mode):
 * `onFocus` runs when the screen gains focus and when the app comes back to
 * the foreground while it is focused; `onInterval` every `intervalMs` while it
 * stays focused. Leaving the screen stops both. Pass stable callbacks
 * (useCallback): a new one restarts the timer and loads again.
 */
export function useFocusedRefresh(onFocus: () => void, { intervalMs, onInterval }: FocusedRefreshOptions = {}): void {
  useFocusEffect(
    useCallback(() => {
      onFocus();
      const tick = onInterval ?? onFocus;
      const timer = intervalMs
        ? setInterval(() => {
            if (AppState.currentState !== "background") tick();
          }, intervalMs)
        : null;
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") onFocus();
      });
      return () => {
        if (timer) clearInterval(timer);
        subscription.remove();
      };
    }, [onFocus, onInterval, intervalMs]),
  );
}
