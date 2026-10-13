import { InvitationStatus } from "@fieldmaster/shared-types";

export interface InvitationLifecycle {
  usedAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  expiresAt: Date;
}

/**
 * Where an onboarding invitation stands (derived, never stored). The
 * background sweep (ExpireOnboardingInvitationsProcessor) marks unused
 * invitations past their expiry as revoked without a revoker; those read as
 * EXPIRED, like an expired invitation the sweep has not reached yet. A
 * revocation by a person (revokedBy, recorded since Step 8) or one made
 * before the expiry (an earlier manual revocation) reads as REVOKED.
 */
export function deriveInvitationStatus(invitation: InvitationLifecycle, now: Date): InvitationStatus {
  if (invitation.usedAt) return InvitationStatus.USED;
  if (invitation.revokedAt && (invitation.revokedBy || invitation.revokedAt < invitation.expiresAt)) return InvitationStatus.REVOKED;
  if (invitation.revokedAt || invitation.expiresAt <= now) return InvitationStatus.EXPIRED;
  return InvitationStatus.ACTIVE;
}
