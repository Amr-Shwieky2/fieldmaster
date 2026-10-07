import type { ReactElement } from "react";
import { ApiRequestError, type Worker } from "@fieldmaster/api-client";
import { renderWithIntl } from "@/test/render-with-intl";

/** Shared helpers for the workers page tests (the app is Arabic only). */

export function renderWorkersPage(ui: ReactElement): ReturnType<typeof renderWithIntl> {
  return renderWithIntl(ui, { queryClient: true });
}

export function apiError(status: number, code: string, message = "Message from the API", details: Record<string, unknown> = {}) {
  return new ApiRequestError(status, { statusCode: status, code, message, details, correlationId: "test-correlation" });
}

/** Workers as the API returns them to an Owner (compensation included). */
export const OWNER_WORKERS: Worker[] = [
  {
    id: "w-daily",
    organizationId: "org-1",
    fullLegalName: "Eli Ramzani",
    preferredName: null,
    phoneNumber: "+972500010001",
    accountStatus: "ACTIVE",
    role: "WORKER",
    createdAt: "2026-01-10T08:30:00.000Z",
    compensation: {
      compensationType: "DAILY",
      dailyBaseRateAgorot: 40000,
      baseHourlyRateAgorot: null,
      overtimeHourlyRateAgorot: 6000,
      effectiveStartDate: "2026-01-15T00:00:00.000Z",
    },
  },
  {
    id: "w-hourly",
    organizationId: "org-1",
    fullLegalName: "Samir Haddad",
    preferredName: null,
    phoneNumber: "+972500010002",
    accountStatus: "SUSPENDED",
    role: "WORKER",
    createdAt: "2026-02-01T06:00:00.000Z",
    compensation: {
      compensationType: "HOURLY",
      dailyBaseRateAgorot: null,
      baseHourlyRateAgorot: 123450,
      overtimeHourlyRateAgorot: 7525,
      effectiveStartDate: "2026-02-01T00:00:00.000Z",
    },
  },
];

/** The same workers as the API returns them to a Field Manager: no compensation key at all. */
export const MANAGER_WORKERS: Worker[] = OWNER_WORKERS.map((worker) => {
  const copy: Worker = { ...worker };
  delete copy.compensation;
  return copy;
});

export const PENDING = [
  { membershipId: "m-pending", workerProfileId: "w-pending", fullLegalName: "Nadia Khoury", phoneNumber: "+972500010009", submittedAt: "2026-09-30T07:00:00.000Z" },
];

/** True when any Arabic-Indic digit is on screen (the app must show 0-9 only). */
export function hasArabicIndicDigits(text: string | null | undefined): boolean {
  return /[٠-٩۰-۹]/.test(text ?? "");
}
