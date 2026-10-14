import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ClockEventType } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN, paginate } from "../../common/validation/patterns";
import { AttendanceCostService } from "../payroll/attendance-cost.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { canViewFinancials } from "../../common/auth/permissions";
import { isRestricted } from "../../common/scope/scope-filters";
import type { ListEmergencyCalloutsQueryDto } from "./dto/list-emergency-callouts.dto";

const CALLOUT_SELECT = {
  id: true,
  authorizationSource: true,
  authorizedBy: true,
  actualStartClick: true,
  compensatedStart: true,
  actualEndClick: true,
  compensatedEnd: true,
  actualWorkedMinutes: true,
  retroactiveMinutes: true,
  returnBufferMinutes: true,
  compensatedDurationMinutes: true,
  startLatitude: true,
  startLongitude: true,
  endLatitude: true,
  endLongitude: true,
  createdAt: true,
  worker: { select: { id: true, membership: { select: { user: { select: { fullLegalName: true } } } } } },
  turanAssignment: { select: { id: true, turanType: true, startAt: true, endAt: true } },
  timeEntry: {
    select: {
      id: true,
      workerProfileId: true,
      status: true,
      businessDate: true,
      clockOutAt: true,
      rawDurationMinutes: true,
      unpaidBreakMinutes: true,
      fullDayCredit: true,
      approvedRegularMinutes: true,
      approvedOvertimeMinutes: true,
      dailySummary: { select: { text: true, taskCategory: true, materialsUsed: true, problemsEncountered: true, followUpRequired: true } },
      clockEvents: { select: { eventType: true, accuracyMeters: true } },
    },
  },
} satisfies Prisma.EmergencyCalloutSelect;

type CalloutRow = Prisma.EmergencyCalloutGetPayload<{ select: typeof CALLOUT_SELECT }>;

/**
 * Emergency call-outs for the admin screens (Step 5). Two DTOs built by
 * different code paths: one for a member who may see financials carries
 * `estimatedCostAgorot`, anyone else's has no such key at all (not a null to
 * hide). The Turan rota and its call-outs belong to the whole organization
 * (they have no project), so a member restricted to some projects sees none.
 */
@Injectable()
export class EmergencyCalloutRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costs: AttendanceCostService,
  ) {}

  async list(organizationId: string, viewer: AuthenticatedUser, query: ListEmergencyCalloutsQueryDto) {
    const { page, pageSize, skip, take } = paginate(query.page, query.pageSize);
    const entryFilter: Prisma.TimeEntryWhereInput = {
      ...(query.from || query.to ? { businessDate: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const where: Prisma.EmergencyCalloutWhereInput = {
      organizationId,
      ...(isRestricted(viewer) ? { id: { in: [] } } : {}),
      ...(query.workerProfileId ? { workerProfileId: query.workerProfileId } : {}),
      ...(Object.keys(entryFilter).length > 0 ? { timeEntry: entryFilter } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.emergencyCallout.findMany({ where, select: CALLOUT_SELECT, orderBy: [{ actualStartClick: "desc" }, { id: "desc" }], skip, take }),
      this.prisma.emergencyCallout.count({ where }),
    ]);
    return { items: await this.toDtos(rows, viewer), page, pageSize, total };
  }

  async getById(organizationId: string, id: string, viewer: AuthenticatedUser) {
    const row =
      UUID_PATTERN.test(id) && !isRestricted(viewer) ? await this.prisma.emergencyCallout.findFirst({ where: { id, organizationId }, select: CALLOUT_SELECT }) : null;
    if (!row) throw new AppException(404, ErrorCodes.NOT_FOUND, "Emergency call-out not found.");
    const [dto] = await this.toDtos([row], viewer);
    return dto;
  }

  private async toDtos(rows: CalloutRow[], viewer: AuthenticatedUser) {
    const authorizerIds = [...new Set(rows.map((row) => row.authorizedBy).filter((id): id is string => id !== null))];
    const users =
      authorizerIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: authorizerIds } }, select: { id: true, fullLegalName: true } }) : [];

    // Money only for a member who may see financials: all the estimates in one batch, not one query per call-out.
    const estimates = canViewFinancials(viewer)
      ? new Map((await this.costs.estimateEntries(viewer.organizationId, rows.flatMap((row) => (row.timeEntry ? [row.timeEntry] : [])))).map((estimate) => [estimate.timeEntryId, estimate]))
      : new Map();
    return Promise.all(
      rows.map(async (row) => {
        const accuracyOf = (eventType: ClockEventType) => row.timeEntry?.clockEvents.find((event) => event.eventType === eventType)?.accuracyMeters ?? null;
        const base = {
          id: row.id,
          worker: { id: row.worker.id, fullLegalName: row.worker.membership.user.fullLegalName },
          authorizationSource: row.authorizationSource,
          authorizedByName: users.find((user) => user.id === row.authorizedBy)?.fullLegalName ?? null,
          turanAssignment: row.turanAssignment,
          actualStartClick: row.actualStartClick,
          compensatedStart: row.compensatedStart,
          actualEndClick: row.actualEndClick,
          compensatedEnd: row.compensatedEnd,
          actualWorkedMinutes: row.actualWorkedMinutes,
          retroactiveMinutes: row.retroactiveMinutes,
          returnBufferMinutes: row.returnBufferMinutes,
          compensatedDurationMinutes: row.compensatedDurationMinutes,
          start: { latitude: row.startLatitude, longitude: row.startLongitude, accuracyMeters: accuracyOf(ClockEventType.CLOCK_IN) },
          end:
            row.endLatitude !== null && row.endLongitude !== null
              ? { latitude: row.endLatitude, longitude: row.endLongitude, accuracyMeters: accuracyOf(ClockEventType.CLOCK_OUT) }
              : null,
          timeEntryId: row.timeEntry?.id ?? null,
          status: row.timeEntry?.status ?? null,
          businessDate: row.timeEntry?.businessDate ?? null,
          summary: row.timeEntry?.dailySummary ?? null,
          createdAt: row.createdAt,
        };
        if (!canViewFinancials(viewer)) return base;

        const estimate = row.timeEntry ? estimates.get(row.timeEntry.id) : null;
        return { ...base, estimatedCostAgorot: estimate?.estimatedCostAgorot ?? null };
      }),
    );
  }
}
