import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";

/**
 * Turns API / network failures into Arabic, user-safe messages.
 *
 * The API returns a stable `code`, an English `message` and optional
 * `details`. The UI maps `code` to `errors.<CODE>` in ar.json and fills in the
 * details where the message needs them (for example the distance and allowed
 * radius of GEOFENCE_OUTSIDE_ALLOWED_RADIUS). The app is Arabic only, so the
 * API's English `message` is never shown: a code the frontend does not know
 * gets the Arabic message for its HTTP status instead. `pnpm lint` fails when
 * the API has an error code without an `errors.<CODE>` translation, so that
 * fallback is only a safety net.
 *
 *   const errorMessage = useErrorMessage();
 *   <ErrorState message={errorMessage(error)} />
 */

/** The slice of a next-intl translator this module needs (namespace "errors"). */
export interface ErrorTranslator {
  (key: string, values?: Record<string, string>): string;
  has(key: string): boolean;
}

/**
 * Codes whose message interpolates API `details`. When a detail is missing the
 * `<CODE>_NO_DETAILS` message is used instead. Numbers are passed as
 * pre-rounded strings so they always render in Western digits.
 */
export const DETAIL_PARAMS: Record<string, readonly string[]> = {
  GEOFENCE_OUTSIDE_ALLOWED_RADIUS: ["distanceMeters", "allowedRadiusMeters"],
  GPS_ACCURACY_TOO_LOW: ["accuracyMeters", "requiredMeters"],
  DEVICE_TIME_DEVIATION_EXCEEDED: ["deviationSeconds"],
};

/** Duck-typed so it still works if two copies of the api-client module are loaded. */
function asApiRequestError(error: unknown): ApiRequestError | null {
  if (error instanceof ApiRequestError) return error;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { status?: unknown; body?: unknown };
    if (typeof candidate.status === "number" && typeof candidate.body === "object" && candidate.body !== null) {
      return error as ApiRequestError;
    }
  }
  return null;
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof NetworkError || (error instanceof TypeError && /fetch/i.test(error.message));
}

/** The server's stable error code (e.g. `"OTP_INVALID_OR_EXPIRED"`), if the error came from the API. */
export function getErrorCode(error: unknown): string | null {
  const code = asApiRequestError(error)?.body?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** HTTP 403: the caller is authenticated but not allowed. */
export function isForbidden(error: unknown): boolean {
  return asApiRequestError(error)?.status === 403;
}

/** HTTP 404: the record does not exist (or is not visible to this caller). */
export function isNotFound(error: unknown): boolean {
  return asApiRequestError(error)?.status === 404;
}

function detailValues(code: string, details: unknown): Record<string, string> | null {
  const params = DETAIL_PARAMS[code];
  if (!params) return {};
  if (typeof details !== "object" || details === null) return null;
  const values: Record<string, string> = {};
  for (const param of params) {
    const raw = (details as Record<string, unknown>)[param];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    values[param] = String(Math.round(raw));
  }
  return values;
}

/** The code the API's exception filter uses for errors that have no domain code. */
const GENERIC_API_CODE = "ERROR";

/** Status-level message for codes without their own translation. */
function keyForStatus(status: number): string | null {
  if (status === 400) return "VALIDATION_FAILED";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "rateLimited";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  if (status >= 500) return "INTERNAL_ERROR";
  return null;
}

/**
 * Arabic message for any thrown value.
 *
 *  - `NetworkError` -> `errors.network`
 *  - the generic code `ERROR` -> the status-level message (e.g. 429 -> `errors.rateLimited`)
 *  - known `body.code` -> `errors.<code>` (with `details` filled in when the
 *    message needs them, or `errors.<code>_NO_DETAILS` when they are missing)
 *  - unknown or missing code -> the status-level message, else `errors.unknown`
 *    (never the API's English `message`)
 */
export function getErrorMessage(t: ErrorTranslator, error: unknown): string {
  if (isNetworkError(error)) return t("network");

  const apiError = asApiRequestError(error);
  if (!apiError) return t("unknown");

  const code = getErrorCode(apiError);
  // "ERROR" is the API's catch-all for framework errors (e.g. 429 from rate
  // limiting, 503); the HTTP status gives the user a more useful message.
  if (code === GENERIC_API_CODE) {
    const statusKey = keyForStatus(apiError.status);
    if (statusKey && t.has(statusKey)) return t(statusKey);
  }
  if (code && t.has(code)) {
    const values = detailValues(code, apiError.body.details);
    if (values) return t(code, values);
    const fallbackKey = `${code}_NO_DETAILS`;
    if (t.has(fallbackKey)) return t(fallbackKey);
  }

  const statusKey = keyForStatus(apiError.status);
  if (statusKey && t.has(statusKey)) return t(statusKey);
  return t("unknown");
}
