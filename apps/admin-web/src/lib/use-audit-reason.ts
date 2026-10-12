"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { CorrectionReason } from "@fieldmaster/shared-types";
import { useEnumLabel } from "@/i18n/enums";

/**
 * Manual time corrections store a CorrectionReason code, and some system events
 * (e.g. a rejected offline sync) store an API error code. Everything else is
 * free text typed by a person and is shown as written (except the legacy
 * English defaults below).
 */
const CORRECTION_REASONS = new Set<string>(Object.values(CorrectionReason));
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]+$/;

/**
 * Fixed English reasons the web app itself sent before it became Arabic only
 * (rows written then still hold them). They are system defaults, not text a
 * person typed, so they are shown with today's Arabic wording.
 */
type LegacyReason = "initialApproval" | "workerRejected" | "payrollReopened" | "attendanceRejected" | "fullDayCreditWeather";
const LEGACY_ENGLISH_REASONS: Record<string, LegacyReason> = {
  "Initial onboarding approval": "initialApproval",
  "Rejected during admin review.": "workerRejected",
  "Correction needed after review": "payrollReopened",
  "Rejected during review.": "attendanceRejected",
  "Weather stopped work": "fullDayCreditWeather",
};

/** `(reason) => Arabic text` for the `reason` of an audit row (audit log, attendance history). */
export function useAuditReason(): (reason: string) => string {
  const tErrors = useTranslations("errors");
  const tWorkers = useTranslations("workers");
  const tPayroll = useTranslations("payroll");
  const tAttendance = useTranslations("attendance");
  const enumLabel = useEnumLabel();

  return useCallback(
    (reason: string): string => {
      if (CORRECTION_REASONS.has(reason)) return enumLabel("CorrectionReason", reason);
      switch (LEGACY_ENGLISH_REASONS[reason.trim()]) {
        case "initialApproval":
          return tWorkers("approve.reasons.initialApproval");
        case "workerRejected":
          return tWorkers("approve.reasons.rejected");
        case "payrollReopened":
          return tPayroll("period.reopenReason");
        case "attendanceRejected":
          return tAttendance("reasonPrompt.rejectDefault");
        case "fullDayCreditWeather":
          return tAttendance("reasonPrompt.fullDayCreditDefault");
      }
      if (ERROR_CODE_PATTERN.test(reason)) {
        // Audit rows carry no error details, so prefer the wording without placeholders.
        const noDetailsKey = `${reason}_NO_DETAILS`;
        if (tErrors.has(noDetailsKey)) return tErrors(noDetailsKey);
        if (tErrors.has(reason)) return tErrors(reason);
      }
      return reason;
    },
    [enumLabel, tAttendance, tErrors, tPayroll, tWorkers],
  );
}
