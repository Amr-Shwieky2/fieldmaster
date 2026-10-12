"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { sessionStore } from "@/lib/session-store";

export type StreamState = "connecting" | "connected" | "disconnected";

/** The API sends a `ping` every 25 s; without any event for this long the connection counts as lost. */
const SILENCE_LIMIT_MS = 60_000;
const MAX_RETRY_DELAY_MS = 30_000;

/**
 * The live operations page's real-time channel (Step 6): the existing
 * notifications SSE stream, on which Owners and Field Managers also get
 * named `operations` events. `onChange` runs for each one (and once after a
 * reconnection, to catch up on what was missed), so the page refetches its
 * snapshot instead of polling. Reconnects with a growing delay; the state
 * drives the "متصل / غير متصل" indicator.
 */
export function useOperationsStream(onChange: () => void): StreamState {
  const { client } = useAuth();
  const [state, setState] = useState<StreamState>("connecting");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setState("disconnected");
      return;
    }
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let everConnected = false;
    let stopped = false;

    const reconnect = () => {
      source?.close();
      source = null;
      clearTimeout(silenceTimer);
      if (stopped) return;
      setState("disconnected");
      failures += 1;
      retryTimer = setTimeout(connect, Math.min(MAX_RETRY_DELAY_MS, 2_000 * failures));
    };

    const alive = () => {
      failures = 0;
      setState("connected");
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(reconnect, SILENCE_LIMIT_MS);
    };

    function connect() {
      const token = sessionStore.load()?.accessToken;
      if (!token || stopped) {
        setState("disconnected");
        return;
      }
      setState("connecting");
      source = new EventSource(client.notificationsStreamUrl(token));
      source.onopen = () => {
        alive();
        // Events may have been missed while disconnected: refetch once.
        if (everConnected) onChangeRef.current();
        everConnected = true;
      };
      source.addEventListener("ping", alive);
      source.addEventListener("operations", () => {
        alive();
        onChangeRef.current();
      });
      source.onerror = reconnect;
    }

    connect();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(retryTimer);
      clearTimeout(silenceTimer);
    };
  }, [client]);

  return state;
}
