import { describe, expect, it, vi } from "vitest";
import type { FieldMasterClient, Shift } from "@fieldmaster/api-client";
import { distanceMeters, offsetByMeters, relationToCircle } from "../geo";
import { withoutMoney } from "../strip-money";
import { deviceTimestamp } from "../device";
import { SimulatorPrepareError, ensureNightTuran, ensureShift, ensureTemporarySupervisor, findUsableShift, freeSlotStart } from "../prepare";

const SITE = { latitude: 32.0853, longitude: 34.7818 };

describe("geo", () => {
  it("measures ~55 m for 0.0005 degrees of latitude and round-trips an offset", () => {
    expect(distanceMeters(SITE, { latitude: 32.0858, longitude: 34.7818 })).toBeCloseTo(55.6, 0);
    const moved = offsetByMeters(SITE, 230, -40);
    expect(distanceMeters(SITE, moved)).toBeCloseTo(Math.hypot(230, 40), 0);
  });

  it("tells inside from outside and the distance to the edge", () => {
    const circle = { ...SITE, radiusMeters: 150 };
    expect(relationToCircle(offsetByMeters(SITE, 100, 0), circle)).toMatchObject({ inside: true });
    expect(relationToCircle(offsetByMeters(SITE, 100, 0), circle).toEdge).toBeCloseTo(50, 0);
    const outside = relationToCircle(offsetByMeters(SITE, 230, 0), circle);
    expect(outside.inside).toBe(false);
    expect(outside.toEdge).toBeCloseTo(80, 0);
  });
});

describe("device clock", () => {
  it("applies a positive or negative offset to the phone's timestamp", () => {
    const at = Date.parse("2026-10-11T08:00:00.000Z");
    expect(deviceTimestamp({ clockOffsetSeconds: 300 }, at)).toBe("2026-10-11T08:05:00.000Z");
    expect(deviceTimestamp({ clockOffsetSeconds: -90 }, at)).toBe("2026-10-11T07:58:30.000Z");
  });
});

describe("withoutMoney", () => {
  it("removes every *Agorot field and compensation object, however deep", () => {
    const input = {
      title: "x",
      project: { budgetAgorot: 5, name: "p" },
      items: [{ dailyBaseRateAgorot: 1, keep: true }],
      compensation: { overtimeHourlyRateAgorot: 3 },
    };
    expect(withoutMoney(input)).toEqual({ value: { title: "x", project: { name: "p" }, items: [{ keep: true }] }, removed: true });
    expect(withoutMoney({ a: 1 })).toEqual({ value: { a: 1 }, removed: false });
  });
});

function shift(partial: Partial<Shift>): Shift {
  return {
    id: "s",
    organizationId: "org-1",
    projectId: "p1",
    siteId: "site-1",
    geofenceId: "g1",
    shiftType: "STANDARD",
    title: "t",
    scheduledStart: "2026-10-11T05:00:00.000Z",
    scheduledEnd: "2026-10-11T14:00:00.000Z",
    checkInMethod: "GEOFENCED",
    status: "PUBLISHED",
    managerId: "u",
    businessDate: "2026-10-11",
    ...partial,
  } as Shift;
}

describe("scenario preparation", () => {
  const NOW = Date.parse("2026-10-11T08:00:00.000Z");

  it("reuses an open, not-yet-ended shift of the requested kind only", () => {
    const shifts = [
      shift({ id: "closed", status: "CLOSED" }),
      shift({ id: "ended", scheduledEnd: "2026-10-11T07:00:00.000Z" }),
      shift({ id: "flexi", checkInMethod: "FLEXI_CHECK" }),
      shift({ id: "open" }),
    ];
    expect(findUsableShift(shifts, "GEOFENCED", NOW)?.id).toBe("open");
    expect(findUsableShift(shifts, "FLEXI_CHECK", NOW)?.id).toBe("flexi");
    expect(findUsableShift([], "GEOFENCED", NOW)).toBeUndefined();
  });

  it("starts a new 9-hour slot after the worker's overlapping open shifts (the API refuses overlaps)", () => {
    expect(freeSlotStart([], NOW)).toBe(NOW - 15 * 60_000);
    const busy = [shift({ scheduledStart: "2026-10-11T05:00:00.000Z", scheduledEnd: "2026-10-11T14:00:00.000Z" }), shift({ status: "CANCELLED", scheduledEnd: "2026-10-12T00:00:00.000Z" })];
    expect(freeSlotStart(busy, NOW)).toBe(Date.parse("2026-10-11T14:01:00.000Z"));
  });

  it("creates and assigns a geofenced shift through the admin's real endpoints when none is usable", async () => {
    const admin = {
      listSites: vi.fn().mockResolvedValue([{ id: "site-1", projectId: "p1" }, { id: "site-2", projectId: "p2" }]),
      listGeofencesForSite: vi.fn().mockResolvedValue([{ id: "g-latest" }]),
      createShift: vi.fn().mockResolvedValue({ id: "new-shift" }),
      assignWorkerToShift: vi.fn().mockResolvedValue({}),
    } as unknown as FieldMasterClient;
    const past = shift({ id: "past", siteId: "site-2", scheduledStart: "2026-10-01T05:00:00.000Z", scheduledEnd: "2026-10-01T14:00:00.000Z" });

    const id = await ensureShift(admin, { workerProfileId: "wp-1", shifts: [past] }, { checkInMethod: "GEOFENCED", title: "اختبار" });

    expect(id).toBe("new-shift");
    expect(admin.listGeofencesForSite).toHaveBeenCalledWith("site-2");
    expect(admin.createShift).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: "site-2", projectId: "p2", geofenceId: "g-latest", shiftType: "STANDARD", checkInMethod: "GEOFENCED", title: "اختبار" }),
    );
    expect(admin.assignWorkerToShift).toHaveBeenCalledWith("new-shift", "wp-1");
  });

  it("does not create anything when the worker can already use a shift, a Turan or a supervisor role", async () => {
    const admin = { createShift: vi.fn(), createTuranAssignment: vi.fn(), assignTemporarySupervisor: vi.fn() } as unknown as FieldMasterClient;
    const context = {
      workerProfileId: "wp-1",
      turanAssignments: [],
      emergencyEligibleTuranAssignmentId: "turan-1",
      temporarySupervisorAssignments: [{ id: "a", shiftId: "s", shiftTitle: "t", activatedAt: "", expiresAt: "" }],
    };
    await expect(ensureShift(admin, { workerProfileId: "wp-1", shifts: [shift({ scheduledEnd: "2099-01-01T00:00:00.000Z" })] }, { checkInMethod: "GEOFENCED", title: "t" })).resolves.toBe("s");
    await ensureNightTuran(admin, "wp-1", context, "n");
    await ensureTemporarySupervisor(admin, "s", "wp-1", context);
    expect(admin.createShift).not.toHaveBeenCalled();
    expect(admin.createTuranAssignment).not.toHaveBeenCalled();
    expect(admin.assignTemporarySupervisor).not.toHaveBeenCalled();
  });

  it("adds a Night Turan covering now when the worker is not eligible", async () => {
    const admin = { createTuranAssignment: vi.fn().mockResolvedValue({}) } as unknown as FieldMasterClient;
    await ensureNightTuran(admin, "wp-1", undefined, "ملاحظة");
    const input = vi.mocked(admin.createTuranAssignment).mock.calls[0]![0] as Record<string, string>;
    expect(input).toMatchObject({ turanType: "NIGHT_TURAN", assignedWorkerProfileId: "wp-1", notes: "ملاحظة", confirmOverlap: true });
    expect(Date.parse(input.startAt!)).toBeLessThan(Date.now());
    expect(Date.parse(input.endAt!)).toBeGreaterThan(Date.now());
  });

  it("refuses to prepare a shift for an account without a worker profile", async () => {
    await expect(ensureShift({} as FieldMasterClient, { workerProfileId: null, shifts: [] }, { checkInMethod: "GEOFENCED", title: "t" })).rejects.toBeInstanceOf(
      SimulatorPrepareError,
    );
  });
});
