import type { NavigatorScreenParams } from "@react-navigation/native";

/**
 * The tabs of a member who manages (mobile manager mode): «الإدارة», then
 * «دوامي» only for a member who clocks in themselves, then «الإشعارات».
 */
export type ManagerTabParamList = {
  ManageTab: undefined;
  MyWorkTab: undefined;
  NotificationsTab: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  /** A worker's home («دوامي»): the root screen of a member without manager permissions. */
  Home: undefined;
  /** The manager tabs: the root screen of a member with manager permissions. */
  Main: NavigatorScreenParams<ManagerTabParamList> | undefined;
  ClockIn: { shiftId: string; shiftTitle: string };
  /** `shiftTitle`: the shift being ended, shown on the form and the receipt. */
  ClockOut: { shiftTitle?: string } | undefined;
  // Work flow screens (Step 9).
  ShiftDetails: { shiftId: string };
  Emergency: undefined;
  History: undefined;
  OfflineQueue: undefined;
  // Platform / account screens (Step 9).
  HistoryDetail: { timeEntryId: string };
  /** `yearMonth` (YYYY-MM) scrolls to that month, e.g. from a "payroll finalized" notification. */
  Salary: { yearMonth?: string } | undefined;
  Notifications: undefined;
  NotificationPreferences: undefined;
  Supervisor: { assignmentId: string };
  /** The only screen mounted while the account is pending approval, rejected or suspended, or the device key was revoked. */
  AccountState: undefined;
  // Manager screens (mobile manager mode). `subjectId`: the notification subject the screen settles, when opened from one.
  /** Entries waiting for approval (APPROVE_ATTENDANCE). */
  Approvals: undefined;
  /** One entry: evidence and the decisions (approve, reject, full-day credit, request a correction, correct). */
  AttendanceReview: { timeEntryId: string; subjectId?: string };
  /** The live map and lists (VIEW_OPERATIONS): who is on shift, who is late, the site alerts. */
  LiveOperations: { focus?: "onShift" | "late" | "alerts" } | undefined;
  /** The work locations to open one for editing, or to add one (MANAGE_SITES). */
  WorkLocations: undefined;
  /** Create (no `siteId`) or edit a work location (MANAGE_SITES). */
  WorkLocationEditor: { siteId?: string } | undefined;
  /** A new shift with its workers (MANAGE_SHIFTS). */
  NewShift: undefined;
  /** Join applications waiting for a decision (APPROVE_ONBOARDING). */
  OnboardingRequests: undefined;
  OnboardingReview: { workerProfileId: string; subjectId?: string };
  SupervisorIssue: { issueId: string; subjectId?: string };
  /** A worker's offline records that were refused or flagged. `workerName`: from the in-app notification (a push carries no names). */
  OfflineReview: { workerProfileId: string; subjectId?: string; workerName?: string };
};
