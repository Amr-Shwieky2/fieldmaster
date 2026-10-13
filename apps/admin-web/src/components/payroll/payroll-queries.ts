"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { PayrollCalculationRun, PayrollVersionDetail } from "@fieldmaster/api-client";
import { PayrollCalculationState, PayrollPeriodStatus } from "@fieldmaster/shared-types";
import { isNotFound } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";

/** React Query keys of the payroll screens. */
export const payrollKeys = {
  periods: ["payroll-periods"] as const,
  /** Every version of a month (prefix of `detail`). */
  month: (yearMonth: string) => ["payroll-period", yearMonth] as const,
  /** A month's latest version (`version` null) or a given one. */
  detail: (yearMonth: string, version: number | null) => ["payroll-period", yearMonth, version ?? "latest"] as const,
  calculation: (yearMonth: string) => ["payroll-calculation", yearMonth] as const,
  versions: (yearMonth: string) => ["payroll-versions", yearMonth] as const,
  workers: (yearMonth: string) => ["payroll-worker", yearMonth] as const,
  worker: (yearMonth: string, version: number, workerProfileId: string) => ["payroll-worker", yearMonth, version, workerProfileId] as const,
};

/** How often a running calculation is polled. */
export const CALCULATION_POLL_MS = 1000;

export function isCalculationRunning(run: Pick<PayrollCalculationRun, "state"> | null | undefined): boolean {
  return run?.state === PayrollCalculationState.QUEUED || run?.state === PayrollCalculationState.RUNNING;
}

/** Refetches everything that shows a month's payroll (the list, every version, the history and the drill-downs). */
export function invalidatePayrollMonth(queryClient: QueryClient, yearMonth: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: payrollKeys.periods }),
    queryClient.invalidateQueries({ queryKey: payrollKeys.month(yearMonth) }),
    queryClient.invalidateQueries({ queryKey: payrollKeys.versions(yearMonth) }),
    queryClient.invalidateQueries({ queryKey: payrollKeys.workers(yearMonth) }),
  ]);
}

/**
 * A new Idempotency-Key for one "calculate" click: a random UUID, also where
 * `crypto.randomUUID` is missing (it needs a secure context).
 */
export function newIdempotencyKey(): string {
  const cryptoApi: Crypto | undefined = typeof globalThis.crypto === "object" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `web-calc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Starts a month's background calculation (`mutate(newIdempotencyKey())`, one
 * key per click). The run the API answers (202) is cached, so the month page
 * shows its progress at once, and the month's data is refetched.
 */
export function useStartPayrollCalculation(yearMonth: string) {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (idempotencyKey: string) => client.calculatePayroll(yearMonth, idempotencyKey),
    onSuccess: (run) => {
      queryClient.setQueryData(payrollKeys.calculation(yearMonth), run);
      void invalidatePayrollMonth(queryClient, yearMonth);
    },
  });
}

/** The more recent of two views of a run: the later request, or for the same run the fresher response. */
function freshestRun(
  polled: PayrollCalculationRun | undefined,
  polledAt: number,
  fromDetail: PayrollCalculationRun | null,
  detailAt: number,
): PayrollCalculationRun | null {
  if (!polled) return fromDetail;
  if (!fromDetail) return polled;
  if (polled.id !== fromDetail.id) return Date.parse(polled.requestedAt) >= Date.parse(fromDetail.requestedAt) ? polled : fromDetail;
  return polledAt >= detailAt ? polled : fromDetail;
}

/**
 * The calculation run of the version on screen (null for an earlier version,
 * which is read-only). While the version is being calculated, the run is
 * polled about every second; when it ends (SUCCEEDED or FAILED) the month's
 * data is refetched and, after a run seen running, `onSucceeded` is called.
 */
export function useCalculationRun(
  yearMonth: string,
  detail: PayrollVersionDetail,
  detailUpdatedAt: number,
  onSucceeded: () => void,
): PayrollCalculationRun | null {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const key = payrollKeys.calculation(yearMonth);
  const running = detail.isCurrent && (isCalculationRunning(detail.calculation) || detail.status === PayrollPeriodStatus.CALCULATING);

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<PayrollCalculationRun>(key);
      const run = await client.getPayrollCalculation(yearMonth);
      if (!isCalculationRunning(run)) {
        void invalidatePayrollMonth(queryClient, yearMonth);
        if (run.state === PayrollCalculationState.SUCCEEDED && previous?.id === run.id && isCalculationRunning(previous)) onSucceeded();
      }
      return run;
    },
    enabled: running,
    // Poll until the run ends; stop when the month has no run at all (404).
    refetchInterval: (current) => {
      if (current.state.data && !isCalculationRunning(current.state.data)) return false;
      if (current.state.error && isNotFound(current.state.error)) return false;
      return CALCULATION_POLL_MS;
    },
  });

  if (!detail.isCurrent) return null;
  // The calculation endpoint follows the month's latest version; ignore a run of another version.
  const polled = query.data?.version === detail.version ? query.data : undefined;
  return freshestRun(polled, query.dataUpdatedAt, detail.calculation, detailUpdatedAt);
}
