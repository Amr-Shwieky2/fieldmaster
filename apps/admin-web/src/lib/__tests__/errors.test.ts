import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import { getErrorMessage, isForbidden, type ErrorTranslator } from "../errors";

// createTranslator's fully typed key union is narrower than the plain-string
// ErrorTranslator the helper accepts; the runtime shape is the same.
const tAr = createTranslator({ locale: "ar-u-nu-latn", messages: ar, namespace: "errors" }) as unknown as ErrorTranslator;
const tEn = createTranslator({ locale: "en-u-nu-latn", messages: en, namespace: "errors" }) as unknown as ErrorTranslator;

function apiError(status: number, code: string, message = "Server message", details: Record<string, unknown> = {}) {
  return new ApiRequestError(status, { statusCode: status, code, message, details, correlationId: "c" });
}

describe("getErrorMessage", () => {
  it("shows the geofence distance and allowed radius in Arabic and English", () => {
    const error = apiError(400, "GEOFENCE_OUTSIDE_ALLOWED_RADIUS", "You are outside the permitted check-in area.", {
      distanceMeters: 412.6,
      allowedRadiusMeters: 150,
    });
    const arabic = getErrorMessage(tAr, error);
    expect(arabic).toContain("413");
    expect(arabic).toContain("150");
    expect(arabic).toContain("نطاق الموقع");
    expect(getErrorMessage(tEn, error)).toBe("You are outside the geofence: 413 m away, the allowed radius is 150 m.");
  });

  it("falls back to the detail-free message when details are missing", () => {
    const error = apiError(400, "GEOFENCE_OUTSIDE_ALLOWED_RADIUS");
    expect(getErrorMessage(tEn, error)).toBe("Your current location is outside the allowed geofence.");
  });

  it("translates a known code without details", () => {
    expect(getErrorMessage(tAr, apiError(409, "PAYROLL_PERIOD_FINALIZED"))).toBe(ar.errors.PAYROLL_PERIOD_FINALIZED);
  });

  it("falls back to the API message for a code the frontend does not know", () => {
    expect(getErrorMessage(tAr, apiError(422, "SOMETHING_NEW", "Something new went wrong."))).toBe("Something new went wrong.");
  });

  it("uses the status message when the API sends its generic ERROR code", () => {
    expect(getErrorMessage(tAr, apiError(429, "ERROR", "ThrottlerException: Too Many Requests"))).toBe(ar.errors.rateLimited);
    expect(getErrorMessage(tEn, apiError(503, "ERROR", "Service Unavailable"))).toBe(en.errors.SERVICE_UNAVAILABLE);
    expect(getErrorMessage(tAr, apiError(409, "ERROR", "Conflict"))).toBe(ar.errors.ERROR);
  });

  it("uses the network message when the server was never reached", () => {
    expect(getErrorMessage(tAr, new NetworkError(new TypeError("fetch failed")))).toBe(ar.errors.network);
  });

  it("detects 403 for the access-denied state", () => {
    expect(isForbidden(apiError(403, "FORBIDDEN"))).toBe(true);
    expect(isForbidden(apiError(404, "NOT_FOUND"))).toBe(false);
  });
});
