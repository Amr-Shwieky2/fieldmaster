import { createHash } from "node:crypto";
import {
  groupPayrollEntryCosts,
  sumPayrollWorkers,
  type PayrollCompensationProfile,
  type PayrollCostGroupResult,
  type PayrollEntryResult,
  type PayrollMonthEntry,
  type PayrollTotalsResult,
  type PayrollWorkerResult,
} from "@fieldmaster/shared-validation";

/**
 * The stored form of one payroll calculation (`payroll_calculation_snapshots`,
 * schemaVersion 2, Step 7). A version is always shown from its snapshot:
 * the entries, rates, adjustments and names as they were when it was
 * calculated, and the results computed from them -- never from live records.
 * No Nest dependency, so the seed builds its finalized month with it too.
 */
export const PAYROLL_SNAPSHOT_SCHEMA_VERSION = 2;

export interface SnapshotEntryInput extends PayrollMonthEntry {
  shift: { id: string; title: string; shiftType: string };
  projectName: string | null;
  siteName: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  updatedAt: string;
}

export interface SnapshotAdjustmentInput {
  id: string;
  workerProfileId: string;
  type: string;
  source: string;
  amountAgorot: number;
  reason: string | null;
  relatedInfractionId: string | null;
  /** The forgotten-stamp infraction's time entry. */
  timeEntryId: string | null;
  reversalOfId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface SnapshotWorkerName {
  workerProfileId: string;
  fullLegalName: string;
}

export interface PayrollSnapshotInputs {
  schemaVersion: typeof PAYROLL_SNAPSHOT_SCHEMA_VERSION;
  yearMonth: string;
  /** The month's APPROVED entries: the only attendance a calculation reads. */
  entries: SnapshotEntryInput[];
  compensationProfiles: PayrollCompensationProfile[];
  adjustments: SnapshotAdjustmentInput[];
  workers: SnapshotWorkerName[];
  /** Entries waiting for approval (or a correction) at calculation time: not included. */
  pending: { entries: number; byWorker: (SnapshotWorkerName & { entries: number })[] };
}

export interface SnapshotWorkerResult extends PayrollWorkerResult {
  fullLegalName: string;
  pendingEntries: number;
}

export interface SnapshotCostGroup extends PayrollCostGroupResult {
  name: string | null;
  /** Sites only. */
  projectName?: string | null;
}

export interface PayrollSnapshotResult {
  schemaVersion: typeof PAYROLL_SNAPSHOT_SCHEMA_VERSION;
  workers: SnapshotWorkerResult[];
  entries: PayrollEntryResult[];
  projects: SnapshotCostGroup[];
  sites: SnapshotCostGroup[];
  warnings: { workersWithoutCompensation: (SnapshotWorkerName & { entries: number; businessDates: string[] })[] };
}

export type PayrollSnapshotTotals = PayrollTotalsResult;

const byName = (a: { fullLegalName: string }, b: { fullLegalName: string }) => a.fullLegalName.localeCompare(b.fullLegalName, "ar");

/** The results and totals stored with a calculation, from the engine's per-worker and per-entry results. */
export function buildPayrollSnapshotResult(
  inputs: PayrollSnapshotInputs,
  workers: readonly PayrollWorkerResult[],
  entryResults: readonly PayrollEntryResult[],
): { result: PayrollSnapshotResult; totals: PayrollSnapshotTotals } {
  const nameOf = (workerProfileId: string) => inputs.workers.find((worker) => worker.workerProfileId === workerProfileId)?.fullLegalName ?? "";
  const pendingOf = (workerProfileId: string) => inputs.pending.byWorker.find((worker) => worker.workerProfileId === workerProfileId)?.entries ?? 0;
  const entryById = new Map(inputs.entries.map((entry) => [entry.timeEntryId, entry]));

  const projectName = (id: string | null) => (id === null ? null : (inputs.entries.find((entry) => entry.projectId === id)?.projectName ?? null));
  const site = (id: string | null) => (id === null ? null : (inputs.entries.find((entry) => entry.siteId === id) ?? null));

  const workersWithoutCompensation = workers
    .filter((worker) => worker.entriesWithoutCompensation > 0)
    .map((worker) => ({
      workerProfileId: worker.workerProfileId,
      fullLegalName: nameOf(worker.workerProfileId),
      entries: worker.entriesWithoutCompensation,
      businessDates: [
        ...new Set(
          entryResults
            .filter((line) => line.workerProfileId === worker.workerProfileId && line.compensationProfileId === null)
            .map((line) => entryById.get(line.timeEntryId)?.businessDate ?? ""),
        ),
      ].sort(),
    }))
    .sort(byName);

  return {
    result: {
      schemaVersion: PAYROLL_SNAPSHOT_SCHEMA_VERSION,
      workers: workers
        .map((worker) => ({ ...worker, fullLegalName: nameOf(worker.workerProfileId), pendingEntries: pendingOf(worker.workerProfileId) }))
        .sort(byName),
      entries: [...entryResults],
      projects: groupPayrollEntryCosts(inputs.entries, entryResults, "projectId").map((group) => ({ ...group, name: projectName(group.id) })),
      sites: groupPayrollEntryCosts(inputs.entries, entryResults, "siteId").map((group) => {
        const entry = site(group.id);
        return { ...group, name: entry?.siteName ?? null, projectName: entry?.projectName ?? null };
      }),
      warnings: { workersWithoutCompensation },
    },
    totals: sumPayrollWorkers(workers),
  };
}

/**
 * Fingerprint of what a calculation's results depend on: the approved
 * entries (id + last change), the month's adjustments, and the paid workers'
 * compensation profiles (id + last change). Equal hashes = nothing changed.
 */
export function payrollInputsHash(parts: {
  entries: readonly { id: string; updatedAt: Date | string }[];
  adjustmentIds: readonly string[];
  profiles: readonly { id: string; updatedAt: Date | string }[];
}): string {
  const stamp = (rows: readonly { id: string; updatedAt: Date | string }[]) =>
    rows.map((row) => `${row.id}@${row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt}`).sort();
  const canonical = JSON.stringify({ entries: stamp(parts.entries), adjustments: [...parts.adjustmentIds].sort(), profiles: stamp(parts.profiles) });
  return createHash("sha256").update(canonical).digest("hex");
}
