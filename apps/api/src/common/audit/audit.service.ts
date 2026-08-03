import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { generateId } from "../ids";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

export interface RecordAuditEventInput {
  organizationId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  note?: string;
  requestIp?: string;
  userAgent?: string;
  correlationId: string;
}

type PrismaTx = Prisma.TransactionClient;

/**
 * Append-only audit log with a SHA-256 hash chain (spec section 31.4):
 * currentHash = SHA256(previousHash + canonicalPayload). The chain is
 * scoped per organization. Concurrent writers to the *same* organization
 * within the same millisecond could in principle race on "previous hash" --
 * acceptable for this deployment's write volume; see technical-decisions.md.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput, tx?: PrismaTx) {
    const client = tx ?? this.prisma;
    const previous = await client.auditLog.findFirst({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      select: { currentHash: true },
    });
    const previousHash = previous?.currentHash ?? AUDIT_GENESIS_HASH;

    const canonicalPayload = JSON.stringify({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      field: input.field ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      reason: input.reason ?? null,
      note: input.note ?? null,
      correlationId: input.correlationId,
    });

    const currentHash = createHash("sha256").update(previousHash + canonicalPayload).digest("hex");

    return client.auditLog.create({
      data: {
        id: generateId(),
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        field: input.field,
        oldValue: input.oldValue,
        newValue: input.newValue,
        reason: input.reason,
        note: input.note,
        requestIp: input.requestIp,
        userAgent: input.userAgent,
        correlationId: input.correlationId,
        previousHash,
        currentHash,
      },
    });
  }

  /** Walks an organization's chain and confirms every link's hash is valid. */
  async verifyOrganizationChain(organizationId: string): Promise<{ valid: boolean; brokenAtId?: string }> {
    const events = await this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });

    let expectedPrevious = AUDIT_GENESIS_HASH;
    for (const event of events) {
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
      const expectedHash = createHash("sha256").update(expectedPrevious + canonicalPayload).digest("hex");
      if (event.previousHash !== expectedPrevious || event.currentHash !== expectedHash) {
        return { valid: false, brokenAtId: event.id };
      }
      expectedPrevious = event.currentHash;
    }
    return { valid: true };
  }
}
