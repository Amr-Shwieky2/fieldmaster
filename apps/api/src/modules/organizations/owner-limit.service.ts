import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";

type PrismaTx = Prisma.TransactionClient;

/**
 * Application-level guard for the "max 2 active Owners per organization"
 * rule (spec section 6.1). This runs inside the same transaction as the
 * membership write so the app gives a clean 409 in the common case; the
 * `trg_enforce_max_two_owners` DB trigger (see prisma/migrations) is the
 * backstop that makes the invariant hold even under concurrent writes or
 * direct DB access.
 */
@Injectable()
export class OwnerLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAddOwner(organizationId: string, excludeMembershipId: string | undefined, tx?: PrismaTx): Promise<void> {
    const client = tx ?? this.prisma;
    const count = await client.organizationMembership.count({
      where: {
        organizationId,
        role: OrgRole.OWNER,
        status: AccountStatus.ACTIVE,
        archivedAt: null,
        ...(excludeMembershipId ? { id: { not: excludeMembershipId } } : {}),
      },
    });
    if (count >= 2) {
      throw new AppException(409, ErrorCodes.MAX_OWNERS_REACHED, "This organization already has the maximum of 2 active Owners.");
    }
  }
}
