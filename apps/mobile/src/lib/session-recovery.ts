import { ApiRequestError, NetworkError, type ApiError, type FieldMasterClient } from "@fieldmaster/api-client";

/** `POST /auth/refresh`: a new access token and the rotated refresh token. */
export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Exchanges the refresh token for a new pair. The api-client has no method
 * for this route, so it is called here with the same error types the client
 * throws (NetworkError when the server was not reached, ApiRequestError with
 * the API's `code` otherwise).
 */
export async function requestTokenRefresh(baseUrl: string, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<RefreshedTokens> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (error) {
    throw new NetworkError(error);
  }
  const json = (await response.json().catch(() => ({}))) as Partial<RefreshedTokens> & Partial<ApiError>;
  if (!response.ok) throw new ApiRequestError(response.status, json as ApiError);
  if (typeof json.accessToken !== "string" || typeof json.refreshToken !== "string") {
    throw new ApiRequestError(response.status, { statusCode: response.status, code: "INVALID_REFRESH_TOKEN", message: "Malformed refresh response.", correlationId: "" });
  }
  return { accessToken: json.accessToken, refreshToken: json.refreshToken };
}

/** What to do with a failed call: try it once more (the session was refreshed), or let the error through. */
export type RecoveryDecision = "retry" | "throw";

/** Calls that run without a session (sign-in, the public onboarding page) or that end one: never recovered. */
const PASS_THROUGH = new Set([
  "requestOtp",
  "verifyOtp",
  "listDevLoginUsers",
  "devLogin",
  "logout",
  "getPublicInvitation",
  "uploadOnboardingFile",
  "submitJoinApplication",
  "notificationsStreamUrl",
]);

/**
 * Wraps the API client so a failed call can be recovered in one place: an
 * expired access token is refreshed and the call made once more, and a
 * suspended account ends the session (the auth provider decides, through
 * `onError`). `tokenAtCall` is read when the call starts, so the provider can
 * tell whether another call already refreshed the session meanwhile.
 */
export function withSessionRecovery(
  client: FieldMasterClient,
  onError: (error: unknown, tokenAtCall: string | null) => Promise<RecoveryDecision>,
  currentToken: () => string | null,
): FieldMasterClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || typeof property !== "string" || property === "constructor" || PASS_THROUGH.has(property)) return value;
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const tokenAtCall = currentToken();
        const result = method.apply(target, args);
        if (!(result instanceof Promise)) return result;
        return result.catch(async (error: unknown) => {
          if ((await onError(error, tokenAtCall)) === "retry") return method.apply(target, args);
          throw error;
        });
      };
    },
  });
}
