import { act, render, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { ApiRequestError } from "@fieldmaster/api-client";
import { bytesToBase64 } from "@fieldmaster/shared-validation";
import { AuthProvider, useAuth } from "../auth-context";
import { getOrCreateDeviceKeyPair } from "../device-key";
import { enqueueEvent, getQueueStatus } from "../offline-queue";
import { SECURE_KEYS } from "../secure-storage";
import type { StoredSession } from "../session-store";

// ── Helpers ─────────────────────────────────────────────────────────────────

function base64url(value: object): string {
  const json = JSON.stringify(value);
  const bytes = new Uint8Array([...unescape(encodeURIComponent(json))].map((c) => c.charCodeAt(0)));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An access token like the API's (only the payload matters to the app). */
const jwt = (workerProfileId: string | null, suffix = "") => `${base64url({ alg: "HS256" })}.${base64url({ sub: "user-1", organizationId: "org-1", role: "WORKER", workerProfileId })}.sig${suffix}`;

const STORED: StoredSession = { accessToken: jwt("worker-1", "-old"), refreshToken: "family:old", organizationId: "org-1", role: "WORKER", workerProfileId: "worker-1" };

type Route = (init: RequestInit & { headers: Record<string, string> }) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

let routes: Record<string, Route[]>;
let calls: { key: string; authorization: string | undefined; body: unknown }[];

/** Answers by "METHOD /path" (in order when a route has several answers; the last one repeats). */
function answer(key: string, ...responses: Route[]) {
  routes[key] = responses;
}

beforeEach(() => {
  routes = {};
  calls = [];
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const key = `${method} ${url.pathname.replace(/^\/api\/v1/, "")}`;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ key, authorization: headers.Authorization, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const queue = routes[key];
    if (!queue) throw new TypeError("Network request failed");
    const route = queue.length > 1 ? (queue.shift() as Route) : queue[0];
    const result = await route({ ...(init ?? {}), headers });
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body ?? {} } as Response;
  }) as typeof fetch;
});

const apiError = (status: number, code: string) => ({ status, body: { statusCode: status, code, message: "English", correlationId: "c" } });

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}

async function renderAuth(stored: StoredSession | null = STORED) {
  if (stored) await SecureStore.setItemAsync(SECURE_KEYS.session, JSON.stringify(stored));
  await render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(auth.isLoading).toBe(false));
}

const storedSession = async () => JSON.parse((await SecureStore.getItemAsync(SECURE_KEYS.session)) ?? "null") as StoredSession | null;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("AuthProvider: session", () => {
  it("restores the stored session at start", async () => {
    await renderAuth();
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.session).toEqual(STORED);
    expect(auth.accountState).toBeNull();
  });

  it("starts signed out when the Keychain / Keystore cannot be read (and deletes nothing)", async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error("User interaction is not allowed."));
    await renderAuth();
    expect(auth.isAuthenticated).toBe(false);
    expect(await storedSession()).toEqual(STORED);
  });

  it("signs in: keeps the worker profile from the token in secure storage", async () => {
    await renderAuth(null);
    await act(async () => auth.login({ accessToken: jwt("worker-9"), refreshToken: "family:new", organizationId: "org-1", role: "WORKER" }));
    expect(auth.session?.workerProfileId).toBe("worker-9");
    expect((await storedSession())?.refreshToken).toBe("family:new");
  });

  it("signs out on the server too, and forgets the session", async () => {
    answer("POST /auth/logout", () => ({ status: 204 }));
    await renderAuth();
    await act(async () => auth.logout());
    expect(auth.isAuthenticated).toBe(false);
    expect(await storedSession()).toBeNull();
    expect(calls).toContainEqual(expect.objectContaining({ key: "POST /auth/logout", body: { refreshToken: "family:old" } }));
  });
});

describe("AuthProvider: an expired access token", () => {
  it("is refreshed once and the call made again with the new token", async () => {
    answer("GET /shifts", () => apiError(401, "UNAUTHENTICATED"), () => ({ status: 200, body: [{ id: "shift-1" }] }));
    answer("POST /auth/refresh", () => ({ status: 200, body: { accessToken: jwt("worker-1", "-new"), refreshToken: "family:rotated", expiresIn: 900 } }));
    await renderAuth();

    let result: unknown;
    await act(async () => {
      result = await auth.client.listShifts();
    });
    expect(result).toEqual([{ id: "shift-1" }]);
    expect(calls.map((c) => c.key)).toEqual(["GET /shifts", "POST /auth/refresh", "GET /shifts"]);
    expect(calls[1].body).toEqual({ refreshToken: "family:old" });
    expect(calls[2].authorization).toBe(`Bearer ${jwt("worker-1", "-new")}`);
    expect(auth.session?.refreshToken).toBe("family:rotated");
    expect((await storedSession())?.accessToken).toBe(jwt("worker-1", "-new"));
  });

  it("is refreshed only once for calls that failed together", async () => {
    answer("GET /shifts", ({ headers }) => (headers.Authorization?.endsWith("-new") ? { status: 200, body: [] } : apiError(401, "UNAUTHENTICATED")));
    answer("GET /notifications", ({ headers }) => (headers.Authorization?.endsWith("-new") ? { status: 200, body: [] } : apiError(401, "UNAUTHENTICATED")));
    answer("POST /auth/refresh", () => ({ status: 200, body: { accessToken: jwt("worker-1", "-new"), refreshToken: "family:rotated" } }));
    await renderAuth();

    await act(async () => {
      await Promise.all([auth.client.listShifts(), auth.client.listNotifications()]);
    });
    expect(calls.filter((c) => c.key === "POST /auth/refresh")).toHaveLength(1);
  });

  it("shows the suspended-account screen when the refresh answers NO_ACTIVE_MEMBERSHIP", async () => {
    answer("GET /shifts", () => apiError(401, "UNAUTHENTICATED"));
    answer("POST /auth/refresh", () => apiError(401, "NO_ACTIVE_MEMBERSHIP"));
    await renderAuth();

    await act(async () => {
      await expect(auth.client.listShifts()).rejects.toBeInstanceOf(ApiRequestError);
    });
    expect(auth.accountState).toEqual({ kind: "SUSPENDED" });
    expect(auth.isAuthenticated).toBe(false);
    expect(await storedSession()).toBeNull();
  });

  it("goes back to the sign-in screen when the session itself ended (revoked or expired refresh token)", async () => {
    answer("GET /shifts", () => apiError(401, "UNAUTHENTICATED"));
    answer("POST /auth/refresh", () => apiError(401, "REFRESH_TOKEN_REVOKED"));
    await renderAuth();

    await act(async () => {
      await expect(auth.client.listShifts()).rejects.toBeInstanceOf(ApiRequestError);
    });
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.accountState).toBeNull();
  });

  it("keeps the session when the refresh cannot reach the server (offline)", async () => {
    answer("GET /shifts", () => apiError(401, "UNAUTHENTICATED"));
    await renderAuth();

    await act(async () => {
      await expect(auth.client.listShifts()).rejects.toMatchObject({ status: 401 });
    });
    expect(auth.isAuthenticated).toBe(true);
    expect(await storedSession()).toEqual(STORED);
  });

  it("never refreshes for the sign-in calls (a wrong code is a 401 too)", async () => {
    answer("POST /auth/otp/verify", () => apiError(401, "OTP_INVALID_OR_EXPIRED"));
    await renderAuth(null);
    await act(async () => {
      await expect(auth.client.verifyOtp({ phoneNumber: "+972500000000", code: "000000", deviceId: "d", platform: "IOS" })).rejects.toMatchObject({ status: 401 });
    });
    expect(calls.map((c) => c.key)).toEqual(["POST /auth/otp/verify"]);
  });
});

describe("AuthProvider: account states", () => {
  it("shows the suspended-account screen when any call answers ACCOUNT_SUSPENDED", async () => {
    answer("GET /notifications", () => apiError(403, "ACCOUNT_SUSPENDED"));
    await renderAuth();
    await act(async () => {
      await expect(auth.client.listNotifications()).rejects.toBeInstanceOf(ApiRequestError);
    });
    expect(auth.accountState).toEqual({ kind: "SUSPENDED" });
    expect(auth.isAuthenticated).toBe(false);
    expect(await storedSession()).toBeNull();
  });

  it("shows a state from the sign-in screen, and leaves it for the sign-in screen", async () => {
    await renderAuth(null);
    await act(async () => auth.showAccountState("PENDING_APPROVAL"));
    expect(auth.accountState).toEqual({ kind: "PENDING_APPROVAL" });
    await act(async () => auth.dismissAccountState());
    expect(auth.accountState).toBeNull();
  });
});

describe("AuthProvider: device key revoked", () => {
  it("clears the queue, the signing key and the session, ends the session on the server and asks for a fresh sign-in", async () => {
    answer("POST /auth/logout", () => ({ status: 204 }));
    await renderAuth();
    await getOrCreateDeviceKeyPair();
    await SecureStore.setItemAsync(SECURE_KEYS.signingKeyRegisteredFor, "device-1");
    for (const id of ["evt-1", "evt-2"]) {
      await enqueueEvent({ clientEventId: id, eventType: "CLOCK_IN", deviceTimestamp: "2026-01-15T08:30:00.000Z", latitude: 32.08, longitude: 34.78, accuracyMeters: 8 });
    }

    await act(async () => auth.reportDeviceKeyRevoked());

    expect(auth.accountState).toEqual({ kind: "DEVICE_KEY_REVOKED", droppedEvents: 2 });
    expect(auth.isAuthenticated).toBe(false);
    expect(await storedSession()).toBeNull();
    expect(await SecureStore.getItemAsync(SECURE_KEYS.signingKey)).toBeNull();
    expect(await SecureStore.getItemAsync(SECURE_KEYS.signingKeyRegisteredFor)).toBeNull();
    const status = await getQueueStatus();
    expect(status.events).toEqual([]);
    expect(status.notice).toMatchObject({ kind: "DEVICE_KEY_REVOKED", count: 2 });
    expect(calls).toContainEqual(expect.objectContaining({ key: "POST /auth/logout", body: { refreshToken: "family:old" } }));

    // The fresh sign-in leaves the screen.
    await act(async () => auth.login({ accessToken: jwt("worker-1", "-fresh"), refreshToken: "family:fresh", organizationId: "org-1", role: "WORKER" }));
    expect(auth.accountState).toBeNull();
    expect(auth.isAuthenticated).toBe(true);
  });
});
