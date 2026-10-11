import { describe, expect, it } from "vitest";
import { createTranslator } from "use-intl";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import ar from "../messages/ar.json";
import { INTL_LOCALE } from "../config";
import { getCodeMessage, getErrorMessage, isForbidden, isNetworkError, type ErrorTranslator } from "../errors";

// createTranslator's fully typed key union is narrower than the plain-string
// ErrorTranslator the helper accepts; the runtime shape is the same.
const t = createTranslator({ locale: INTL_LOCALE, messages: ar, namespace: "errors" }) as unknown as ErrorTranslator;

const LATIN = /[A-Za-z]/;

function apiError(status: number, code: string, message = "Server message", details: Record<string, unknown> = {}) {
  return new ApiRequestError(status, { statusCode: status, code, message, details, correlationId: "c" });
}

describe("getErrorMessage", () => {
  it("shows the geofence distance and allowed radius in Arabic", () => {
    const error = apiError(400, "GEOFENCE_OUTSIDE_ALLOWED_RADIUS", "You are outside the permitted check-in area.", {
      distanceMeters: 412.6,
      allowedRadiusMeters: 150,
    });
    expect(getErrorMessage(t, error)).toBe("أنت خارج نطاق الموقع. المسافة: 413 م، المسموح: 150 م.");
  });

  it("falls back to the detail-free message when details are missing", () => {
    expect(getErrorMessage(t, apiError(400, "GEOFENCE_OUTSIDE_ALLOWED_RADIUS"))).toBe(ar.errors.GEOFENCE_OUTSIDE_ALLOWED_RADIUS_NO_DETAILS);
  });

  it("translates a known code without details", () => {
    expect(getErrorMessage(t, apiError(409, "PAYROLL_PERIOD_FINALIZED"))).toBe(ar.errors.PAYROLL_PERIOD_FINALIZED);
  });

  it("never shows the API's English message: an unknown code gets the Arabic message for its status", () => {
    expect(getErrorMessage(t, apiError(409, "SOMETHING_NEW", "Something new went wrong."))).toBe(ar.errors.CONFLICT);
    expect(getErrorMessage(t, apiError(400, "SOMETHING_NEW", "Bad input."))).toBe(ar.errors.VALIDATION_FAILED);
    expect(getErrorMessage(t, apiError(500, "SOMETHING_NEW", "Boom."))).toBe(ar.errors.INTERNAL_ERROR);
    expect(getErrorMessage(t, apiError(422, "SOMETHING_NEW", "Unprocessable."))).toBe(ar.errors.unknown);
    for (const status of [400, 409, 422, 500]) {
      expect(getErrorMessage(t, apiError(status, "SOMETHING_NEW", "English text"))).not.toMatch(LATIN);
    }
  });

  it("uses the status message when the API sends its generic ERROR code", () => {
    expect(getErrorMessage(t, apiError(429, "ERROR", "ThrottlerException: Too Many Requests"))).toBe(ar.errors.rateLimited);
    expect(getErrorMessage(t, apiError(503, "ERROR", "Service Unavailable"))).toBe(ar.errors.SERVICE_UNAVAILABLE);
    expect(getErrorMessage(t, apiError(409, "ERROR", "Conflict"))).toBe(ar.errors.CONFLICT);
    expect(getErrorMessage(t, apiError(418, "ERROR", "I'm a teapot"))).toBe(ar.errors.ERROR);
  });

  it("uses the network message when the server was never reached", () => {
    expect(getErrorMessage(t, new NetworkError(new TypeError("fetch failed")))).toBe(ar.errors.network);
  });

  it("uses the generic message for anything that is not an API error", () => {
    expect(getErrorMessage(t, new Error("TypeError in English"))).toBe(ar.errors.unknown);
  });

  it("detects 403 for the access-denied state", () => {
    expect(isForbidden(apiError(403, "FORBIDDEN"))).toBe(true);
    expect(isForbidden(apiError(404, "NOT_FOUND"))).toBe(false);
  });

  it("recognizes React Native's and the browser's raw fetch failures as network errors", () => {
    expect(isNetworkError(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("x is not a function"))).toBe(false);
    expect(getErrorMessage(t, new TypeError("Network request failed"))).toBe(ar.errors.network);
  });
});

describe("getCodeMessage (a code on its own, e.g. a rejected offline event)", () => {
  it("fills in details, falls back to the detail-free wording, and returns null for an unknown code", () => {
    expect(getCodeMessage(t, "GEOFENCE_OUTSIDE_ALLOWED_RADIUS", { distanceMeters: 184, allowedRadiusMeters: 100 })).toBe(
      "أنت خارج نطاق الموقع. المسافة: 184 م، المسموح: 100 م.",
    );
    expect(getCodeMessage(t, "GEOFENCE_OUTSIDE_ALLOWED_RADIUS")).toBe(ar.errors.GEOFENCE_OUTSIDE_ALLOWED_RADIUS_NO_DETAILS);
    expect(getCodeMessage(t, "INVALID_OFFLINE_SIGNATURE")).toBe(ar.errors.INVALID_OFFLINE_SIGNATURE);
    expect(getCodeMessage(t, "BRAND_NEW_CODE")).toBeNull();
  });
});
