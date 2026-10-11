import type {
  ClockInResult,
  EmergencyCalloutEndResult,
  EmergencyCalloutStartResult,
  OfflineSyncBatchResponse,
  TemporaryCheckInPoint,
  TimeEntry,
} from "@fieldmaster/api-client";
import type { TaskCategory } from "@fieldmaster/shared-types";
import type { QueuedOfflineEvent } from "@/lib/worker-simulator/offline";

export type SimulatorAction =
  | "signIn"
  | "signOut"
  | "clockIn"
  | "clockOut"
  | "emergencyStart"
  | "emergencyEnd"
  | "tempPoint"
  | "rewind"
  | "approve"
  | "sync"
  | "resend"
  | "prepare";

/** What the last action returned, kept so the result panel can show the mobile receipt and the raw response. */
export type SimulatorResult =
  | { kind: "clockIn"; body: ClockInResult; shiftTitle: string | null }
  | { kind: "clockInQueued"; event: QueuedOfflineEvent; shiftTitle: string | null }
  | { kind: "clockOut"; body: TimeEntry }
  | { kind: "clockOutQueued"; event: QueuedOfflineEvent }
  | { kind: "emergencyStart"; body: EmergencyCalloutStartResult }
  | { kind: "emergencyEnd"; body: EmergencyCalloutEndResult; actualStart: string | null; compensatedStart: string | null }
  | { kind: "tempPoint"; body: TemporaryCheckInPoint }
  | { kind: "rewind"; body: TimeEntry }
  | { kind: "approve"; body: TimeEntry }
  | { kind: "sync"; body: OfflineSyncBatchResponse; resend: boolean }
  | { kind: "error"; action: SimulatorAction; error: unknown };

export interface SessionLogEntry {
  id: number;
  at: string;
  action: SimulatorAction;
  params?: Record<string, string>;
  outcome: "success" | "error" | "queued";
  message?: string;
}

export interface SummaryForm {
  text: string;
  category: TaskCategory;
  materials: string;
  problems: string;
  followUp: boolean;
}

export const SCENARIO_IDS = [
  "insideGeofence",
  "outsideGeofence",
  "poorAccuracy",
  "clockAhead",
  "mockLocation",
  "flexiCheck",
  "emptySummary",
  "nineHours",
  "tenHoursThirty",
  "nightTuranEmergency",
  "notEligibleEmergency",
  "temporaryPoint",
  "offlineClockIn",
  "duplicateBatch",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

/** Scenarios whose setup is a matter of choosing the right worker / pressing the buttons, so there is nothing to prepare. */
export const SCENARIOS_WITHOUT_PREPARE = new Set<ScenarioId>(["duplicateBatch"]);

/** The rewind targets offered next to "إنهاء الدوام": 6 h, 9 h and 10 h 30 m. */
export const REWIND_TARGET_MINUTES = [360, 540, 630] as const;
