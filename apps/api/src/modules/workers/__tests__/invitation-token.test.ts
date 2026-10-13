// The module object itself (not a namespace copy), so a spy replaces what the helpers call.
import nodeCrypto, { createHash } from "node:crypto";
import { generateInvitationToken, hashInvitationToken, invitationTokenCandidate, isUsableInvitation, tokenHashMatches } from "../invitation-token";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const HOUR = 3_600_000;
const NOW = new Date("2026-10-13T10:00:00Z");

describe("invitation tokens", () => {
  it("are 64 random hex characters; only their SHA-256 is meant to be stored", () => {
    const first = generateInvitationToken();
    const second = generateInvitationToken();
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tokenHash).toBe(sha256(first.token));
    expect(first.tokenHash).not.toBe(first.token);
    expect(second.token).not.toBe(first.token);
    expect(hashInvitationToken(first.token)).toBe(first.tokenHash);
  });

  it("a candidate is always hashed: the token when well-formed (any case), a fixed placeholder otherwise", () => {
    const { token, tokenHash } = generateInvitationToken();
    expect(invitationTokenCandidate(token)).toEqual({ wellFormed: true, tokenHash });
    expect(invitationTokenCandidate(token.toUpperCase())).toEqual({ wellFormed: true, tokenHash });

    const malformed = [undefined, null, 42, "", "not-a-token", token.slice(1), `${token}0`, `${token.slice(1)}g`, ` ${token.slice(1)}`];
    const hashes = new Set<string>();
    for (const raw of malformed) {
      const candidate = invitationTokenCandidate(raw);
      expect(candidate.wellFormed).toBe(false);
      expect(candidate.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      hashes.add(candidate.tokenHash);
    }
    // One placeholder for every malformed input: the same work, and never a real token's hash.
    expect(hashes.size).toBe(1);
    expect([...hashes][0]).not.toBe(tokenHash);
  });

  it("hashes are compared in constant time, also when nothing was found", () => {
    const spy = jest.spyOn(nodeCrypto, "timingSafeEqual");
    try {
      const { tokenHash } = generateInvitationToken();
      expect(tokenHashMatches(tokenHash, tokenHash)).toBe(true);
      expect(tokenHashMatches(tokenHash, sha256("other"))).toBe(false);
      expect(tokenHashMatches(null, tokenHash)).toBe(false);
      expect(tokenHashMatches(undefined, tokenHash)).toBe(false);
      // A stored value that is not a SHA-256 never matches (and never throws).
      expect(tokenHashMatches("abc", tokenHash)).toBe(false);
      expect(spy).toHaveBeenCalledTimes(5);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isUsableInvitation (the check shared by the public routes)", () => {
  const { token, tokenHash } = generateInvitationToken();
  const active = { tokenHash, usedAt: null, revokedAt: null, revokedBy: null, expiresAt: new Date(NOW.getTime() + HOUR) };

  it("accepts a well-formed token of an active invitation whose stored hash matches", () => {
    expect(isUsableInvitation(invitationTokenCandidate(token), active, NOW)).toBe(true);
  });

  it("refuses a used, revoked or expired invitation, a hash mismatch, a missing invitation and a malformed token", () => {
    const candidate = invitationTokenCandidate(token);
    expect(isUsableInvitation(candidate, { ...active, usedAt: NOW }, NOW)).toBe(false);
    expect(isUsableInvitation(candidate, { ...active, revokedAt: NOW, revokedBy: "manager" }, NOW)).toBe(false);
    expect(isUsableInvitation(candidate, { ...active, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe(false);
    expect(isUsableInvitation(candidate, { ...active, tokenHash: sha256("another token") }, NOW)).toBe(false);
    expect(isUsableInvitation(candidate, null, NOW)).toBe(false);
    expect(isUsableInvitation(invitationTokenCandidate("short"), active, NOW)).toBe(false);
  });

  it("runs the constant-time comparison for every outcome", () => {
    const spy = jest.spyOn(nodeCrypto, "timingSafeEqual");
    try {
      const candidate = invitationTokenCandidate(token);
      isUsableInvitation(candidate, active, NOW);
      isUsableInvitation(candidate, null, NOW);
      isUsableInvitation(invitationTokenCandidate("malformed"), null, NOW);
      isUsableInvitation(candidate, { ...active, usedAt: NOW }, NOW);
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
  });
});
