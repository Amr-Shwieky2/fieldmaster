import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../../common/prisma/prisma.service";

/**
 * In-process events behind the real-time channels (WebSocket gateway and
 * SSE stream), besides `notification.created`.
 */

/** Something on the live operations page changed: clients refetch `GET /operations/live`. */
export const OPERATIONS_CHANGED_EVENT = "operations.changed";

/** What changed; informative only (the client refetches the whole snapshot). */
export const OperationsChangeKind = {
  CLOCK_IN: "CLOCK_IN",
  CLOCK_OUT: "CLOCK_OUT",
  REJECTED_ATTEMPT: "REJECTED_ATTEMPT",
  TEMPORARY_POINT: "TEMPORARY_POINT",
  TEMPORARY_SUPERVISOR: "TEMPORARY_SUPERVISOR",
  EMERGENCY: "EMERGENCY",
  OFFLINE_SYNC: "OFFLINE_SYNC",
  SHIFT: "SHIFT",
  ATTENDANCE: "ATTENDANCE",
  LONG_OPEN_ENTRY: "LONG_OPEN_ENTRY",
} as const;
export type OperationsChangeKind = (typeof OperationsChangeKind)[keyof typeof OperationsChangeKind];

/**
 * Operational only: never money, never personal data (the snapshot endpoint
 * has the details). `projectId` / `siteId` say where it happened: a member
 * restricted to some projects receives only the events of their projects, and
 * an event without a place (the Turan rota, ...) only reaches members who are
 * not restricted.
 */
export interface OperationsChangedEvent {
  organizationId: string;
  kind: OperationsChangeKind;
  at: string;
  projectId?: string | null;
  siteId?: string | null;
}

/** A member's sessions (or one session) ended: open WebSocket and SSE connections are closed. */
export const SESSIONS_ENDED_EVENT = "sessions.ended";
export interface SessionsEndedEvent {
  /** Every connection of this membership (suspended, archived, role changed). */
  membershipId?: string;
  /** One session (its refresh-token family) was revoked. */
  sessionId?: string;
}

@Injectable()
export class RealtimeEventsService {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Something on the live operations page changed. With `shiftId` the event
   * carries the shift's project and site (found first, then emitted), so it
   * can be routed to the members who may see them.
   */
  operationsChanged(organizationId: string, kind: OperationsChangeKind, shiftId?: string | null): void {
    const at = new Date().toISOString();
    const emit = (place: { projectId?: string | null; siteId?: string | null }): void => {
      this.eventEmitter.emit(OPERATIONS_CHANGED_EVENT, { organizationId, kind, at, ...place } satisfies OperationsChangedEvent);
    };
    if (!shiftId) return emit({});
    void this.prisma.shift
      .findUnique({ where: { id: shiftId }, select: { projectId: true, siteId: true, site: { select: { projectId: true } } } })
      .then((shift) => emit({ projectId: shift?.projectId ?? shift?.site?.projectId ?? null, siteId: shift?.siteId ?? null }))
      .catch(() => emit({}));
  }

  sessionsEnded(event: SessionsEndedEvent): void {
    this.eventEmitter.emit(SESSIONS_ENDED_EVENT, event satisfies SessionsEndedEvent);
  }
}
