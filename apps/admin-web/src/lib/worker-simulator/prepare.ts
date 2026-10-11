import type { FieldMasterClient, Shift, WorkerSimulatorContext } from "@fieldmaster/api-client";
import { CheckInMethod, ShiftStatus, ShiftType, TuranType } from "@fieldmaster/shared-types";

/**
 * Scenario "prepare" steps. Each one goes through the admin's own session and
 * the real management endpoints (create a shift, assign it, add a Night
 * Turan, make the worker a temporary supervisor) -- exactly what a manager
 * would do on the other admin pages. Nothing is written behind the API's back.
 */

const SHIFT_LENGTH_MS = 9 * 60 * 60_000;
const CLOSED_STATUSES = new Set<string>([ShiftStatus.CLOSED, ShiftStatus.CANCELLED]);

export class SimulatorPrepareError extends Error {
  constructor(public readonly reason: "noSite" | "noGeofence" | "noWorkerProfile") {
    super(reason);
  }
}

function isOpenRegularShift(shift: Shift): boolean {
  return shift.shiftType !== ShiftType.EMERGENCY_CALLOUT && !CLOSED_STATUSES.has(shift.status);
}

/** The worker's earliest open shift with this check-in method that has not ended yet. */
export function findUsableShift(shifts: Shift[], checkInMethod: CheckInMethod, now: number = Date.now()): Shift | undefined {
  return shifts
    .filter((s) => isOpenRegularShift(s) && s.checkInMethod === checkInMethod && new Date(s.scheduledEnd).getTime() > now)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))[0];
}

/**
 * Start of a 9-hour slot from about now that overlaps none of the worker's
 * other open shifts: the API refuses overlapping assignments. Clock-in does
 * not check a shift's scheduled window, so a slot that starts later today
 * still works for testing.
 */
export function freeSlotStart(shifts: Shift[], now: number = Date.now()): number {
  const open = shifts.filter(isOpenRegularShift);
  let start = now - 15 * 60_000;
  for (let i = 0; i <= open.length; i++) {
    const end = start + SHIFT_LENGTH_MS;
    const blocking = open.filter((s) => new Date(s.scheduledStart).getTime() < end && new Date(s.scheduledEnd).getTime() > start);
    if (blocking.length === 0) break;
    start = Math.max(...blocking.map((s) => new Date(s.scheduledEnd).getTime())) + 60_000;
  }
  return start;
}

/** Reuses the worker's open shift of this kind, or creates and assigns one at the site of their latest shift. Returns its id. */
export async function ensureShift(
  admin: FieldMasterClient,
  worker: { workerProfileId: string | null; shifts: Shift[] },
  options: { checkInMethod: CheckInMethod; title: string },
): Promise<string> {
  if (!worker.workerProfileId) throw new SimulatorPrepareError("noWorkerProfile");
  const existing = findUsableShift(worker.shifts, options.checkInMethod);
  if (existing) return existing.id;

  const sites = await admin.listSites();
  const latestSiteId = [...worker.shifts].sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart)).find((s) => s.siteId)?.siteId;
  const site = sites.find((s) => s.id === latestSiteId) ?? sites[0];
  if (!site) throw new SimulatorPrepareError("noSite");

  let geofenceId: string | undefined;
  if (options.checkInMethod === CheckInMethod.GEOFENCED) {
    geofenceId = (await admin.listGeofencesForSite(site.id))[0]?.id;
    if (!geofenceId) throw new SimulatorPrepareError("noGeofence");
  }

  const start = freeSlotStart(worker.shifts);
  const shift = await admin.createShift({
    projectId: site.projectId,
    siteId: site.id,
    geofenceId,
    shiftType: ShiftType.STANDARD,
    title: options.title,
    scheduledStart: new Date(start).toISOString(),
    scheduledEnd: new Date(start + SHIFT_LENGTH_MS).toISOString(),
    checkInMethod: options.checkInMethod,
  });
  await admin.assignWorkerToShift(shift.id, worker.workerProfileId);
  return shift.id;
}

/** Gives the worker a Night Turan covering now (unless one already does), which is what makes an emergency call-out eligible. */
export async function ensureNightTuran(admin: FieldMasterClient, workerProfileId: string, context: WorkerSimulatorContext | undefined, notes: string) {
  if (context?.emergencyEligibleTuranAssignmentId) return;
  const now = Date.now();
  await admin.createTuranAssignment({
    turanType: TuranType.NIGHT_TURAN,
    startAt: new Date(now - 30 * 60_000).toISOString(),
    endAt: new Date(now + 8 * 60 * 60_000).toISOString(),
    assignedWorkerProfileId: workerProfileId,
    notes,
    // A scheduled Turan that overlaps is fine for a test; the API asks for explicit confirmation.
    confirmOverlap: true,
  });
}

/** Makes the worker an active temporary supervisor on the shift (unless they already are). */
export async function ensureTemporarySupervisor(
  admin: FieldMasterClient,
  shiftId: string,
  workerProfileId: string,
  context: WorkerSimulatorContext | undefined,
) {
  if (context?.temporarySupervisorAssignments.some((a) => a.shiftId === shiftId)) return;
  await admin.assignTemporarySupervisor(shiftId, { workerProfileId });
}
