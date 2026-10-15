import { act, render } from "@testing-library/react-native";
import { View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  clearPendingLinkForTests,
  flushPendingLink,
  navigationRef,
  openLinkTarget,
  parseNotificationData,
  resolveAvailableTarget,
  targetForAction,
  targetForInAppNotification,
  targetForNotification,
} from "../linking";

const push = (data: Record<string, unknown>) => targetForNotification(parseNotificationData(data));

describe("deep links from notifications", () => {
  it("opens the screen each push payload is about", () => {
    expect(push({ notificationId: "n1", type: "SHIFT_APPROVED", timeEntryId: "te-1", shiftId: "sh-1" })).toEqual({ name: "HistoryDetail", params: { timeEntryId: "te-1" } });
    expect(push({ notificationId: "n2", type: "SHIFT_REJECTED", timeEntryId: "te-2" })).toEqual({ name: "HistoryDetail", params: { timeEntryId: "te-2" } });
    expect(push({ notificationId: "n3", type: "TURAN_ASSIGNMENT_CREATED", shiftId: "sh-3" })).toEqual({ name: "ShiftDetails", params: { shiftId: "sh-3" } });
    expect(push({ notificationId: "n4", type: "TEMPORARY_CHECK_IN_POINT_OPENED", shiftId: "sh-4" })).toEqual({ name: "ShiftDetails", params: { shiftId: "sh-4" } });
    expect(push({ notificationId: "n5", type: "PAYROLL_FINALIZED", yearMonth: "2026-09" })).toEqual({ name: "Salary", params: { yearMonth: "2026-09" } });
    expect(push({ notificationId: "n6", type: "PAYROLL_FINALIZED" })).toEqual({ name: "Salary", params: {} });
    expect(push({ notificationId: "n7", type: "EMERGENCY_SHIFT_STARTED", calloutId: "co-1" })).toEqual({ name: "Emergency" });
    expect(push({ notificationId: "n8", type: "SOME_FUTURE_TYPE", assignmentId: "as-1" })).toEqual({ name: "Supervisor", params: { assignmentId: "as-1" } });
  });

  it("opens the notifications list by default (unknown type, nothing to open, malformed data)", () => {
    expect(push({ notificationId: "n1", type: "WORKER_APPROVED" })).toEqual({ name: "Notifications" });
    expect(push({ notificationId: "n2", type: "TURAN_ASSIGNMENT_CHANGED", turanAssignmentId: "tu-1" })).toEqual({ name: "Notifications" });
    expect(push({})).toEqual({ name: "Notifications" });
    expect(push({ timeEntryId: 42, yearMonth: "2026-13", shiftId: "  " })).toEqual({ name: "Notifications" });
    expect(targetForNotification(parseNotificationData(null))).toEqual({ name: "Notifications" });
    expect(targetForNotification(parseNotificationData("not an object"))).toEqual({ name: "Notifications" });
  });

  it("never opens a detail screen for a notification about other people (sent to managers)", () => {
    for (const type of ["WORKER_CLOCKED_OUT", "SHIFT_AWAITING_APPROVAL", "OVERTIME_THRESHOLD_CROSSED", "TEMPORARY_SUPERVISOR_ISSUE_REPORTED", "OFFLINE_EVENT_REJECTED"]) {
      expect(push({ type, timeEntryId: "someone-elses", shiftId: "sh-1", assignmentId: "as-1" })).toEqual({ name: "Notifications" });
    }
  });

  it("uses the same mapping for a notification tapped in the app's list", () => {
    expect(targetForInAppNotification({ type: "SHIFT_APPROVED", dataJson: { timeEntryId: "te-1", shiftId: "sh-1", shiftTitle: "صيانة" } })).toEqual({
      name: "HistoryDetail",
      params: { timeEntryId: "te-1" },
    });
    expect(targetForInAppNotification({ type: "PAYROLL_FINALIZED", dataJson: { yearMonth: "2026-08" } })).toEqual({ name: "Salary", params: { yearMonth: "2026-08" } });
    expect(targetForInAppNotification({ type: "SHIFT_APPROVED", dataJson: null })).toEqual({ name: "Notifications" });
    // The type of the in-app item wins over a "type" inside its data.
    expect(targetForInAppNotification({ type: "WORKER_CLOCKED_IN", dataJson: { type: "SHIFT_APPROVED", timeEntryId: "te-9" } })).toEqual({ name: "Notifications" });
  });

  it("falls back to the list when the target's screen is not in this build", () => {
    expect(resolveAvailableTarget({ name: "Emergency" }, ["Home", "Notifications"])).toEqual({ name: "Notifications" });
    expect(resolveAvailableTarget({ name: "Emergency" }, ["Home", "Emergency", "Notifications"])).toEqual({ name: "Emergency" });
    expect(resolveAvailableTarget({ name: "Emergency" }, null)).toEqual({ name: "Emergency" });
  });

  it("a manager's call-out notification opens the live operations, not their own emergency screen", () => {
    const managerRoutes = ["Main", "Emergency", "LiveOperations", "AttendanceReview", "Notifications"];
    expect(resolveAvailableTarget(push({ type: "EMERGENCY_SHIFT_STARTED", calloutId: "co-1" }), managerRoutes)).toEqual({ name: "LiveOperations", params: { focus: "onShift" } });
    // An ended call-out with its subject still opens the entry to approve.
    expect(resolveAvailableTarget(push({ type: "EMERGENCY_SHIFT_ENDED", subjectId: "s-1", timeEntryId: "te-1", calloutId: "co-1" }), managerRoutes)).toEqual({
      name: "AttendanceReview",
      params: { timeEntryId: "te-1", subjectId: "s-1" },
    });
  });
});

describe("a tap that arrives before the screens exist", () => {
  const Stack = createNativeStackNavigator();
  const Screen = () => <View />;

  afterEach(() => clearPendingLinkForTests());

  function App({ signedIn }: { signedIn: boolean }) {
    return (
      <NavigationContainer ref={navigationRef} onReady={flushPendingLink} onStateChange={flushPendingLink}>
        <Stack.Navigator>
          {signedIn ? (
            <>
              <Stack.Screen name="Home" component={Screen} />
              <Stack.Screen name="Notifications" component={Screen} />
              <Stack.Screen name="HistoryDetail" component={Screen} />
            </>
          ) : (
            <Stack.Screen name="Login" component={Screen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  it("waits on the sign-in screen and opens the target once the worker is signed in", async () => {
    const view = await render(<App signedIn={false} />);
    await act(async () => openLinkTarget({ name: "HistoryDetail", params: { timeEntryId: "te-1" } }));
    expect(navigationRef.getCurrentRoute()?.name).toBe("Login");

    await view.rerender(<App signedIn />);
    await act(async () => undefined);
    expect(navigationRef.getCurrentRoute()?.name).toBe("HistoryDetail");
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ timeEntryId: "te-1" });
  });

  it("opens a screen that is not in this build as the notifications list", async () => {
    await render(<App signedIn />);
    await act(async () => openLinkTarget({ name: "Emergency" }));
    expect(navigationRef.getCurrentRoute()?.name).toBe("Notifications");
  });
});

describe("a manager's notifications (mobile manager mode)", () => {
  it("opens the entry's review from a push with its subject and entry", () => {
    for (const type of ["WORKER_CLOCKED_OUT", "SHIFT_AWAITING_APPROVAL", "EMERGENCY_SHIFT_ENDED", "OVERTIME_THRESHOLD_CROSSED"]) {
      expect(push({ notificationId: "n1", type, subjectId: "subj-1", timeEntryId: "te-1", shiftId: "sh-1", calloutId: "co-1" })).toEqual({
        name: "AttendanceReview",
        params: { timeEntryId: "te-1", subjectId: "subj-1" },
      });
    }
  });

  it("opens a temporary supervisor's report from a push with its subject and report", () => {
    expect(push({ notificationId: "n1", type: "TEMPORARY_SUPERVISOR_ISSUE_REPORTED", subjectId: "subj-9", issueId: "iss-1", assignmentId: "as-1", shiftId: "sh-1" })).toEqual({
      name: "SupervisorIssue",
      params: { issueId: "iss-1", subjectId: "subj-9" },
    });
  });

  it("opens the list for a push that would need a worker's id (pushes never carry one) or lacks its subject or record", () => {
    for (const type of ["OFFLINE_EVENT_REJECTED", "SUSPICIOUS_LOCATION_DETECTED", "ONBOARDING_SUBMITTED"]) {
      expect(push({ notificationId: "n1", type, subjectId: "subj-1", workerProfileId: "wp-1", timeEntryId: "te-1" })).toEqual({ name: "Notifications" });
    }
    expect(push({ type: "SHIFT_AWAITING_APPROVAL", subjectId: "subj-1" })).toEqual({ name: "Notifications" });
    expect(push({ type: "SHIFT_AWAITING_APPROVAL", subjectId: "  ", timeEntryId: "te-1" })).toEqual({ name: "Notifications" });
    expect(push({ type: "TEMPORARY_SUPERVISOR_ISSUE_REPORTED", subjectId: "subj-1", assignmentId: "as-1" })).toEqual({ name: "Notifications" });
    // Information only (no subject): as before.
    expect(push({ type: "WORKER_CLOCKED_IN", timeEntryId: "te-1" })).toEqual({ name: "Notifications" });
    expect(push({ type: "EMERGENCY_SHIFT_ENDED", timeEntryId: "te-1", calloutId: "co-1" })).toEqual({ name: "Emergency" });
  });

  it("opens the supervision screen of a supervisor whose report was resolved, else the list", () => {
    expect(push({ notificationId: "n1", type: "TEMPORARY_SUPERVISOR_ISSUE_RESOLVED", issueId: "iss-1", assignmentId: "as-1", shiftId: "sh-1" })).toEqual({
      name: "Supervisor",
      params: { assignmentId: "as-1" },
    });
    expect(push({ notificationId: "n1", type: "TEMPORARY_SUPERVISOR_ISSUE_RESOLVED", issueId: "iss-1", shiftId: "sh-1" })).toEqual({ name: "Notifications" });
  });

  it("opens an in-app row's action screen from its action, which carries every id it needs", () => {
    const row = (action: object | null, subjectId: string | null = "subj-1") => targetForInAppNotification({ type: "SHIFT_AWAITING_APPROVAL", dataJson: { timeEntryId: "te-data" }, subjectId, action: action as never });
    expect(row({ kind: "REVIEW_ATTENDANCE", timeEntryId: "te-1" })).toEqual({ name: "AttendanceReview", params: { timeEntryId: "te-1", subjectId: "subj-1" } });
    expect(row({ kind: "OPEN_ENTRY", timeEntryId: "te-2" })).toEqual({ name: "AttendanceReview", params: { timeEntryId: "te-2", subjectId: "subj-1" } });
    expect(row({ kind: "REVIEW_OFFLINE", workerProfileId: "wp-1" })).toEqual({ name: "OfflineReview", params: { workerProfileId: "wp-1", subjectId: "subj-1" } });
    expect(row({ kind: "REVIEW_ONBOARDING", workerProfileId: "wp-2" })).toEqual({ name: "OnboardingReview", params: { workerProfileId: "wp-2", subjectId: "subj-1" } });
    expect(row({ kind: "RESOLVE_SUPERVISOR_ISSUE", issueId: "iss-1" })).toEqual({ name: "SupervisorIssue", params: { issueId: "iss-1", subjectId: "subj-1" } });
    // Without a subject, the screen opens without one.
    expect(row({ kind: "REVIEW_OFFLINE", workerProfileId: "wp-1" }, null)).toEqual({ name: "OfflineReview", params: { workerProfileId: "wp-1" } });
    // An action without its id, or information only: today's rules (a manager's notification opens the list).
    expect(row({ kind: "REVIEW_OFFLINE" })).toEqual({ name: "Notifications" });
    expect(row(null)).toEqual({ name: "Notifications" });
    expect(targetForInAppNotification({ type: "WORKER_CLOCKED_OUT", dataJson: { subjectId: "subj-1", timeEntryId: "te-1" }, subjectId: null, action: null })).toEqual({
      name: "Notifications",
    });
  });

  it("the offline review is opened with the worker's name from the in-app notification (a push has no names)", () => {
    expect(
      targetForInAppNotification({
        type: "OFFLINE_EVENT_REJECTED",
        dataJson: { workerProfileId: "wp-1", workerName: " ليلى ناصر ", rejectedCount: 1 },
        subjectId: "subj-1",
        action: { kind: "REVIEW_OFFLINE", workerProfileId: "wp-1" } as never,
      }),
    ).toEqual({ name: "OfflineReview", params: { workerProfileId: "wp-1", subjectId: "subj-1", workerName: "ليلى ناصر" } });
  });

  it("maps every action kind, and nothing for a kind this version does not know", () => {
    expect(targetForAction({ kind: "RESOLVE_SUPERVISOR_ISSUE", issueId: "iss-1" }, "subj-1")).toEqual({ name: "SupervisorIssue", params: { issueId: "iss-1", subjectId: "subj-1" } });
    expect(targetForAction({ kind: "REVIEW_ATTENDANCE", timeEntryId: "" }, "subj-1")).toBeNull();
    expect(targetForAction({ kind: "SOMETHING_NEW" } as never, "subj-1")).toBeNull();
  });

  it("falls back to the list for a worker, whose app has no manager screens", () => {
    const workerRoutes = ["Home", "Notifications", "HistoryDetail", "Supervisor"];
    expect(resolveAvailableTarget({ name: "AttendanceReview", params: { timeEntryId: "te-1", subjectId: "s" } }, workerRoutes)).toEqual({ name: "Notifications" });
    expect(resolveAvailableTarget({ name: "SupervisorIssue", params: { issueId: "iss-1" } }, workerRoutes)).toEqual({ name: "Notifications" });
  });
});

describe("a tap for a member who manages (the manager tabs at the root)", () => {
  const Stack = createNativeStackNavigator();
  const Tab = createBottomTabNavigator();
  const Screen = () => <View />;

  afterEach(() => clearPendingLinkForTests());

  function Tabs() {
    return (
      <Tab.Navigator screenOptions={{ headerShown: false }}>
        <Tab.Screen name="ManageTab" component={Screen} />
        <Tab.Screen name="NotificationsTab" component={Screen} />
      </Tab.Navigator>
    );
  }

  function ManagerApp() {
    return (
      <NavigationContainer ref={navigationRef} onReady={flushPendingLink} onStateChange={flushPendingLink}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={Tabs} />
          <Stack.Screen name="Notifications" component={Screen} />
          <Stack.Screen name="AttendanceReview" component={Screen} />
          <Stack.Screen name="SupervisorIssue" component={Screen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  it("opens the action screen of a push that started the app", async () => {
    await act(async () => openLinkTarget({ name: "AttendanceReview", params: { timeEntryId: "te-1", subjectId: "subj-1" } }));
    await render(<ManagerApp />);
    await act(async () => undefined);
    expect(navigationRef.getCurrentRoute()?.name).toBe("AttendanceReview");
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ timeEntryId: "te-1", subjectId: "subj-1" });
  });

  it("opens the list as the notifications tab from the manager home (not a second list on top)", async () => {
    await render(<ManagerApp />);
    expect(navigationRef.getCurrentRoute()?.name).toBe("ManageTab");
    await act(async () => openLinkTarget({ name: "Notifications" }));
    expect(navigationRef.getCurrentRoute()?.name).toBe("NotificationsTab");
    expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(["Main"]);
  });

  it("deeper in the stack, opens the list on top and keeps the screen below it", async () => {
    await render(<ManagerApp />);
    await act(async () => openLinkTarget({ name: "SupervisorIssue", params: { issueId: "iss-1", subjectId: "subj-9" } }));
    expect(navigationRef.getCurrentRoute()?.name).toBe("SupervisorIssue");

    await act(async () => openLinkTarget({ name: "Notifications" }));
    expect(navigationRef.getCurrentRoute()?.name).toBe("Notifications");
    expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(["Main", "SupervisorIssue", "Notifications"]);
  });
});
