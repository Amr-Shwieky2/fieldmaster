import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { InvitationStatus } from "@fieldmaster/shared-types";
import { deriveInvitationStatus, type InvitationLifecycle } from "./invitation-status";

/**
 * Onboarding invitation tokens (Step 8). A token is 32 random bytes as 64 hex
 * characters; only its SHA-256 is stored, and the raw token is returned once,
 * to the manager who created the invitation. It is never logged.
 */

const TOKEN_BYTES = 32;
const WELL_FORMED_TOKEN = /^[0-9a-f]{64}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Hashed in place of a malformed token so every request does the same work. Not hex, so no real token is ever equal to it. */
const PLACEHOLDER_TOKEN = "~".repeat(64);
/** Compared against when no invitation was found, so a comparison always runs. */
const PLACEHOLDER_HASH = Buffer.alloc(32);

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  return { token, tokenHash: hashInvitationToken(token) };
}

export interface InvitationTokenCandidate {
  /** 64 hex characters (the only shape a real token has). */
  wellFormed: boolean;
  /** SHA-256 of the token, or of a placeholder when it is malformed: always computed. */
  tokenHash: string;
}

/** What the client sent, hashed the same way whatever it is. */
export function invitationTokenCandidate(raw: unknown): InvitationTokenCandidate {
  const wellFormed = typeof raw === "string" && WELL_FORMED_TOKEN.test(raw);
  return { wellFormed, tokenHash: hashInvitationToken(wellFormed ? (raw as string).toLowerCase() : PLACEHOLDER_TOKEN) };
}

/** Constant-time comparison of a stored hash with the candidate's; runs (against a placeholder) even when nothing is stored. */
export function tokenHashMatches(storedHash: string | null | undefined, candidateHash: string): boolean {
  const stored = typeof storedHash === "string" && SHA256_HEX.test(storedHash) ? Buffer.from(storedHash, "hex") : null;
  const candidate = SHA256_HEX.test(candidateHash) ? Buffer.from(candidateHash, "hex") : Buffer.alloc(32, 0xff);
  const equal = timingSafeEqual(stored ?? PLACEHOLDER_HASH, candidate);
  return stored !== null && equal;
}

/**
 * The check shared by the three public onboarding routes: a well-formed
 * token, an invitation found by its hash whose stored hash matches in
 * constant time, and that is still ACTIVE (not used, revoked or expired).
 * Every step runs whatever the outcome; the caller answers the same 404 for
 * every failure.
 */
export function isUsableInvitation<T extends InvitationLifecycle & { tokenHash: string }>(
  candidate: InvitationTokenCandidate,
  invitation: T | null,
  now: Date,
): invitation is T {
  const hashMatches = tokenHashMatches(invitation?.tokenHash, candidate.tokenHash);
  const status = invitation ? deriveInvitationStatus(invitation, now) : InvitationStatus.EXPIRED;
  return candidate.wellFormed && hashMatches && status === InvitationStatus.ACTIVE;
}
