import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import { isolateAuto, isolateLtr } from "../../components/LtrText";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { OnboardingRequestsScreen } from "../OnboardingRequestsScreen";
import { deferred, expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { listPendingApproval: jest.fn() };
const mockAuth = { client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

// Outside a navigator, "focus" is the first render; refocus() replays the screen's focus callback
// (the manager comes back from a review).
let mockFocusEffect: (() => void) | null = null;
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return {
    ...actual,
    useFocusEffect: (effect: () => void) => {
      mockFocusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});

type Navigation = NativeStackScreenProps<RootStackParamList, "OnboardingRequests">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

type Pending = Awaited<ReturnType<typeof mockClient.listPendingApproval>>;

const SAMER = { membershipId: "m-1", workerProfileId: "wp-1", fullLegalName: "سامر خليل", phoneNumber: "+972501234567", submittedAt: "2026-10-14T07:30:00.000Z" };
const RAMI = { membershipId: "m-2", workerProfileId: "wp-2", fullLegalName: "رامي داود", phoneNumber: "+972521112233", submittedAt: "2026-10-15T09:05:00.000Z" };

function renderScreen() {
  return renderInArabic(<OnboardingRequestsScreen navigation={navigation as unknown as Navigation} route={{ key: "OnboardingRequests-1", name: "OnboardingRequests", params: undefined }} />);
}

async function refocus() {
  await act(async () => {
    mockFocusEffect?.();
  });
}

beforeEach(() => {
  mockClient.listPendingApproval.mockReset();
  mockClient.listPendingApproval.mockResolvedValue([SAMER, RAMI]);
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockFocusEffect = null;
});

describe("OnboardingRequestsScreen (Arabic, RTL)", () => {
  it("shows the loading state, then each applicant with their phone and when they applied, and opens one", async () => {
    const list = deferred<Pending>();
    mockClient.listPendingApproval.mockReturnValue(list.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.onboardingRequests.title })).toBeOnTheScreen();
    await act(async () => list.resolve([SAMER, RAMI]));

    const [first, second] = screen.getAllByTestId("onboarding-request");
    expect(within(first).getByText(isolateAuto("سامر خليل"))).toBeOnTheScreen();
    expect(within(first).getByText(isolateLtr("+972501234567"))).toBeOnTheScreen();
    // Asia/Jerusalem (summer time until the end of October).
    expect(within(first).getByText(fill(ar.onboardingRequests.submittedAt, { dateTime: "14 أكتوبر 2026 في 10:30" }))).toBeOnTheScreen();
    expect(within(second).getByText(isolateAuto("رامي داود"))).toBeOnTheScreen();
    expect(within(second).getByText(fill(ar.onboardingRequests.submittedAt, { dateTime: "15 أكتوبر 2026 في 12:05" }))).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.onboardingRequests.count, { count: "2" }))).toBeOnTheScreen();
    expect(mockClient.listPendingApproval).toHaveBeenCalledWith();
    expectArabicOnly();

    await fireEvent.press(first);
    expect(navigation.navigate).toHaveBeenCalledWith("OnboardingReview", { workerProfileId: "wp-1" });
  });

  it("each applicant is one large button that says it opens the application", async () => {
    await renderScreen();
    const rows = await screen.findAllByRole("button", { name: /سامر خليل|رامي داود/ });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveProp("accessibilityHint", ar.onboardingRequests.openHint);
      expect(row).toHaveStyle({ minHeight: 56 });
    }
  });

  it("shows the empty state when nothing is waiting", async () => {
    mockClient.listPendingApproval.mockResolvedValue([]);
    await renderScreen();
    expect(await screen.findByText(ar.onboardingRequests.empty)).toBeOnTheScreen();
    expect(screen.getByText(ar.onboardingRequests.emptyHint)).toBeOnTheScreen();
    expect(screen.queryByTestId("onboarding-request")).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the API's refusal in Arabic (never its English message), and retries", async () => {
    mockClient.listPendingApproval.mockRejectedValueOnce(new ApiRequestError(403, { statusCode: 403, code: "FORBIDDEN", message: "Missing permission", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(`${ar.onboardingRequests.loadError}\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expect(screen.queryByText(/Missing permission/)).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(isolateAuto("سامر خليل"))).toBeOnTheScreen();
    expect(mockClient.listPendingApproval).toHaveBeenCalledTimes(2);
  });

  it("offline: the connection banner and the Arabic network error", async () => {
    mockSync.isOnline = false;
    mockClient.listPendingApproval.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.onboardingRequests.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("reads the list again when the screen comes back into view: a decided application is gone", async () => {
    await renderScreen();
    expect(await screen.findAllByTestId("onboarding-request")).toHaveLength(2);

    mockClient.listPendingApproval.mockResolvedValue([RAMI]);
    await refocus();
    expect(mockClient.listPendingApproval).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("onboarding-request")).toHaveLength(1);
    expect(screen.queryByText(isolateAuto("سامر خليل"))).not.toBeOnTheScreen();
    expect(screen.getByText(fill(ar.onboardingRequests.count, { count: "1" }))).toBeOnTheScreen();
  });

  it("goes back from the header", async () => {
    await renderScreen();
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
