import { Injectable } from "@nestjs/common";
import { OrgRole, type TimeEntryStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

@Injectable()
export class TimeEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, viewer: AuthenticatedUser, filters: { workerProfileId?: string; status?: TimeEntryStatus; businessDate?: string }) {
    const isManager = viewer.role === OrgRole.OWNER || viewer.role === OrgRole.FIELD_MANAGER;
    const workerScope = isManager ? filters.workerProfileId : viewer.workerProfileId ?? "__none__";

    return this.prisma.timeEntry.findMany({
      where: {
        organizationId,
        ...(workerScope ? { workerProfileId: workerScope } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.businessDate ? { businessDate: filters.businessDate } : {}),
      },
      include: { shift: true, dailySummary: true, clockEvents: true, corrections: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async getById(organizationId: string, id: string, viewer: AuthenticatedUser) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id, organizationId },
      include: { shift: true, dailySummary: true, clockEvents: true, corrections: true, approvals: true, unpaidBreaks: true },
    });
    if (!entry) throw new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");

    const isManager = viewer.role === OrgRole.OWNER || viewer.role === OrgRole.FIELD_MANAGER;
    if (!isManager && entry.workerProfileId !== viewer.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You cannot view another worker's attendance record.");
    }
    return entry;
  }
}
