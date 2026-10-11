"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { FieldMasterClient, type DevLoginUser } from "@fieldmaster/api-client";
import { API_URL } from "@/lib/api-url";
import { decodeJwtPayload } from "@/lib/jwt";

export interface SimulatorSession {
  membershipId: string;
  fullLegalName: string;
  phoneNumber: string;
  organizationId: string;
  workerProfileId: string | null;
  /** The simulated phone's device id (sent with dev login, clock events and the offline key). */
  deviceId: string;
  accessToken: string;
  refreshToken: string;
}

export function createSimulatorQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });
}

/**
 * The simulated worker's session, kept completely separate from the admin's
 * own session (the Step 1 cache-leak lesson):
 * - the worker's tokens live only in this hook's memory -- never in the admin
 *   session store or anywhere in browser storage;
 * - it has its own `FieldMasterClient`: a 401 on a worker request ends the
 *   simulator session only, never the admin's;
 * - it has its own `QueryClient`, so a worker response can never land in the
 *   admin's React Query cache (or an admin response in the worker's);
 * - ending it, switching worker or leaving the page revokes only the worker's
 *   refresh-token family; the admin stays signed in. Signing the admin out
 *   unmounts the page, which drops the worker session with it.
 * The worker session is obtained with `POST /auth/dev/login`, exactly like quick login.
 */
export function useSimulatorSession() {
  const sessionRef = useRef<SimulatorSession | null>(null);
  const [session, setSessionState] = useState<SimulatorSession | null>(null);
  const [expired, setExpired] = useState(false);
  const [queryClient] = useState(createSimulatorQueryClient);

  const setSession = useCallback((next: SimulatorSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const client = useMemo(
    () =>
      new FieldMasterClient({
        baseUrl: API_URL,
        getAccessToken: () => sessionRef.current?.accessToken ?? null,
        onUnauthorized: () => {
          if (!sessionRef.current) return;
          sessionRef.current = null;
          setSessionState(null);
          queryClient.clear();
          setExpired(true);
        },
      }),
    [queryClient],
  );

  const revoke = useCallback(
    (previous: SimulatorSession | null) => {
      if (previous) void client.logout(previous.refreshToken).catch(() => undefined);
    },
    [client],
  );

  const start = useCallback(
    async (user: DevLoginUser): Promise<SimulatorSession> => {
      const previous = sessionRef.current;
      setSession(null);
      queryClient.clear();
      setExpired(false);
      revoke(previous);

      const deviceId = `worker-simulator-${user.membershipId.slice(-8)}-${Math.random().toString(36).slice(2, 8)}`;
      const auth = await client.devLogin({ membershipId: user.membershipId, deviceId, platform: "WEB" });
      const claims = decodeJwtPayload<{ workerProfileId?: string | null }>(auth.accessToken);
      const next: SimulatorSession = {
        membershipId: user.membershipId,
        fullLegalName: user.fullLegalName,
        phoneNumber: user.phoneNumber,
        organizationId: auth.organizationId,
        workerProfileId: claims?.workerProfileId ?? null,
        deviceId,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      };
      setSession(next);
      return next;
    },
    [client, queryClient, revoke, setSession],
  );

  const end = useCallback(() => {
    const previous = sessionRef.current;
    setSession(null);
    queryClient.clear();
    setExpired(false);
    revoke(previous);
  }, [queryClient, revoke, setSession]);

  // Leaving the page (or the admin signing out, which unmounts it) ends the worker session too.
  useEffect(
    () => () => {
      const previous = sessionRef.current;
      sessionRef.current = null;
      queryClient.clear();
      revoke(previous);
    },
    [queryClient, revoke],
  );

  return { session, client, queryClient, start, end, expired };
}
