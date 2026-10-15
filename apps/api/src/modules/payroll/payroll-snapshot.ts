import { createHash } from "node:crypto";
import { LEGACY_FIXED_WORK_RULES, pickWorkRules, type WorkRuleVersion, type WorkRules } from "@fieldmaster/shared-types";
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

/** An approved entry as the figures of a month need it: what payroll prices, and its shift, project and site. */
export interface FigureEntryInput extends PayrollMonthEntry {
  shift: { id: string; title: string; shiftType: string };
  projectName: string | null;
  siteName: string | null;
}

/** An entry as a stored calculation keeps it: its figures, plus its times and last change. */
export interface SnapshotEntryInput extends FigureEntryInput {
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

/**
 * What a month's figures are computed from: a stored calculation's inputs,
 * or the live month the Owner dashboard reads (`PayrollInputsService.loadFigures`).
 */
export interface PayrollFigureInputs {
  /** The month's APPROVED entries: the only attendance a calculation reads. */
  entries: FigureEntryInput[];
  compensationProfiles: PayrollCompensationProfile[];
  adjustments: SnapshotAdjustmentInput[];
  workers: SnapshotWorkerName[];
  /** Entries waiting for approval (or a correction) at calculation time: not included. */
  pending: { entries: number; byWorker: (SnapshotWorkerName & { entries: number })[] };
  /**
   * The organization's work-rule versions when the calculation ran (flexible
   * organization model): each entry was priced with the version in force on
   * its business date, and a finalized month keeps exactly these. Absent on
   * calculations made before the rules were settings: the default rules.
   */
  workRules?: WorkRuleVersion[];
}

export interface PayrollSnapshotInputs extends PayrollFigureInputs {
  schemaVersion: typeof PAYROLL_SNAPSHOT_SCHEMA_VERSION;
  yearMonth: string;
  entries: SnapshotEntryInput[];
}

/**
 * The work rules of each business date of a stored calculation (or a live
 * month): its versions, or -- for a calculation stored before the rules were
 * settings, which has none -- the fixed rules of that time.
 */
export function snapshotRulesFor(inputs: Pick<PayrollFigureInputs, "workRules">): (businessDate: string) => WorkRules {
  const versions = inputs.workRules ?? [];
  if (versions.length === 0) return () => ({ ...LEGACY_FIXED_WORK_RULES });
  return (businessDate) => pickWorkRules(versions, businessDate);
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
  inputs: PayrollFigureInputs,
  workers: readonly PayrollWorkerResult[],
  entryResults: readonly PayrollEntryResult[],
): { result: PayrollSnapshotResult; totals: PayrollSnapshotTotals } {
  // Lookups by id (maps): a month of a few hundred workers must not cost a scan per worker.
  const nameById = new Map(inputs.workers.map((worker) => [worker.workerProfileId, worker.fullLegalName]));
  const pendingById = new Map(inputs.pending.byWorker.map((worker) => [worker.workerProfileId, worker.entries]));
  const nameOf = (workerProfileId: string) => nameById.get(workerProfileId) ?? "";
  const pendingOf = (workerProfileId: string) => pendingById.get(workerProfileId) ?? 0;
  const entryById = new Map(inputs.entries.map((entry) => [entry.timeEntryId, entry]));
  const projectNames = new Map<string, string | null>();
  const sitesById = new Map<string, FigureEntryInput>();
  for (const entry of inputs.entries) {
    if (entry.projectId !== null && !projectNames.has(entry.projectId)) projectNames.set(entry.projectId, entry.projectName);
    if (entry.siteId !== null && !sitesById.has(entry.siteId)) sitesById.set(entry.siteId, entry);
  }
  const projectName = (id: string | null) => (id === null ? null : (projectNames.get(id) ?? null));
  const site = (id: string | null) => (id === null ? null : (sitesById.get(id) ?? null));

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
  /** The ids of the organization's work-rule versions: a new version makes a working month "changed since calculation". Left out while there are none. */
  workRuleVersionIds?: readonly string[];
}): string {
  const stamp = (rows: readonly { id: string; updatedAt: Date | string }[]) =>
    rows.map((row) => `${row.id}@${row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt}`).sort();
  const canonical = JSON.stringify({
    entries: stamp(parts.entries),
    adjustments: [...parts.adjustmentIds].sort(),
    profiles: stamp(parts.profiles),
    ...(parts.workRuleVersionIds && parts.workRuleVersionIds.length > 0 ? { workRules: [...parts.workRuleVersionIds].sort() } : {}),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
