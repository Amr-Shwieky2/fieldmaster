import { AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, type NotificationSubject, type OnboardingReview, type OnboardingSummary } from "@fieldmaster/api-client";
import { isolateAuto, isolateLtr } from "../../components/LtrText";
import { parseShekelsToAgorot } from "../../components/onboarding/shekels";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { OnboardingReviewScreen } from "../OnboardingReviewScreen";
import { deferred, doubleTap, expectArabicOnly, fill, freezeDate, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

const mockClient = {
  getOnboardingSummary: jest.fn(),
  getOnboardingReview: jest.fn(),
  getFileAssetViewUrl: jest.fn(),
  approveWorker: jest.fn(),
  rejectWorker: jest.fn(),
  getNotificationSubject: jest.fn(),
};
const mockAuth = { client: mockClient, session: { role: "OWNER", workerProfileId: null } };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

// Outside a navigator, "focus" is the first render. blur() runs the cleanup the screen's focus
// callback returns, as React Navigation does when another screen covers it or it is left.
let mockFocusEffect: (() => unknown) | null = null;
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return {
    ...actual,
    useFocusEffect: (effect: () => unknown) => {
      mockFocusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});

type Navigation = NativeStackScreenProps<RootStackParamList, "OnboardingReview">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

const OWNER_SUMMARY: OnboardingSummary = {
  workerProfileId: "wp-1",
  membershipStatus: "PENDING_APPROVAL",
  fullLegalName: "سامر خليل",
  preferredName: "سامر",
  phoneNumber: "+972501234567",
  submittedAt: "2026-10-14T07:30:00.000Z",
  governmentIdType: "ISRAELI_ID",
  hasIdentityDocument: true,
  hasProfilePhoto: false,
  bankAccount: { bankName: "بنك لئومي", branchNumber: "123", accountNumberLast4: "4321" },
  canRevealDetails: true,
  canApprove: true,
  canReject: true,
};

/** APPROVE_ONBOARDING only: no bank details, no money permission. */
const FIELD_MANAGER_SUMMARY: OnboardingSummary = { ...OWNER_SUMMARY, bankAccount: null, canRevealDetails: false, canApprove: false, canReject: true };

const REVIEW: OnboardingReview = {
  workerProfileId: "wp-1",
  membershipStatus: "PENDING_APPROVAL",
  fullLegalName: "سامر خليل",
  preferredName: "سامر",
  phoneNumber: "+972501234567",
  submittedAt: "2026-10-14T07:30:00.000Z",
  governmentIdType: "ISRAELI_ID",
  governmentIdNumber: "123456782",
  bankAccount: { bankName: "بنك لئومي", branchNumber: "123", accountNumber: "9876544321", accountHolderName: "سامر خليل" },
  consentAcceptedAt: "2026-10-14T07:29:00.000Z",
  privacyNoticeVersion: "2026-08",
  identityDocument: { fileAssetId: "file-id-1", contentType: "image/jpeg", sizeBytes: 120_000 },
  profilePhoto: null,
};

const VIEW_URL = { url: "https://files.example/id.jpg?sig=abc", expiresInSeconds: 60, contentType: "image/jpeg" };

const HANDLED_APPROVED: NotificationSubject = {
  id: "subject-1",
  kind: "ONBOARDING",
  handled: { at: "2026-10-15T09:30:00.000Z", by: { userId: "user-2", fullLegalName: "ليلى حداد" }, outcome: "WORKER_APPROVED", note: null },
};

const r = ar.onboardingReview;

function renderScreen(params: { subjectId?: string } = {}) {
  return renderInArabic(
    <OnboardingReviewScreen
      navigation={navigation as unknown as Navigation}
      route={{ key: "OnboardingReview-1", name: "OnboardingReview", params: { workerProfileId: "wp-1", ...params } }}
    />,
  );
}

async function blur() {
  await act(async () => {
    const cleanup = mockFocusEffect?.();
    if (typeof cleanup === "function") cleanup();
  });
}

const apiError = (status: number, code: string, message = "English message") => new ApiRequestError(status, { statusCode: status, code, message, correlationId: "c" });

beforeEach(() => {
  for (const fn of Object.values(mockClient)) fn.mockReset();
  mockClient.getOnboardingSummary.mockResolvedValue(OWNER_SUMMARY);
  mockClient.getOnboardingReview.mockResolvedValue(REVIEW);
  mockClient.getFileAssetViewUrl.mockResolvedValue(VIEW_URL);
  mockClient.approveWorker.mockResolvedValue({ workerProfileId: "wp-1" });
  mockClient.rejectWorker.mockResolvedValue({ workerProfileId: "wp-1", status: "REJECTED" });
  mockClient.getNotificationSubject.mockResolvedValue({ id: "subject-1", kind: "ONBOARDING", handled: null });
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockFocusEffect = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("OnboardingReviewScreen as an Owner (Arabic, RTL)", () => {
  it("shows the application without any sensitive value: the bank account masked to its last four digits", async () => {
    const summary = deferred<OnboardingSummary>();
    mockClient.getOnboardingSummary.mockReturnValue(summary.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    await act(async () => summary.resolve(OWNER_SUMMARY));

    expect(screen.getByRole("header", { name: r.title })).toBeOnTheScreen();
    expect(screen.getAllByText(isolateAuto("سامر خليل")).length).toBeGreaterThan(0);
    expect(screen.getByText(isolateAuto("سامر"))).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.AccountStatus.PENDING_APPROVAL)).toBeOnTheScreen();
    expect(within(screen.getByTestId("onboarding-phone")).getByText(isolateLtr("+972501234567"))).toBeOnTheScreen();
    expect(screen.getByText("14 أكتوبر 2026 في 10:30")).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.GovernmentIdType.ISRAELI_ID)).toBeOnTheScreen();
    expect(within(screen.getByTestId("onboarding-id-document")).getByText(r.uploaded)).toBeOnTheScreen();
    expect(within(screen.getByTestId("onboarding-photo")).getByText(r.notUploaded)).toBeOnTheScreen();

    const bank = within(screen.getByTestId("onboarding-bank"));
    expect(bank.getByText(isolateAuto("بنك لئومي"))).toBeOnTheScreen();
    expect(bank.getByText(isolateLtr("123"))).toBeOnTheScreen();
    expect(bank.getByText(isolateLtr("•••• 4321"))).toBeOnTheScreen();
    expect(fill(r.accountMasked, { last4: "4321" })).toBe("•••• 4321");

    // Nothing sensitive is read before a press.
    expect(mockClient.getOnboardingSummary).toHaveBeenCalledWith("wp-1");
    expect(mockClient.getOnboardingReview).not.toHaveBeenCalled();
    expect(mockClient.getFileAssetViewUrl).not.toHaveBeenCalled();
    expect(mockClient.getNotificationSubject).not.toHaveBeenCalled();
    expect(screen.queryByText(/9876544321|123456782/)).not.toBeOnTheScreen();
    expect(screen.getByText(r.auditNote)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("reveals the full details only on a press (one audited read), then the ID image only on another, without any cache", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reveal }));

    expect(mockClient.getOnboardingReview).toHaveBeenCalledTimes(1);
    expect(mockClient.getOnboardingReview).toHaveBeenCalledWith("wp-1");
    const details = within(await screen.findByTestId("onboarding-full-details"));
    expect(within(screen.getByTestId("onboarding-id-number")).getByText(isolateLtr("123456782"))).toBeOnTheScreen();
    expect(within(screen.getByTestId("onboarding-account-number")).getByText(isolateLtr("9876544321"))).toBeOnTheScreen();
    expect(details.getByText(isolateAuto("سامر خليل"))).toBeOnTheScreen();
    expect(mockClient.getFileAssetViewUrl).not.toHaveBeenCalled();
    expect(screen.queryByTestId("id-document-image")).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(details.getByRole("button", { name: r.showIdImage }));
    expect(mockClient.getFileAssetViewUrl).toHaveBeenCalledTimes(1);
    expect(mockClient.getFileAssetViewUrl).toHaveBeenCalledWith("file-id-1");
    const image = await screen.findByTestId("id-document-image");
    expect(image.props.cachePolicy).toBe("none");
    expect(image.props.source).toEqual({ uri: VIEW_URL.url });
    expect(image.props.accessibilityLabel).toBe(r.idImageLabel);
    // The review was read once: the image used its file id.
    expect(mockClient.getOnboardingReview).toHaveBeenCalledTimes(1);

    // Nothing is stored on the phone.
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("a fast double press reads the full details once", async () => {
    const answer = deferred<OnboardingReview>();
    mockClient.getOnboardingReview.mockReturnValue(answer.promise);
    await renderScreen();
    await doubleTap(await screen.findByRole("button", { name: r.reveal }));
    expect(mockClient.getOnboardingReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: r.revealing })).toBeBusy();
    await act(async () => answer.resolve(REVIEW));
    expect(await screen.findByTestId("onboarding-full-details")).toBeOnTheScreen();
  });

  it("forgets the details and the image when the screen loses focus, and when «إخفاء البيانات» is pressed", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reveal }));
    await fireEvent.press(await screen.findByRole("button", { name: r.showIdImage }));
    expect(await screen.findByTestId("id-document-image")).toBeOnTheScreen();

    await blur();
    expect(screen.queryByTestId("onboarding-full-details")).not.toBeOnTheScreen();
    expect(screen.queryByTestId("id-document-image")).not.toBeOnTheScreen();
    expect(screen.queryByText(isolateLtr("123456782"))).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: r.reveal })).toBeEnabled();

    // Seeing them again is a new (audited) read.
    await fireEvent.press(screen.getByRole("button", { name: r.reveal }));
    expect(await screen.findByTestId("onboarding-full-details")).toBeOnTheScreen();
    expect(mockClient.getOnboardingReview).toHaveBeenCalledTimes(2);

    await fireEvent.press(screen.getByRole("button", { name: r.hide }));
    expect(screen.queryByTestId("onboarding-full-details")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: r.reveal })).toBeOnTheScreen();
  });

  it("forgets the details and the image when the app leaves the foreground (the app switcher keeps a picture of the screen)", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reveal }));
    await fireEvent.press(await screen.findByRole("button", { name: r.showIdImage }));
    expect(await screen.findByTestId("id-document-image")).toBeOnTheScreen();

    const calls = jest.mocked(AppState.addEventListener).mock.calls;
    const onAppState = calls[calls.length - 1][1] as (state: string) => void;
    await act(async () => onAppState("inactive"));
    expect(screen.queryByTestId("onboarding-full-details")).not.toBeOnTheScreen();
    expect(screen.queryByTestId("id-document-image")).not.toBeOnTheScreen();
    expect(screen.queryByText(isolateLtr("123456782"))).not.toBeOnTheScreen();
    // Back in the app: they stay hidden until asked for again.
    await act(async () => onAppState("active"));
    expect(screen.getByRole("button", { name: r.reveal })).toBeEnabled();
    expect(mockClient.getOnboardingReview).toHaveBeenCalledTimes(1);
  });

  it("drops an answer that arrives after the screen lost focus", async () => {
    const answer = deferred<OnboardingReview>();
    mockClient.getOnboardingReview.mockReturnValue(answer.promise);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reveal }));
    await blur();
    await act(async () => answer.resolve(REVIEW));
    expect(screen.queryByTestId("onboarding-full-details")).not.toBeOnTheScreen();
    expect(screen.queryByText(isolateLtr("123456782"))).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: r.reveal })).toBeEnabled();
  });

  it("asks for a new link when the image's short-lived link no longer works", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reveal }));
    await fireEvent.press(await screen.findByRole("button", { name: r.showIdImage }));
    await fireEvent(await screen.findByTestId("id-document-image"), "error");

    expect(screen.getByText(r.idImageExpired)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: r.reloadIdImage }));
    expect(await screen.findByTestId("id-document-image")).toBeOnTheScreen();
    expect(mockClient.getFileAssetViewUrl).toHaveBeenCalledTimes(2);
    expectArabicOnly();
  });

  it("explains a refused image or details read in Arabic", async () => {
    mockClient.getFileAssetViewUrl.mockRejectedValue(apiError(403, "FORBIDDEN", "Owner only"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reveal }));
    await fireEvent.press(await screen.findByRole("button", { name: r.showIdImage }));
    expect(await screen.findByText(`${r.idImageFailed}\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expect(screen.queryByText(/Owner only/)).not.toBeOnTheScreen();

    await blur();
    mockClient.getOnboardingReview.mockRejectedValue(apiError(403, "FORBIDDEN", "Owner only"));
    await fireEvent.press(screen.getByRole("button", { name: r.reveal }));
    expect(await screen.findByText(`${r.revealFailed}\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("never opens an ID document that is a PDF on the phone", async () => {
    mockClient.getOnboardingReview.mockResolvedValue({ ...REVIEW, identityDocument: { fileAssetId: "file-pdf", contentType: "application/pdf", sizeBytes: 10 } });
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reveal }));
    expect(await screen.findByText(r.idDocumentPdf)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.showIdImage })).not.toBeOnTheScreen();
    expect(mockClient.getFileAssetViewUrl).not.toHaveBeenCalled();
    expectArabicOnly(["PDF"]);
  });

  it("approves with the compensation typed in shekels and sent as integer agorot, effective today, then confirms and goes back", async () => {
    freezeDate("2026-10-15T09:00:00.000Z");
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.approve }));

    const form = within(screen.getByTestId("approve-form"));
    expect(form.getByRole("radio", { name: ar.enums.CompensationType.DAILY })).toBeChecked();
    expect(form.getByText(r.ratesHint)).toBeOnTheScreen();
    // The amounts (₪) exist only in this form, which only a member who may approve gets.
    expect(form.getByText(r.dailyRate)).toHaveTextContent(/₪/);
    expect(renderedStrings().join("\n")).toContain("₪");
    expect(screen.getByTestId("approve-effective-date")).toHaveTextContent("15 أكتوبر 2026");
    expectArabicOnly();

    await fireEvent.changeText(screen.getByLabelText(r.dailyRate), "400");
    await fireEvent.changeText(screen.getByLabelText(r.overtimeRate), "45.50");
    await fireEvent.press(screen.getByRole("button", { name: r.confirmApprove }));

    expect(mockClient.approveWorker).toHaveBeenCalledTimes(1);
    expect(mockClient.approveWorker).toHaveBeenCalledWith("wp-1", {
      compensationType: "DAILY",
      dailyBaseRateAgorot: 40_000,
      overtimeHourlyRateAgorot: 4_550,
      effectiveStartDate: "2026-10-15",
      changeReason: r.changeReason,
    });
    expect(await screen.findByText(r.approved)).toBeOnTheScreen();
    expect(mockClient.rejectWorker).not.toHaveBeenCalled();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: r.backToList }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("approves an hourly worker from another date chosen in the date picker", async () => {
    freezeDate("2026-10-15T09:00:00.000Z");
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.approve }));
    await fireEvent.press(screen.getByRole("radio", { name: ar.enums.CompensationType.HOURLY }));
    expect(screen.queryByLabelText(r.dailyRate)).not.toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(r.hourlyRate), "52.5");
    await fireEvent.changeText(screen.getByLabelText(r.overtimeRate), "65");

    await fireEvent.press(screen.getByRole("button", { name: r.changeDate }));
    await fireEvent(screen.getByTestId("approve-date-picker"), "change", { nativeEvent: { timestamp: new Date(2026, 9, 20, 12).getTime(), utcOffset: 0 } });
    await fireEvent.press(screen.getByRole("button", { name: r.dateDone }));
    expect(screen.queryByTestId("approve-date-picker")).not.toBeOnTheScreen();
    expect(screen.getByTestId("approve-effective-date")).toHaveTextContent("20 أكتوبر 2026");

    await fireEvent.press(screen.getByRole("button", { name: r.confirmApprove }));
    // Exactly the API's fields: no daily rate key for an hourly worker.
    expect(mockClient.approveWorker).toHaveBeenCalledWith("wp-1", {
      compensationType: "HOURLY",
      baseHourlyRateAgorot: 5_250,
      overtimeHourlyRateAgorot: 6_500,
      effectiveStartDate: "2026-10-20",
      changeReason: r.changeReason,
    });
  });

  it("on the web (no system date picker), the start date moves a day at a time", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    freezeDate("2026-10-15T09:00:00.000Z");
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.approve }));
    expect(screen.queryByRole("button", { name: r.changeDate })).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: r.nextDay }));
    await fireEvent.press(screen.getByRole("button", { name: r.nextDay }));
    await fireEvent.press(screen.getByRole("button", { name: r.previousDay }));
    expect(screen.getByTestId("approve-effective-date")).toHaveTextContent("16 أكتوبر 2026");
    await fireEvent.changeText(screen.getByLabelText(r.dailyRate), "400");
    await fireEvent.changeText(screen.getByLabelText(r.overtimeRate), "50");
    await fireEvent.press(screen.getByRole("button", { name: r.confirmApprove }));
    expect(mockClient.approveWorker.mock.calls[0][1]).toMatchObject({ effectiveStartDate: "2026-10-16" });
  });

  it("refuses amounts the admin web refuses, in Arabic, before any request", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.approve }));
    await fireEvent.press(screen.getByRole("button", { name: r.confirmApprove }));
    expect(screen.getByTestId("approve-base-rate-error")).toHaveTextContent(r.rateErrors.empty);
    expect(screen.getByTestId("approve-overtime-rate-error")).toHaveTextContent(r.rateErrors.empty);

    await fireEvent.changeText(screen.getByLabelText(r.dailyRate), "1,000");
    await fireEvent.changeText(screen.getByLabelText(r.overtimeRate), "0");
    expect(screen.getByTestId("approve-base-rate-error")).toHaveTextContent(r.rateErrors.invalid);
    expect(screen.getByTestId("approve-overtime-rate-error")).toHaveTextContent(r.rateErrors.zero);
    await fireEvent.press(screen.getByRole("button", { name: r.confirmApprove }));
    expect(mockClient.approveWorker).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("sends one approval for a fast double press", async () => {
    const sent = deferred<unknown>();
    mockClient.approveWorker.mockReturnValue(sent.promise);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.approve }));
    await fireEvent.changeText(screen.getByLabelText(r.dailyRate), "400");
    await fireEvent.changeText(screen.getByLabelText(r.overtimeRate), "50");
    await doubleTap(screen.getByRole("button", { name: r.confirmApprove }));
    expect(mockClient.approveWorker).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: r.approving })).toBeBusy();
    await act(async () => sent.resolve({}));
    expect(await screen.findByText(r.approved)).toBeOnTheScreen();
  });

  it("shows a refused approval in Arabic, and reads the application again when someone else decided meanwhile", async () => {
    mockClient.approveWorker.mockRejectedValue(apiError(409, "CONFLICT", "This worker is not pending approval."));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.approve }));
    await fireEvent.changeText(screen.getByLabelText(r.dailyRate), "400");
    await fireEvent.changeText(screen.getByLabelText(r.overtimeRate), "50");
    mockClient.getOnboardingSummary.mockResolvedValue({ ...OWNER_SUMMARY, membershipStatus: "ACTIVE" });
    await fireEvent.press(screen.getByRole("button", { name: r.confirmApprove }));

    expect(await screen.findByText(`${r.approveFailed}\n${ar.errors.CONFLICT}`)).toBeOnTheScreen();
    expect(screen.queryByText(/not pending approval/)).not.toBeOnTheScreen();
    expect(await screen.findByText(fill(r.decided, { status: ar.enums.AccountStatus.ACTIVE }))).toBeOnTheScreen();
    expect(mockClient.getOnboardingSummary).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: r.confirmApprove })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("«اتصال» calls the applicant's phone", async () => {
    jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: fill(r.callLabel, { name: "سامر" }) }));
    expect(Linking.openURL).toHaveBeenCalledWith("tel:+972501234567");
    expect(screen.getByTestId("onboarding-call")).toHaveTextContent(r.call);
  });

  it("says so when the phone cannot start a call", async () => {
    jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no dialer"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: fill(r.callLabel, { name: "سامر" }) }));
    expect(await screen.findByText(r.callFailed)).toBeOnTheScreen();
  });
});

describe("OnboardingReviewScreen as a Field Manager (no bank details, no money)", () => {
  beforeEach(() => {
    mockClient.getOnboardingSummary.mockResolvedValue(FIELD_MANAGER_SUMMARY);
  });

  it("shows no bank account, no full details, no approval and no amount (₪)", async () => {
    await renderScreen();
    expect(await screen.findByRole("button", { name: r.reject })).toBeOnTheScreen();

    expect(screen.queryByTestId("onboarding-bank")).not.toBeOnTheScreen();
    expect(screen.queryByText(r.bankTitle)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.reveal })).not.toBeOnTheScreen();
    expect(screen.queryByText(r.auditNote)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.approve })).not.toBeOnTheScreen();
    expect(screen.queryByTestId("approve-form")).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(r.dailyRate)).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(r.hourlyRate)).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(r.overtimeRate)).not.toBeOnTheScreen();
    expect(renderedStrings().join("\n")).not.toContain("₪");
    // What a Field Manager may see.
    expect(within(screen.getByTestId("onboarding-phone")).getByText(isolateLtr("+972501234567"))).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.GovernmentIdType.ISRAELI_ID)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("rejects only with a reason: an Arabic error first, then the trimmed reason; then confirms and goes back", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reject }));
    expect(renderedStrings().join("\n")).not.toContain("₪");

    await fireEvent.press(screen.getByRole("button", { name: r.confirmReject }));
    expect(screen.getByText(r.rejectReasonRequired)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText(r.rejectReasonLabel), "   ");
    await fireEvent.press(screen.getByRole("button", { name: r.confirmReject }));
    expect(mockClient.rejectWorker).not.toHaveBeenCalled();
    expectArabicOnly();

    await fireEvent.changeText(screen.getByLabelText(r.rejectReasonLabel), "  صورة الهوية غير واضحة  ");
    expect(screen.queryByText(r.rejectReasonRequired)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: r.confirmReject }));
    expect(mockClient.rejectWorker).toHaveBeenCalledTimes(1);
    expect(mockClient.rejectWorker).toHaveBeenCalledWith("wp-1", "صورة الهوية غير واضحة");
    expect(await screen.findByText(r.rejected)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole("button", { name: r.backToList }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockClient.approveWorker).not.toHaveBeenCalled();
    expect(mockClient.getOnboardingReview).not.toHaveBeenCalled();
    expect(mockClient.getFileAssetViewUrl).not.toHaveBeenCalled();
  });

  it("cancelling the rejection sends nothing", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reject }));
    await fireEvent.press(screen.getByRole("button", { name: ar.common.cancel }));
    expect(screen.queryByTestId("reject-form")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: r.reject })).toBeOnTheScreen();
    expect(mockClient.rejectWorker).not.toHaveBeenCalled();
  });

  it("shows a refused rejection in Arabic", async () => {
    mockClient.rejectWorker.mockRejectedValue(apiError(403, "FORBIDDEN", "Missing permission"));
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: r.reject }));
    await fireEvent.changeText(screen.getByLabelText(r.rejectReasonLabel), "طلب مكرر");
    await fireEvent.press(screen.getByRole("button", { name: r.confirmReject }));
    expect(await screen.findByText(`${r.rejectFailed}\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expect(screen.getByLabelText(r.rejectReasonLabel)).toHaveDisplayValue("طلب مكرر");
    expectArabicOnly();
  });
});

describe("OnboardingReviewScreen opened from a notification", () => {
  it("shows who settled it, when and how, and offers no action", async () => {
    mockClient.getNotificationSubject.mockResolvedValue(HANDLED_APPROVED);
    mockClient.getOnboardingSummary.mockResolvedValue({ ...OWNER_SUMMARY, membershipStatus: "ACTIVE" });
    await renderScreen({ subjectId: "subject-1" });

    const banner = within(await screen.findByTestId("onboarding-handled"));
    expect(banner.getByText(fill(r.handledBy, { name: isolateAuto("ليلى حداد"), time: "15 أكتوبر 2026 في 12:30" }))).toBeOnTheScreen();
    expect(banner.getByText(fill(r.handledOutcome, { outcome: ar.enums.NotificationHandledOutcome.WORKER_APPROVED }))).toBeOnTheScreen();
    expect(screen.getByText(fill(r.decided, { status: ar.enums.AccountStatus.ACTIVE }))).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.approve })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.reject })).not.toBeOnTheScreen();
    expect(mockClient.getNotificationSubject).toHaveBeenCalledWith("subject-1");
    expectArabicOnly();
  });

  it("a rejection: the outcome and its note in Arabic", async () => {
    mockClient.getNotificationSubject.mockResolvedValue({
      ...HANDLED_APPROVED,
      handled: { at: "2026-10-15T09:30:00.000Z", by: { userId: "user-2", fullLegalName: "ليلى حداد" }, outcome: "WORKER_REJECTED", note: "الوثيقة منتهية الصلاحية" },
    });
    mockClient.getOnboardingSummary.mockResolvedValue({ ...OWNER_SUMMARY, membershipStatus: "REJECTED" });
    await renderScreen({ subjectId: "subject-1" });

    const banner = within(await screen.findByTestId("onboarding-handled"));
    expect(banner.getByText(fill(r.handledOutcome, { outcome: ar.enums.NotificationHandledOutcome.WORKER_REJECTED }))).toBeOnTheScreen();
    expect(banner.getByText(fill(r.handledNote, { note: isolateAuto("الوثيقة منتهية الصلاحية") }))).toBeOnTheScreen();
    expect(screen.getByText(fill(r.decided, { status: ar.enums.AccountStatus.REJECTED }))).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.reject })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("settled on the subject while the status has not caught up yet: no action either", async () => {
    mockClient.getNotificationSubject.mockResolvedValue(HANDLED_APPROVED);
    await renderScreen({ subjectId: "subject-1" });
    expect(await screen.findByTestId("onboarding-handled")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.approve })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: r.reject })).not.toBeOnTheScreen();
  });

  it("not settled yet: no banner, and the actions", async () => {
    await renderScreen({ subjectId: "subject-1" });
    expect(await screen.findByRole("button", { name: r.approve })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: r.reject })).toBeOnTheScreen();
    expect(mockClient.getNotificationSubject).toHaveBeenCalledWith("subject-1");
    expect(screen.queryByTestId("onboarding-handled")).not.toBeOnTheScreen();
  });

  it("a subject that cannot be read leaves the banner out; the application still shows", async () => {
    mockClient.getNotificationSubject.mockRejectedValue(apiError(404, "NOT_FOUND"));
    await renderScreen({ subjectId: "subject-1" });
    expect(await screen.findByRole("button", { name: r.approve })).toBeOnTheScreen();
    expect(screen.queryByTestId("onboarding-handled")).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.errors.NOT_FOUND)).not.toBeOnTheScreen();
  });
});

describe("OnboardingReviewScreen: loading and errors", () => {
  it("shows the API's error in Arabic and retries", async () => {
    mockClient.getOnboardingSummary.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "boom"));
    await renderScreen();
    expect(await screen.findByText(`${r.loadError}\n${ar.errors.INTERNAL_ERROR}`)).toBeOnTheScreen();
    expect(screen.queryByText(/boom/)).not.toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByRole("button", { name: r.approve })).toBeOnTheScreen();
    expect(mockClient.getOnboardingSummary).toHaveBeenCalledTimes(2);
  });

  it("an application that does not exist (or is not visible): says so", async () => {
    mockClient.getOnboardingSummary.mockRejectedValue(apiError(404, "NOT_FOUND"));
    await renderScreen();
    expect(await screen.findByText(r.notFound)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.states.retry })).not.toBeOnTheScreen();
    expectArabicOnly();
  });
});

describe("parseShekelsToAgorot (the admin web's rule)", () => {
  it.each([
    ["400", 40_000],
    ["45.50", 4_550],
    ["45.5", 4_550],
    ["0.07", 7],
    ["1.10", 110],
    [" 12 ", 1_200],
    ["007", 700],
    ["٤٥٫٥", 4_550],
    ["1000000", 100_000_000],
  ])("%s -> %d agorot", (input, agorot) => {
    expect(parseShekelsToAgorot(input)).toEqual({ ok: true, agorot });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["1,000", "invalid"],
    ["1e3", "invalid"],
    [".5", "invalid"],
    ["5.", "invalid"],
    ["مئة", "invalid"],
    ["-5", "negative"],
    ["0", "zero"],
    ["0.00", "zero"],
    ["1.234", "tooManyDecimals"],
    ["1000000.01", "tooLarge"],
    ["12345678", "tooLarge"],
  ])("%s is refused (%s)", (input, error) => {
    expect(parseShekelsToAgorot(input)).toEqual({ ok: false, error });
  });
});
