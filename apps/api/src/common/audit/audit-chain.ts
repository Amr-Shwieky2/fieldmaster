import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

/** The event fields the chain hash covers (spec section 31.4); a missing optional field counts as null. */
export interface AuditChainFields {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  reason?: string | null;
  note?: string | null;
  correlationId: string;
}

/** A stored audit row, as the verifier reads it. */
export interface AuditChainRow extends AuditChainFields {
  id: string;
  sequenceNumber: number;
  previousHash: string;
  currentHash: string;
}

/**
 * currentHash = SHA256(previousHash + canonicalPayload). Unchanged since the
 * first release, so existing chains still verify: the request IP, user agent,
 * created_at and sequence number are not part of it.
 */
export function auditChainHash(previousHash: string, event: AuditChainFields): string {
  const canonicalPayload = JSON.stringify({
    organizationId: event.organizationId,
    actorUserId: event.actorUserId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    field: event.field ?? null,
    oldValue: event.oldValue ?? null,
    newValue: event.newValue ?? null,
    reason: event.reason ?? null,
    note: event.note ?? null,
    correlationId: event.correlationId,
  });
  return createHash("sha256").update(previousHash + canonicalPayload).digest("hex");
}

/**
 * The id of the first row where the chain breaks, or null when it holds. The
 * rows come in chain order: each carries the next sequence number (1, 2, 3,
 * ...; the writer never leaves a gap), links to the row before it (the first
 * to the genesis hash) and hashes to its stored current hash.
 */
export function findChainBreak(rows: readonly AuditChainRow[]): string | null {
  let expectedPrevious = AUDIT_GENESIS_HASH;
  for (const [index, row] of rows.entries()) {
    if (row.sequenceNumber !== index + 1 || row.previousHash !== expectedPrevious || row.currentHash !== auditChainHash(expectedPrevious, row)) {
      return row.id;
    }
    expectedPrevious = row.currentHash;
  }
  return null;
}

/** An organization's audit rows in chain order: by sequence number, never by created_at (rows of one millisecond share it). */
export function readOrganizationChain(prisma: Pick<PrismaClient, "auditLog">, organizationId: string) {
  return prisma.auditLog.findMany({ where: { organizationId }, orderBy: { sequenceNumber: "asc" } });
}
