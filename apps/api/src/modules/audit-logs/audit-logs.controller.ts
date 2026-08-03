import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/require-permissions.decorator";
import { Permission } from "../../common/auth/permissions";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";

@ApiBearerAuth()
@ApiTags("audit-logs")
@Controller("audit-logs")
export class AuditLogsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermissions(Permission.VIEW_AUDIT_LOG)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("entityType") entityType?: string,
    @Query("entityId") entityId?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const take = Math.min(Number(limit) || 50, 200);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId: user.organizationId,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
      },
      orderBy: { id: "desc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  @Get("verify")
  @RequirePermissions(Permission.VIEW_AUDIT_LOG)
  async verify(@CurrentUser() user: AuthenticatedUser) {
    return this.auditService.verifyOrganizationChain(user.organizationId);
  }
}
