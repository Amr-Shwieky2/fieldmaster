import type { PrismaService } from "../../common/prisma/prisma.service";

/**
 * Structured values stored in `notifications.data_json` next to the English
 * `title` / `body`.
 *
 * The English text is kept for clients that still display it as-is (the
 * mobile app until it is localized). Localized clients (the admin web) render
 * the message themselves from `type` + these values, so every value the
 * English text is built from is also stored here, as raw data: ISO-8601
 * instants, `YYYY-MM-DD` business dates, `YYYY-MM` months, whole minutes,
 * counts, enum values and names. Never pre-formatted text.
 *
 * FINANCIAL ISOLATION: money (`*Agorot` keys, integer agorot) may only be put
 * in the data of a notification whose recipient is an Owner. Call sites build
 * a separate Owner payload for that; `NotificationsService.notify()` also
 * strips any money key from a non-Owner recipient's data as a safety net.
 */
export type NotificationData = Record<string, string | number | boolean | null>;

/** Money keys (integer agorot). Owner recipients only. */
export function isFinancialDataKey(key: string): boolean {
  return /agorot/i.test(key);
}

/** True if `value` has a money key at any depth (nested objects and arrays included). */
export function hasFinancialData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFinancialData);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, nested]) => isFinancialDataKey(key) || hasFinancialData(nested));
}

/** A copy of `data` without any money key, at any depth. The input is not changed. */
export function withoutFinancialData<T>(data: T): T {
  if (Array.isArray(data)) return data.map(withoutFinancialData) as T;
  if (typeof data !== "object" || data === null) return data;
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => !isFinancialDataKey(key))
      .map(([key, nested]) => [key, withoutFinancialData(nested)]),
  ) as T;
}

/** `TURAN_ASSIGNMENT_CREATED` is sent for both new Turan assignments and new shift assignments. */
export const AssignmentKind = { TURAN: "TURAN", SHIFT: "SHIFT" } as const;

/** What happened in a `TURAN_ASSIGNMENT_CHANGED` notification. */
export const TuranAssignmentChange = { CANCELLED: "CANCELLED" } as const;

/** The worker's full legal name (as shown across the admin app), or null if the profile is gone. */
export async function loadWorkerName(prisma: PrismaService, workerProfileId: string): Promise<string | null> {
  const worker = await prisma.workerProfile.findUnique({
    where: { id: workerProfileId },
    select: { membership: { select: { user: { select: { fullLegalName: true } } } } },
  });
  return worker?.membership.user.fullLegalName ?? null;
}
