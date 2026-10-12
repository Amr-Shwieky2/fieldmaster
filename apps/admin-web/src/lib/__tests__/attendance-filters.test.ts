import { describe, expect, it } from "vitest";
import { AttendanceFlag, AttendanceListTab, ShiftType, TimeEntryStatus } from "@fieldmaster/shared-types";
import {
  ATTENDANCE_DEFAULTS,
  ATTENDANCE_PAGE_SIZE,
  EMERGENCY_DEFAULTS,
  filtersToQuery,
  parseAttendanceFilters,
  parseEmergencyFilters,
} from "../attendance-filters";

const WORKER = "3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c";
const PROJECT = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const SITE = "0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f";

const url = (query: string) => new URLSearchParams(query);

/** The query string as key/value pairs (decoded), in order. */
const entriesOf = (query: string) => [...new URLSearchParams(query).entries()];

describe("parseAttendanceFilters", () => {
  it("defaults to the pending tab, page 1 and no filters", () => {
    const filters = parseAttendanceFilters(url(""));
    expect(filters).toEqual({ tab: "PENDING", page: 1 });
    expect(Object.entries(filters).filter(([, value]) => value !== undefined)).toEqual([
      ["tab", "PENDING"],
      ["page", 1],
    ]);
  });

  it("reads every filter from the URL", () => {
    const filters = parseAttendanceFilters(
      url(
        `tab=ALL&workerProfileId=${WORKER}&from=2026-10-01&to=2026-10-31&projectId=${PROJECT}&siteId=${SITE}&shiftType=NIGHT_TURAN&flags=OFFLINE,EMERGENCY&page=3`,
      ),
    );
    expect(filters).toStrictEqual({
      tab: "ALL",
      workerProfileId: WORKER,
      from: "2026-10-01",
      to: "2026-10-31",
      projectId: PROJECT,
      siteId: SITE,
      shiftType: "NIGHT_TURAN",
      flags: ["OFFLINE", "EMERGENCY"],
      page: 3,
    });
  });

  it.each(Object.values(AttendanceListTab))("accepts the %s tab", (tab) => {
    expect(parseAttendanceFilters(url(`tab=${tab}`)).tab).toBe(tab);
  });

  it.each(Object.values(ShiftType))("accepts the %s shift type", (shiftType) => {
    expect(parseAttendanceFilters(url(`shiftType=${shiftType}`)).shiftType).toBe(shiftType);
  });

  it("accepts ids in upper case", () => {
    expect(parseAttendanceFilters(url(`workerProfileId=${WORKER.toUpperCase()}`)).workerProfileId).toBe(WORKER.toUpperCase());
  });

  it.each(["approved", "OPEN", ""])("falls back to the pending tab for the unknown tab %j", (tab) => {
    expect(parseAttendanceFilters(url(`tab=${tab}`)).tab).toBe("PENDING");
  });

  it.each([
    ["workerProfileId", "wp-1"],
    ["workerProfileId", `${WORKER}0`],
    ["projectId", "123"],
    ["siteId", "not-a-uuid"],
    ["from", "2026-13-01"],
    ["from", "2026-10-1"],
    ["from", "01-10-2026"],
    ["from", "2026-10-01T00:00"],
    ["to", "2026-10-32"],
    ["to", "2026-00-10"],
    ["shiftType", "standard"],
    ["shiftType", "WEEKEND"],
  ] as const)("drops the malformed %s %j instead of sending it to the API", (key, value) => {
    expect(parseAttendanceFilters(url(`${key}=${value}`))[key]).toBeUndefined();
  });

  it.each(["0", "-2", "1.5", "two", ""])("falls back to page 1 for the page %j", (page) => {
    expect(parseAttendanceFilters(url(`page=${page}`)).page).toBe(1);
  });

  it("keeps the known flags once each, in the URL's order", () => {
    expect(parseAttendanceFilters(url("flags=EMERGENCY,NOT_A_FLAG,OFFLINE,EMERGENCY,,offline")).flags).toEqual(["EMERGENCY", "OFFLINE"]);
  });

  it("accepts every attendance flag", () => {
    const all = Object.values(AttendanceFlag);
    expect(parseAttendanceFilters(url(`flags=${all.join(",")}`)).flags).toEqual(all);
  });

  it.each(["", ",,", "NOT_A_FLAG", "offline"])("has no flags filter for %j", (flags) => {
    expect(parseAttendanceFilters(url(`flags=${flags}`)).flags).toBeUndefined();
  });
});

describe("parseEmergencyFilters", () => {
  it("defaults to page 1 and no filters", () => {
    expect(parseEmergencyFilters(url(""))).toEqual({ page: 1 });
  });

  it("reads every filter from the URL", () => {
    expect(parseEmergencyFilters(url(`workerProfileId=${WORKER}&from=2026-10-01&to=2026-10-31&status=PENDING_APPROVAL&page=2`))).toStrictEqual({
      workerProfileId: WORKER,
      from: "2026-10-01",
      to: "2026-10-31",
      status: "PENDING_APPROVAL",
      page: 2,
    });
  });

  it.each(Object.values(TimeEntryStatus))("accepts the %s status", (status) => {
    expect(parseEmergencyFilters(url(`status=${status}`)).status).toBe(status);
  });

  it("drops malformed values", () => {
    expect(parseEmergencyFilters(url("workerProfileId=wp-1&from=2026-1-01&to=yesterday&status=pending&page=-1"))).toEqual({ page: 1 });
  });

  it("ignores the attendance list's own filters", () => {
    const filters = parseEmergencyFilters(url(`tab=ALL&flags=OFFLINE&shiftType=STANDARD&projectId=${PROJECT}&siteId=${SITE}`));
    expect(Object.keys(filters).sort()).toEqual(["from", "page", "status", "to", "workerProfileId"]);
    expect(filters).toEqual({ page: 1 });
  });
});

describe("filtersToQuery", () => {
  it("leaves out the defaults", () => {
    expect(filtersToQuery({ tab: "PENDING", page: 1 }, ATTENDANCE_DEFAULTS)).toBe("");
    expect(filtersToQuery({ page: 1 }, EMERGENCY_DEFAULTS)).toBe("");
  });

  it("keeps the values that differ from the defaults, in the filters' order", () => {
    expect(filtersToQuery({ tab: "APPROVED", workerProfileId: WORKER, page: 2 }, ATTENDANCE_DEFAULTS)).toBe(`?tab=APPROVED&workerProfileId=${WORKER}&page=2`);
    expect(filtersToQuery({ tab: "PENDING", page: 2 }, ATTENDANCE_DEFAULTS)).toBe("?page=2");
    expect(filtersToQuery({ status: "APPROVED", page: 1 }, EMERGENCY_DEFAULTS)).toBe("?status=APPROVED");
  });

  it("keeps every value that is set when there are no defaults", () => {
    expect(filtersToQuery({ page: 1, status: "REJECTED" })).toBe("?page=1&status=REJECTED");
  });

  it("joins arrays with commas", () => {
    const query = filtersToQuery({ tab: "PENDING", flags: ["OFFLINE", "EMERGENCY"], page: 1 }, ATTENDANCE_DEFAULTS);
    expect(entriesOf(query)).toEqual([["flags", "OFFLINE,EMERGENCY"]]);
  });

  it("drops empty values", () => {
    expect(filtersToQuery({ workerProfileId: undefined, from: "", to: undefined, flags: [], page: 1 }, ATTENDANCE_DEFAULTS)).toBe("");
    expect(filtersToQuery({ workerProfileId: "", flags: [] })).toBe("");
  });

  it("removes duplicate flags on the way through the URL (parse, then build the query)", () => {
    const filters = parseAttendanceFilters(url("tab=APPROVED&flags=OFFLINE,OFFLINE,EMERGENCY,OFFLINE&page=1"));
    expect(entriesOf(filtersToQuery({ ...filters }, ATTENDANCE_DEFAULTS))).toEqual([
      ["tab", "APPROVED"],
      ["flags", "OFFLINE,EMERGENCY"],
    ]);
  });

  it("round-trips every attendance filter through the URL", () => {
    const filters = {
      tab: AttendanceListTab.REJECTED,
      workerProfileId: WORKER,
      from: "2026-10-01",
      to: "2026-10-31",
      projectId: PROJECT,
      siteId: SITE,
      shiftType: ShiftType.DAY_TURAN,
      flags: [AttendanceFlag.TEMPORARY_POINT, AttendanceFlag.FLEXI_CHECK],
      page: 4,
    };
    expect(parseAttendanceFilters(url(filtersToQuery({ ...filters }, ATTENDANCE_DEFAULTS)))).toStrictEqual(filters);
  });

  it("round-trips the defaults to an empty query", () => {
    expect(filtersToQuery({ ...parseAttendanceFilters(url("")) }, ATTENDANCE_DEFAULTS)).toBe("");
    expect(ATTENDANCE_PAGE_SIZE).toBe(20);
  });
});
