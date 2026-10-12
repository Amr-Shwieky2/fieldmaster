import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

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

/** Operational only: never money, never personal data (the snapshot endpoint has the details). */
export interface OperationsChangedEvent {
  organizationId: string;
  kind: OperationsChangeKind;
  at: string;
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
  constructor(private readonly eventEmitter: EventEmitter2) {}

  operationsChanged(organizationId: string, kind: OperationsChangeKind): void {
    this.eventEmitter.emit(OPERATIONS_CHANGED_EVENT, { organizationId, kind, at: new Date().toISOString() } satisfies OperationsChangedEvent);
  }

  sessionsEnded(event: SessionsEndedEvent): void {
    this.eventEmitter.emit(SESSIONS_ENDED_EVENT, event satisfies SessionsEndedEvent);
  }
}
