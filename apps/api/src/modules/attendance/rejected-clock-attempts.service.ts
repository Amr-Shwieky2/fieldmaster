import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ClockEventType, EventOrigin } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { generateId } from "../../common/ids";
import { OperationsChangeKind, RealtimeEventsService } from "../notifications/realtime-events";

export interface RejectedClockAttemptInput {
  organizationId: string;
  workerProfileId: string;
  shiftId: string;
  /** Set for a refused clock-out (the open entry it was meant to close); a refused clock-in has no entry yet. */
  timeEntryId: string | null;
  eventType: ClockEventType;
  origin: EventOrigin;
  /** The error code the worker received. */
  code: string;
  deviceTimestamp: Date;
  deviationSeconds: number | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  mockLocationSuspected: boolean;
  distanceMeters?: number | null;
  allowedRadiusMeters?: number | null;
  requiredAccuracyMeters?: number | null;
  /** Only when the point was loaded and belongs to the shift (it is a foreign key). */
  temporaryCheckInPointId?: string | null;
}

/**
 * Evidence of clock events the server refused for the phone's location or
 * clock (spec 19 / Step 5 detail page): the worker still gets exactly the
 * same error, and managers see the attempt, with its distance, on the
 * attendance map.
 */
@Injectable()
export class RejectedClockAttemptsService {
  private readonly logger = new Logger(RejectedClockAttemptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /**
   * Stores the attempt. Never throws: the worker's request is already being
   * refused, and a failure to store the evidence must not change that answer.
   */
  async record(input: RejectedClockAttemptInput): Promise<void> {
    try {
      await this.prisma.rejectedClockAttempt.create({
        data: {
          id: generateId(),
          organizationId: input.organizationId,
          workerProfileId: input.workerProfileId,
          shiftId: input.shiftId,
          timeEntryId: input.timeEntryId,
          eventType: input.eventType,
          origin: input.origin,
          code: input.code,
          deviceTimestamp: input.deviceTimestamp,
          deviationSeconds: input.deviationSeconds,
          latitude: input.latitude,
          longitude: input.longitude,
          accuracyMeters: input.accuracyMeters,
          mockLocationSuspected: input.mockLocationSuspected,
          distanceMeters: input.distanceMeters ?? null,
          allowedRadiusMeters: input.allowedRadiusMeters ?? null,
          requiredAccuracyMeters: input.requiredAccuracyMeters ?? null,
          temporaryCheckInPointId: input.temporaryCheckInPointId ?? null,
        },
      });
      // The live operations page lists recent rejected attempts.
      this.realtime.operationsChanged(input.organizationId, OperationsChangeKind.REJECTED_ATTEMPT);
    } catch (error) {
      this.logger.warn(`Could not store a rejected ${input.eventType} attempt (${input.code}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Links the worker's earlier refused attempts at this shift to the time
   * entry that was just opened for it (online, offline or by a manager's
   * missing-clock-in correction), so the entry's map and flags show them.
   */
  async linkToNewEntry(tx: Prisma.TransactionClient, entry: { id: string; workerProfileId: string; shiftId: string }): Promise<void> {
    await tx.rejectedClockAttempt.updateMany({
      where: { workerProfileId: entry.workerProfileId, shiftId: entry.shiftId, timeEntryId: null },
      data: { timeEntryId: entry.id },
    });
  }
}
