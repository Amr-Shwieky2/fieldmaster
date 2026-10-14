import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { FileAssetPurpose, Permission, type SummarySource, type TimeEntryStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN, YEAR_MONTH_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { hasPermission } from "../../common/auth/permissions";
import { scopeOf, timeEntryScopeWhere } from "../../common/scope/scope-filters";

/** The clock event fields a worker sees on their own entry (the receipt's reference and times, the location check). */
const OWN_CLOCK_EVENT_SELECT = {
  id: true,
  timeEntryId: true,
  eventType: true,
  origin: true,
  deviceId: true,
  clientEventId: true,
  deviceTimestamp: true,
  serverReceivedAt: true,
  deviceTimeDeviationSeconds: true,
  latitude: true,
  longitude: true,
  accuracyMeters: true,
  mockLocationSuspected: true,
  mockLocationState: true,
  locationSignals: true,
  distanceFromSiteMeters: true,
  locationValidationStatus: true,
  temporaryCheckInPointId: true,
  isManualCorrection: true,
  createdAt: true,
} satisfies Prisma.ClockEventSelect;

/** A correction as a worker sees it in their own list: what changed and why, not the manager's IP address, browser or id. */
const WORKER_CORRECTION_SELECT = {
  id: true,
  timeEntryId: true,
  field: true,
  oldValue: true,
  newValue: true,
  reason: true,
  note: true,
  createdAt: true,
} satisfies Prisma.ManualTimeCorrectionSelect;

@Injectable()
export class TimeEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    viewer: AuthenticatedUser,
    filters: { workerProfileId?: string; status?: TimeEntryStatus; businessDate?: string; month?: string },
  ) {
    // Step 9: `?month=YYYY-MM` (business month, Asia/Jerusalem); a malformed month is a 400, never an empty list.
    if (filters.month !== undefined && !YEAR_MONTH_PATTERN.test(filters.month)) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "month must be a month in the form YYYY-MM.", { field: "month" });
    }
    // A member who may see everyone's attendance sees every worker's entries (those of their projects, when restricted); anyone else, their own.
    const isManager = hasPermission(viewer, Permission.VIEW_ATTENDANCE);
    const workerScope = isManager ? filters.workerProfileId : viewer.workerProfileId ?? "__none__";

    return this.prisma.timeEntry.findMany({
      where: {
        organizationId,
        ...(workerScope ? { workerProfileId: workerScope } : {}),
        ...(isManager ? (timeEntryScopeWhere(scopeOf(viewer)) ?? {}) : {}),
        ...(filters.status ? { status: filters.status } : {}),
        AND: [
          ...(filters.businessDate ? [{ businessDate: filters.businessDate }] : []),
          ...(filters.month ? [{ businessDate: { startsWith: `${filters.month}-` } }] : []),
        ],
      },
      include: {
        shift: true,
        dailySummary: true,
        clockEvents: true,
        // Step 9: a worker's own list never carries who corrected an entry by IP address or browser (managers' list unchanged).
        corrections: isManager ? true : { select: WORKER_CORRECTION_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  /**
   * One entry. The caller's OWN entry (Step 9, any role) is the worker's
   * detail: the entry with its shift and clock events, its corrections with
   * their reason and who made them (by name), its summary and how many photos
   * it has -- no money. A member who may see everyone's attendance gets every
   * other entry (of their projects, when restricted) in the shape it always
   * had. For anyone else the entry does not exist: 404, like an unknown or
   * malformed id.
   */
  async getById(organizationId: string, id: string, viewer: AuthenticatedUser) {
    const notFound = () => new AppException(404, ErrorCodes.NOT_FOUND, "Time entry not found.");
    if (!UUID_PATTERN.test(id)) throw notFound();
    const owner = await this.prisma.timeEntry.findFirst({ where: { id, organizationId }, select: { workerProfileId: true } });
    if (!owner) throw notFound();

    if (viewer.workerProfileId !== null && owner.workerProfileId === viewer.workerProfileId) return this.ownDetail(id);

    if (!hasPermission(viewer, Permission.VIEW_ATTENDANCE)) throw notFound();
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id, organizationId, ...(timeEntryScopeWhere(scopeOf(viewer)) ?? {}) },
      include: { shift: true, dailySummary: true, clockEvents: true, corrections: true, approvals: true, unpaidBreaks: true },
    });
    if (!entry) throw notFound();
    return entry;
  }

  /** The contract's `MyTimeEntryDetail`. */
  private async ownDetail(id: string) {
    const entry = await this.prisma.timeEntry.findUniqueOrThrow({
      where: { id },
      include: {
        shift: true,
        dailySummary: true,
        clockEvents: { select: OWN_CLOCK_EVENT_SELECT, orderBy: { serverReceivedAt: "asc" } },
        corrections: { orderBy: { createdAt: "asc" } },
      },
    });
    const [photoCount, editors] = await Promise.all([
      this.prisma.fileAsset.count({ where: { timeEntryId: id, purpose: FileAssetPurpose.ATTENDANCE_PHOTO } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(entry.corrections.map((c) => c.editedBy))] } }, select: { id: true, fullLegalName: true } }),
    ]);
    const nameOf = new Map(editors.map((user) => [user.id, user.fullLegalName]));
    const summary = entry.dailySummary;

    return {
      id: entry.id,
      organizationId: entry.organizationId,
      workerProfileId: entry.workerProfileId,
      shiftId: entry.shiftId,
      status: entry.status,
      businessDate: entry.businessDate,
      clockInAt: entry.clockInAt,
      clockOutAt: entry.clockOutAt,
      rawDurationMinutes: entry.rawDurationMinutes,
      unpaidBreakMinutes: entry.unpaidBreakMinutes,
      approvedRegularMinutes: entry.approvedRegularMinutes,
      approvedOvertimeMinutes: entry.approvedOvertimeMinutes,
      fullDayCredit: entry.fullDayCredit,
      checkInMethod: entry.checkInMethod,
      isEmergency: entry.isEmergency,
      devRewoundAt: entry.devRewoundAt,
      approvedAt: entry.approvedAt,
      rejectedReason: entry.rejectedReason,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      shift: entry.shift,
      dailySummary: summary ? { text: summary.text, taskCategory: summary.taskCategory } : null,
      clockEvents: entry.clockEvents,
      // The reason and note of each correction, and who made it by name -- never their IP address or browser.
      corrections: entry.corrections.map((correction) => ({
        field: correction.field,
        oldValue: correction.oldValue,
        newValue: correction.newValue ?? "",
        reason: correction.reason,
        note: correction.note,
        correctedAt: correction.createdAt,
        correctedByName: nameOf.get(correction.editedBy) ?? null,
      })),
      summary: summary
        ? {
            text: summary.text,
            taskCategory: summary.taskCategory,
            followUpRequired: summary.followUpRequired,
            summarySource: (summary.summarySource as SummarySource | null) ?? null,
            hasVoiceNote: summary.voiceNoteAssetId !== null || Boolean(summary.voiceNoteUrl),
          }
        : null,
      photoCount,
    };
  }
}
