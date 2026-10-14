import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { generateId } from "../ids";
import { AUDIT_GENESIS_HASH, auditChainHash, findChainBreak, readOrganizationChain } from "./audit-chain";

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
 * currentHash = SHA256(previousHash + canonicalPayload), one chain per
 * organization. The chain's order is explicit: each row carries the next
 * sequence number (1, 2, 3, ...) and links to the row numbered one less.
 *
 * An organization's writers take turns: record() holds a transaction-scoped
 * advisory lock on the organization until the writer's transaction ends, so
 * the next writer (another request, a BullMQ job) waits, then links to the
 * row just committed. A rolled-back row leaves no gap. The unique
 * (organization_id, sequence_number) index refuses a second row at the same
 * place. A caller passing its transaction records the audit as its last
 * write: the organization's other writers wait until that transaction ends.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput, tx?: PrismaTx) {
    if (!tx) return this.prisma.$transaction((ownTx) => this.append(input, ownTx));
    return this.append(input, tx);
  }

  private async append(input: RecordAuditEventInput, tx: PrismaTx) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`audit_logs:${input.organizationId}`}, 0))`;
    const previous = await tx.auditLog.findFirst({
      where: { organizationId: input.organizationId },
      orderBy: { sequenceNumber: "desc" },
      select: { sequenceNumber: true, currentHash: true },
    });
    const previousHash = previous?.currentHash ?? AUDIT_GENESIS_HASH;

    return tx.auditLog.create({
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
        sequenceNumber: (previous?.sequenceNumber ?? 0) + 1,
        previousHash,
        currentHash: auditChainHash(previousHash, input),
      },
    });
  }

  /** Walks an organization's chain in its order (sequence number, never created_at) and confirms every link's hash is valid. */
  async verifyOrganizationChain(organizationId: string): Promise<{ valid: boolean; brokenAtId?: string }> {
    const brokenAtId = findChainBreak(await readOrganizationChain(this.prisma, organizationId));
    return brokenAtId ? { valid: false, brokenAtId } : { valid: true };
  }
}
