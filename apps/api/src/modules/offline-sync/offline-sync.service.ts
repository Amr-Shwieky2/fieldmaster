import { Injectable, Logger } from "@nestjs/common";
import { ClockEventType, EventOrigin, LocationValidationStatus, NotificationType, OfflineSyncEventStatus, OrgRole } from "@fieldmaster/shared-types";
import { canonicalizeOfflineEvent, verifyOfflineEventSignature, type OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { IdempotencyService } from "../../common/idempotency/idempotency.service";
import { NotificationsService } from "../notifications/notifications.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { ClockEventsService } from "../attendance/clock-events.service";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { ClockInDto } from "../attendance/dto/clock-in.dto";
import type { ClockOutDto } from "../attendance/dto/clock-out.dto";
import type { OfflineSyncBatchDto, OfflineSyncEventInputDto } from "./dto/offline-sync-batch.dto";

export interface EventOutcome {
  clientEventId: string;
  status: OfflineSyncEventStatus;
  reason?: string;
  timeEntryId?: string;
}

/**
 * Processes a batch of clock events a device queued while offline (spec
 * section 20). Each event is independently signature-verified, then
 * dispatched through the *exact same* rule engine as a live online
 * clock-in/out (ClockEventsService.clockInCore/clockOutCore) so offline
 * attendance can never take a shortcut around geofencing, shift
 * assignment, or the mandatory summary -- the only difference is which
 * timestamp is authoritative for the resulting TimeEntry (see clockInCore's
 * docstring) and that time-deviation beyond 120s flags rather than rejects.
 */
@Injectable()
export class OfflineSyncService {
  private readonly logger = new Logger(OfflineSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    private readonly notifications: NotificationsService,
    private readonly clockEventsService: ClockEventsService,
  ) {}

  async submitBatch(
    organizationId: string,
    dto: OfflineSyncBatchDto,
    actor: AuthenticatedUser,
    idempotencyKey: string | undefined,
    correlationId: string,
  ) {
    if (!actor.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "Only time-trackable workers can submit offline attendance events.");
    }
    const workerProfileId = actor.workerProfileId;

    const result = await this.idempotencyService.withIdempotency(idempotencyKey, "offline-sync-batch", dto, async () => {
      const deviceKey = await this.prisma.devicePublicKey.findUnique({
        where: { userId_deviceId: { userId: actor.sub, deviceId: dto.deviceId } },
      });

      const batch = await this.prisma.offlineSyncBatch.create({
        data: {
          id: generateId(),
          organizationId,
          workerProfileId,
          deviceId: dto.deviceId,
          idempotencyKey: idempotencyKey ?? null,
          eventCount: dto.events.length,
        },
      });

      // Process strictly in the order the events actually happened on the
      // device, not the order they happen to appear in the request body
      // (spec section 20.3: "Send events in chronological order").
      const orderedEvents = [...dto.events].sort(
        (a, b) => new Date(a.deviceTimestamp).getTime() - new Date(b.deviceTimestamp).getTime(),
      );

      const outcomes: EventOutcome[] = [];
      for (const event of orderedEvents) {
        outcomes.push(await this.processEvent(organizationId, batch.id, dto.deviceId, event, deviceKey, actor, correlationId));
      }

      const flaggedOrRejected = outcomes.filter((o) => o.status === OfflineSyncEventStatus.FLAGGED || o.status === OfflineSyncEventStatus.REJECTED);
      if (flaggedOrRejected.length > 0) {
        await this.notifyReviewNeeded(organizationId, workerProfileId, flaggedOrRejected);
      }

      return { status: 200, body: { batchId: batch.id, results: outcomes } };
    });

    return result.body;
  }

  async getBatch(organizationId: string, batchId: string, actor: AuthenticatedUser) {
    const batch = await this.prisma.offlineSyncBatch.findFirst({
      where: { id: batchId, organizationId },
      include: { events: { orderBy: { deviceTimestamp: "asc" } } },
    });
    if (!batch) throw new AppException(404, ErrorCodes.NOT_FOUND, "Offline sync batch not found.");
    // Workers only ever see their own sync history; Owners/Field Managers
    // (even ones who are also time-trackable) can review any worker's --
    // this mirrors "Owners and Field Managers can review operational flags"
    // (spec 19.2).
    if (actor.role === OrgRole.WORKER && batch.workerProfileId !== actor.workerProfileId) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "You cannot view another worker's offline sync history.");
    }
    return batch;
  }

  async listBatches(organizationId: string, actor: AuthenticatedUser) {
    const where =
      actor.role === OrgRole.WORKER
        ? { organizationId, workerProfileId: actor.workerProfileId ?? "" }
        : { organizationId };
    return this.prisma.offlineSyncBatch.findMany({
      where,
      include: { events: true },
      orderBy: { submittedAt: "desc" },
      take: 50,
    });
  }

  private async processEvent(
    organizationId: string,
    batchId: string,
    deviceId: string,
    event: OfflineSyncEventInputDto,
    deviceKey: { publicKey: string; revokedAt: Date | null } | null,
    actor: AuthenticatedUser,
    correlationId: string,
  ): Promise<EventOutcome> {
    const signablePayload: OfflineEventSignablePayload = {
      clientEventId: event.clientEventId,
      eventType: event.eventType,
      // IMPORTANT: this must reconstruct *exactly* the object shape the
      // device signed. `canonicalizeOfflineEvent` drops keys whose value is
      // `undefined` but keeps explicit `null`/`false` -- so defaulting an
      // absent field here with `?? null` would silently produce different
      // bytes than a client that simply omitted the field, and every
      // signature would fail to verify. Pass fields through as-is; only
      // reach for `??` where the *client* is documented to always send a
      // concrete value (there is none such here).
      shiftId: event.shiftId,
      temporaryCheckInPointId: event.temporaryCheckInPointId,
      deviceTimestamp: event.deviceTimestamp,
      latitude: event.latitude,
      longitude: event.longitude,
      accuracyMeters: event.accuracyMeters,
      altitude: event.altitude,
      locationProvider: event.locationProvider,
      mockLocationSuspected: event.mockLocationSuspected,
      appVersion: event.appVersion,
      summaryText: event.summaryText,
      voiceNoteUrl: event.voiceNoteUrl,
      taskCategory: event.taskCategory,
      materialsUsed: event.materialsUsed,
      problemsEncountered: event.problemsEncountered,
      followUpRequired: event.followUpRequired,
    };
    const offlineEventAgeSeconds = Math.max(0, Math.round((Date.now() - new Date(event.deviceTimestamp).getTime()) / 1000));

    const persist = (
      status: OfflineSyncEventStatus,
      extra: { signatureValid: boolean; rejectionReason?: string; resultTimeEntryId?: string; resultClockEventId?: string },
    ) =>
      this.prisma.offlineSyncEvent.create({
        data: {
          id: generateId(),
          batchId,
          clientEventId: event.clientEventId,
          eventType: event.eventType,
          deviceTimestamp: new Date(event.deviceTimestamp),
          status,
          offlineEventAgeSeconds,
          payload: signablePayload as object,
          ...extra,
        },
      });

    // 1. Device must have a live registered signing key.
    if (!deviceKey || deviceKey.revokedAt) {
      await persist(OfflineSyncEventStatus.REJECTED, { signatureValid: false, rejectionReason: ErrorCodes.DEVICE_KEY_NOT_REGISTERED });
      return { clientEventId: event.clientEventId, status: OfflineSyncEventStatus.REJECTED, reason: ErrorCodes.DEVICE_KEY_NOT_REGISTERED };
    }

    // 2. Signature must verify -- this is what makes the event trustworthy
    // evidence despite having sat unsynced on the device for an unknown
    // length of time (spec 20.2/20.3).
    const canonical = canonicalizeOfflineEvent(signablePayload);
    const signatureValid = verifyOfflineEventSignature(canonical, event.signature, deviceKey.publicKey);
    if (!signatureValid) {
      await persist(OfflineSyncEventStatus.REJECTED, { signatureValid: false, rejectionReason: ErrorCodes.INVALID_OFFLINE_SIGNATURE });
      await this.auditService.record({
        organizationId,
        actorUserId: actor.sub,
        action: "OFFLINE_EVENT_REJECTED",
        entityType: "OfflineSyncEvent",
        entityId: event.clientEventId,
        reason: ErrorCodes.INVALID_OFFLINE_SIGNATURE,
        correlationId,
      });
      return { clientEventId: event.clientEventId, status: OfflineSyncEventStatus.REJECTED, reason: ErrorCodes.INVALID_OFFLINE_SIGNATURE };
    }

    // 3. Duplicate detection: this exact (device, clientEventId) pair was
    // already turned into a real ClockEvent (e.g. a retried batch after a
    // partial network failure). Mirrors the DB-level unique constraint.
    const existing = await this.prisma.clockEvent.findUnique({
      where: { deviceId_clientEventId: { deviceId, clientEventId: event.clientEventId } },
    });
    if (existing) {
      await persist(OfflineSyncEventStatus.DUPLICATE, { signatureValid: true, resultTimeEntryId: existing.timeEntryId, resultClockEventId: existing.id });
      return { clientEventId: event.clientEventId, status: OfflineSyncEventStatus.DUPLICATE, timeEntryId: existing.timeEntryId };
    }

    // 4. Dispatch through the real clock-in/out rule engine (origin=OFFLINE).
    const shared = {
      deviceId,
      clientEventId: event.clientEventId,
      deviceTimestamp: event.deviceTimestamp,
      latitude: event.latitude,
      longitude: event.longitude,
      accuracyMeters: event.accuracyMeters,
      altitude: event.altitude,
      locationProvider: event.locationProvider,
      mockLocationSuspected: event.mockLocationSuspected,
      origin: EventOrigin.OFFLINE,
      appVersion: event.appVersion,
    };

    try {
      if (event.eventType === ClockEventType.CLOCK_IN) {
        if (!event.shiftId) {
          throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "shiftId is required for an offline CLOCK_IN event.");
        }
        const clockInDto: ClockInDto = { ...shared, shiftId: event.shiftId, temporaryCheckInPointId: event.temporaryCheckInPointId };
        const outcome = await this.clockEventsService.clockInCore(
          organizationId,
          clockInDto,
          actor,
          `offline:${batchId}:${event.clientEventId}`,
          correlationId,
        );
        const status =
          outcome.body.clockEvent.locationValidationStatus === LocationValidationStatus.FLAGGED
            ? OfflineSyncEventStatus.FLAGGED
            : OfflineSyncEventStatus.VERIFIED;
        await persist(status, { signatureValid: true, resultTimeEntryId: outcome.body.timeEntry.id, resultClockEventId: outcome.body.clockEvent.id });
        return { clientEventId: event.clientEventId, status, timeEntryId: outcome.body.timeEntry.id };
      }

      if (!event.taskCategory) {
        throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "taskCategory is required for an offline CLOCK_OUT event.");
      }
      const clockOutDto: ClockOutDto = {
        ...shared,
        taskCategory: event.taskCategory,
        summaryText: event.summaryText,
        voiceNoteUrl: event.voiceNoteUrl,
        materialsUsed: event.materialsUsed,
        problemsEncountered: event.problemsEncountered,
        followUpRequired: event.followUpRequired,
      };
      const outcome = await this.clockEventsService.clockOutCore(
        organizationId,
        clockOutDto,
        actor,
        `offline:${batchId}:${event.clientEventId}`,
        correlationId,
      );
      const status =
        outcome.clockEvent.locationValidationStatus === LocationValidationStatus.FLAGGED
          ? OfflineSyncEventStatus.FLAGGED
          : OfflineSyncEventStatus.VERIFIED;
      await persist(status, { signatureValid: true, resultTimeEntryId: outcome.body.id, resultClockEventId: outcome.clockEvent.id });
      return { clientEventId: event.clientEventId, status, timeEntryId: outcome.body.id };
    } catch (error) {
      // A deterministic business-rule conflict (spec 20.4 examples: an
      // online clock-in already closed the worker's open entry, a shift was
      // cancelled before sync, a duplicate clock-out) -- reject this one
      // event with the same error code the online endpoint would have
      // returned, but keep processing the rest of the batch.
      const reason = error instanceof AppException ? error.code : "OFFLINE_EVENT_PROCESSING_FAILED";
      this.logger.warn(`Offline event ${event.clientEventId} rejected: ${reason}`);
      await persist(OfflineSyncEventStatus.REJECTED, { signatureValid: true, rejectionReason: reason });
      return { clientEventId: event.clientEventId, status: OfflineSyncEventStatus.REJECTED, reason };
    }
  }

  private async notifyReviewNeeded(organizationId: string, workerProfileId: string, outcomes: EventOutcome[]) {
    const worker = await this.prisma.workerProfile.findUnique({
      where: { id: workerProfileId },
      include: { membership: { include: { user: true } } },
    });
    const owners = await this.prisma.organizationMembership.findMany({
      where: { organizationId, role: OrgRole.OWNER, status: "ACTIVE", archivedAt: null },
    });
    const flaggedCount = outcomes.filter((o) => o.status === OfflineSyncEventStatus.FLAGGED).length;
    const rejectedCount = outcomes.filter((o) => o.status === OfflineSyncEventStatus.REJECTED).length;
    const body = `${worker?.membership.user.fullLegalName ?? "A worker"}'s offline attendance sync needs review: ${flaggedCount} flagged, ${rejectedCount} rejected.`;

    await this.notifications.notifyMany(
      owners.map((owner) => ({
        organizationId,
        recipientUserId: owner.userId,
        type: rejectedCount > 0 ? NotificationType.OFFLINE_EVENT_REJECTED : NotificationType.SUSPICIOUS_LOCATION_DETECTED,
        title: "Offline attendance needs review",
        body,
      })),
    );
  }
}
