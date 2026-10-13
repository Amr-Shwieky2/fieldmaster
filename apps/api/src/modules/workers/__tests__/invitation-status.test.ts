import { InvitationStatus } from "@fieldmaster/shared-types";
import { deriveInvitationStatus } from "../invitation-status";

const NOW = new Date("2026-10-13T10:00:00Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const invitation = (overrides: Partial<Parameters<typeof deriveInvitationStatus>[0]> = {}) => ({
  usedAt: null,
  revokedAt: null,
  revokedBy: null,
  expiresAt: at(60),
  ...overrides,
});

describe("deriveInvitationStatus", () => {
  it("ACTIVE until it expires", () => {
    expect(deriveInvitationStatus(invitation(), NOW)).toBe(InvitationStatus.ACTIVE);
    expect(deriveInvitationStatus(invitation({ expiresAt: NOW }), NOW)).toBe(InvitationStatus.EXPIRED);
    expect(deriveInvitationStatus(invitation({ expiresAt: at(-1) }), NOW)).toBe(InvitationStatus.EXPIRED);
  });

  it("USED once an application used it, whatever happened later", () => {
    expect(deriveInvitationStatus(invitation({ usedAt: at(-5) }), NOW)).toBe(InvitationStatus.USED);
    expect(deriveInvitationStatus(invitation({ usedAt: at(-90), expiresAt: at(-60) }), NOW)).toBe(InvitationStatus.USED);
  });

  it("REVOKED when a person revoked it, even after it expired", () => {
    expect(deriveInvitationStatus(invitation({ revokedAt: at(-5), revokedBy: "manager-id" }), NOW)).toBe(InvitationStatus.REVOKED);
    expect(deriveInvitationStatus(invitation({ revokedAt: at(-5), revokedBy: "manager-id", expiresAt: at(-10) }), NOW)).toBe(InvitationStatus.REVOKED);
  });

  it("REVOKED for a revocation before the expiry recorded without a revoker (before Step 8)", () => {
    expect(deriveInvitationStatus(invitation({ revokedAt: at(-30), expiresAt: at(-10) }), NOW)).toBe(InvitationStatus.REVOKED);
  });

  it("EXPIRED when the expiry sweep marked it revoked (after its expiry, no revoker)", () => {
    expect(deriveInvitationStatus(invitation({ revokedAt: at(-5), expiresAt: at(-10) }), NOW)).toBe(InvitationStatus.EXPIRED);
  });
});
