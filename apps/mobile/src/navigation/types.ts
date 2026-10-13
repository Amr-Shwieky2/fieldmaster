export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
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
};
