import { getErrorCode } from "@fieldmaster/i18n";

/**
 * Why the app shows the account-state screen instead of anything else:
 * - PENDING_APPROVAL / REJECTED: the sign-in code was right, but the
 *   application is still under review, or was rejected;
 * - SUSPENDED: at sign-in, or later (any call answering ACCOUNT_SUSPENDED,
 *   or the session refresh answering NO_ACTIVE_MEMBERSHIP);
 * - DEVICE_KEY_REVOKED: an Owner revoked this phone's offline-signing key.
 *   The queue, the key and the session were cleared; `droppedEvents` records
 *   were still waiting to be sent.
 */
export type AccountStateKind = "PENDING_APPROVAL" | "REJECTED" | "SUSPENDED" | "DEVICE_KEY_REVOKED";

export interface AccountState {
  kind: AccountStateKind;
  droppedEvents?: number;
}

/** API error codes (sign-in or later) that switch the app to the account-state screen. */
export const ACCOUNT_STATE_CODES: Readonly<Record<string, AccountStateKind>> = {
  ACCOUNT_PENDING_APPROVAL: "PENDING_APPROVAL",
  ACCOUNT_REJECTED: "REJECTED",
  ACCOUNT_SUSPENDED: "SUSPENDED",
};

/** The account state an error means, if any (e.g. a 403 ACCOUNT_PENDING_APPROVAL from the sign-in). */
export function accountStateFromError(error: unknown): AccountStateKind | null {
  const code = getErrorCode(error);
  return code !== null && Object.prototype.hasOwnProperty.call(ACCOUNT_STATE_CODES, code) ? ACCOUNT_STATE_CODES[code] : null;
}
