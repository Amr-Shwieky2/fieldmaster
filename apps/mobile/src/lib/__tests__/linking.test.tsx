import { act, render } from "@testing-library/react-native";
import { View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  clearPendingLinkForTests,
  flushPendingLink,
  navigationRef,
  openLinkTarget,
  parseNotificationData,
  resolveAvailableTarget,
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
