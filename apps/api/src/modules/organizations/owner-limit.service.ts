import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";

type PrismaTx = Prisma.TransactionClient;

/**
 * The organization's limit of active Owners (`organization_settings.max_owners`;
 * empty = no limit). It replaces the fixed maximum of 2 the system had.
 * This runs inside the same transaction as the membership write, after
 * taking the organization's Owners lock (the same lock the
 * `trg_enforce_max_owners` trigger takes), so two simultaneous changes
 * cannot each see room for one more; the trigger is the backstop that holds
 * the limit even for writes that bypass the application.
 */
@Injectable()
export class OwnerLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async maxOwners(organizationId: string, client: PrismaTx | PrismaService = this.prisma): Promise<number | null> {
    const settings = await client.organizationSettings.findUnique({ where: { organizationId }, select: { maxOwners: true } });
    return settings?.maxOwners ?? null;
  }

  async activeOwners(organizationId: string, excludeMembershipId: string | undefined, client: PrismaTx | PrismaService = this.prisma): Promise<number> {
    return client.organizationMembership.count({
      where: {
        organizationId,
        role: OrgRole.OWNER,
        status: AccountStatus.ACTIVE,
        archivedAt: null,
        ...(excludeMembershipId ? { id: { not: excludeMembershipId } } : {}),
      },
    });
  }

  /** Takes the Owners lock of the organization until the transaction ends. */
  async lockOwners(tx: PrismaTx, organizationId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`owners:${organizationId}`}, 0))`;
  }

  async assertCanAddOwner(organizationId: string, excludeMembershipId: string | undefined, tx?: PrismaTx): Promise<void> {
    if (tx) await this.lockOwners(tx, organizationId);
    const client = tx ?? this.prisma;
    const max = await this.maxOwners(organizationId, client);
    if (max === null) return;
    const count = await this.activeOwners(organizationId, excludeMembershipId, client);
    if (count >= max) {
      throw new AppException(409, ErrorCodes.MAX_OWNERS_REACHED, `This organization already has the maximum of ${max} active Owners.`, { maxOwners: max });
    }
  }
}
