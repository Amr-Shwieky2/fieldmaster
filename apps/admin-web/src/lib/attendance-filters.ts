import type { AttendanceListFilters, EmergencyCalloutFilters } from "@fieldmaster/api-client";
import { AttendanceFlag, AttendanceListTab, ShiftType, TimeEntryStatus } from "@fieldmaster/shared-types";
import { BUSINESS_DATE_PATTERN } from "./jerusalem-time";

/**
 * The attendance and emergency lists keep their filters in the URL (shareable,
 * survive a reload, back/forward works). Unknown or malformed values are
 * dropped instead of being sent to the API.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(values: readonly T[], value: string | null): T | undefined {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : undefined;
}

const id = (value: string | null) => (value !== null && UUID.test(value) ? value : undefined);
const businessDate = (value: string | null) => (value !== null && BUSINESS_DATE_PATTERN.test(value) ? value : undefined);
const positiveInt = (value: string | null) => {
  const number = value === null ? NaN : Number(value);
  return Number.isInteger(number) && number >= 1 ? number : undefined;
};

export const ATTENDANCE_PAGE_SIZE = 20;

/** The attendance list's filters from the URL (`tab` defaults to PENDING). */
export function parseAttendanceFilters(params: URLSearchParams): Required<Pick<AttendanceListFilters, "tab" | "page">> & AttendanceListFilters {
  const flags = (params.get("flags") ?? "")
    .split(",")
    .map((flag) => oneOf(Object.values(AttendanceFlag), flag))
    .filter((flag): flag is AttendanceFlag => flag !== undefined);
  return {
    tab: oneOf(Object.values(AttendanceListTab), params.get("tab")) ?? AttendanceListTab.PENDING,
    workerProfileId: id(params.get("workerProfileId")),
    from: businessDate(params.get("from")),
    to: businessDate(params.get("to")),
    projectId: id(params.get("projectId")),
    siteId: id(params.get("siteId")),
    shiftType: oneOf(Object.values(ShiftType), params.get("shiftType")),
    flags: flags.length > 0 ? [...new Set(flags)] : undefined,
    page: positiveInt(params.get("page")) ?? 1,
  };
}

/** The emergency list's filters from the URL. */
export function parseEmergencyFilters(params: URLSearchParams): Required<Pick<EmergencyCalloutFilters, "page">> & EmergencyCalloutFilters {
  return {
    workerProfileId: id(params.get("workerProfileId")),
    from: businessDate(params.get("from")),
    to: businessDate(params.get("to")),
    status: oneOf(Object.values(TimeEntryStatus), params.get("status")),
    page: positiveInt(params.get("page")) ?? 1,
  };
}

/** A query string from filters (defaults and empty values left out), e.g. `?tab=APPROVED&flags=OFFLINE%2CEMERGENCY` (a list is comma-separated). */
export function filtersToQuery(filters: Record<string, string | number | string[] | undefined>, defaults: Record<string, string | number> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (defaults[key] !== undefined && defaults[key] === value) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const ATTENDANCE_DEFAULTS = { tab: AttendanceListTab.PENDING, page: 1 };
export const EMERGENCY_DEFAULTS = { page: 1 };
