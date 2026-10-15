import { fireEvent, screen } from "@testing-library/react-native";
import ar from "../../i18n/messages";
import type { AccessValue } from "../../lib/access-context";
import { HomeScreen } from "../HomeScreen";
import { expectArabicOnly, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { listTimeEntries: jest.fn(), listShifts: jest.fn(), getEmergencyEligibility: jest.fn(), myTemporarySupervisions: jest.fn() };
const mockAuth: { client: typeof mockClient; logout: jest.Mock; session: { role: string; workerProfileId: string | null } } = {
  client: mockClient,
  logout: jest.fn(),
  session: { role: "WORKER", workerProfileId: "worker-1" },
};
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));

/** A value from GET /auth/me (through the AccessProvider); null: the real stand-in from the session (no provider). */
let mockAccess: Partial<AccessValue> | null = null;
jest.mock("../../lib/access-context", () => {
  const actual = jest.requireActual("../../lib/access-context");
  return { ...actual, useAccess: () => mockAccess ?? actual.useAccess() };
});

const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));
const mockNotifications = { unreadCount: 0, refresh: jest.fn(async () => undefined), report: jest.fn() };
jest.mock("../../lib/notifications-context", () => ({ useNotifications: () => mockNotifications }));
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return { ...actual, useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});

const navigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };

async function renderHome() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await renderInArabic(<HomeScreen navigation={navigation as any} route={{ key: "Home-1", name: "Home", params: undefined }} />);
  // Loaded: the empty shift list is on screen.
  expect(await screen.findByText(ar.home.noShifts)).toBeOnTheScreen();
}

beforeEach(() => {
  mockAccess = null;
  mockAuth.session = { role: "WORKER", workerProfileId: "worker-1" };
  mockClient.listTimeEntries.mockResolvedValue([]);
  mockClient.listShifts.mockResolvedValue([]);
  mockClient.getEmergencyEligibility.mockResolvedValue({ eligible: false, reason: "EMERGENCY_NOT_ELIGIBLE", turanAssignment: null, activeCallout: null });
  mockClient.myTemporarySupervisions.mockResolvedValue([]);
});

describe("HomeScreen: «راتبي» only for a member who clocks in themselves", () => {
  it("hidden for a member without a worker home (GET /auth/me): no salary to open, so no 404", async () => {
    mockAccess = { hasWorkerHome: false, isManager: true };
    await renderHome();
    expect(screen.queryByRole("button", { name: ar.home.salary })).not.toBeOnTheScreen();
    // History stays.
    expect(screen.getByRole("button", { name: ar.home.history })).toBeOnTheScreen();
    expectArabicOnly(["FieldMaster"]);
  });

  it("shown for a member who clocks in themselves (GET /auth/me), and opens the salary", async () => {
    mockAccess = { hasWorkerHome: true, isManager: false };
    await renderHome();
    const salary = screen.getByRole("button", { name: ar.home.salary });
    expect(salary).toHaveStyle({ minHeight: 56 });
    await fireEvent.press(salary);
    expect(navigation.navigate).toHaveBeenCalledWith("Salary");
  });

  it("before GET /auth/me answers, the session decides: an Owner without a worker profile gets no «راتبي»", async () => {
    mockAuth.session = { role: "OWNER", workerProfileId: null };
    await renderHome();
    expect(screen.queryByRole("button", { name: ar.home.salary })).not.toBeOnTheScreen();
  });

  it("before GET /auth/me answers, the session decides: a manager with a worker profile keeps «راتبي»", async () => {
    mockAuth.session = { role: "FIELD_MANAGER", workerProfileId: "manager-profile" };
    await renderHome();
    expect(screen.getByRole("button", { name: ar.home.salary })).toBeOnTheScreen();
  });
});
