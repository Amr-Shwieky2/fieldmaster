import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type SupervisorIssue } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { SupervisorIssueScreen } from "../SupervisorIssueScreen";
import { deferred, doubleTap, expectArabicOnly, renderInArabic } from "./clock-screens-test-utils";

const mockClient = { getSupervisorIssue: jest.fn(), resolveSupervisorIssue: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } }) }));
const mockPermissions = new Set<string>();
jest.mock("../../lib/access-context", () => ({ useAccess: () => ({ can: (permission: string) => mockPermissions.has(permission), isManager: true }) }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

type Props = NativeStackScreenProps<RootStackParamList, "SupervisorIssue">;
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

const t = ar.supervisorIssue;
const FSI = "⁨";
const PDI = "⁩";
const iso = (value: string) => `${FSI}${value}${PDI}`;
const PHONE = "+972501234567";

const ISSUE: SupervisorIssue = {
  id: "iss-1",
  text: "نقص في معدات السلامة",
  reportedAt: "2026-10-15T07:15:00.000Z",
  shift: { id: "sh-1", title: "حفريات شارع هرتسل", siteName: "موقع هرتسل", scheduledStart: "2026-10-15T04:00:00.000Z", scheduledEnd: "2026-10-15T13:00:00.000Z" },
  supervisor: { workerProfileId: "wp-5", fullLegalName: "يوسف عيسى", phoneNumber: PHONE },
  resolved: null,
};
const RESOLVED: SupervisorIssue = {
  ...ISSUE,
  resolved: { at: "2026-10-15T08:30:00.000Z", by: { userId: "u-2", fullLegalName: "سارة لوي" }, note: "وصلت المعدات" },
};

function renderScreen() {
  return renderInArabic(
    <SupervisorIssueScreen
      navigation={navigation as unknown as Props["navigation"]}
      route={{ key: "SupervisorIssue-1", name: "SupervisorIssue", params: { issueId: "iss-1", subjectId: "subj-issue" } }}
    />,
  );
}

const resolveButton = () => screen.getByRole("button", { name: t.resolve });
const conflict = () => new ApiRequestError(409, { statusCode: 409, code: "CONFLICT", message: "Already resolved", correlationId: "c" });

beforeEach(() => {
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockPermissions.clear();
  mockPermissions.add(Permission.VIEW_OPERATIONS);
  mockSync.isOnline = true;
  mockClient.getSupervisorIssue.mockResolvedValue(ISSUE);
  mockClient.resolveSupervisorIssue.mockResolvedValue(RESOLVED);
  jest.mocked(Linking.openURL).mockResolvedValue(true);
});

describe("SupervisorIssueScreen (Arabic, RTL)", () => {
  it("shows the report, when it was sent, the shift and the temporary supervisor", async () => {
    const issue = deferred<SupervisorIssue>();
    mockClient.getSupervisorIssue.mockReturnValue(issue.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: t.title })).toBeOnTheScreen();
    await act(async () => issue.resolve(ISSUE));

    expect(mockClient.getSupervisorIssue).toHaveBeenCalledWith("iss-1");
    expect(screen.getByText(iso("نقص في معدات السلامة"))).toBeOnTheScreen();
    expect(screen.getByText("أُرسل في 15 أكتوبر 2026 في 10:15")).toBeOnTheScreen();
    expect(screen.getByText(iso("حفريات شارع هرتسل"))).toBeOnTheScreen();
    expect(screen.getByText(`الموقع: ${iso("موقع هرتسل")}`)).toBeOnTheScreen();
    expect(screen.getByText("من 15 أكتوبر 2026 في 07:00 إلى 15 أكتوبر 2026 في 16:00")).toBeOnTheScreen();
    expect(screen.getByText(iso("يوسف عيسى"))).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: t.call })).toBeOnTheScreen();
    expect(resolveButton()).toBeOnTheScreen();
    // The number is not shown, only dialed.
    expect(screen.queryByText(new RegExp(PHONE.replace("+", "\\+")))).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("«اتصل بالمشرف» dials the supervisor; where a call cannot start, it says so with the number", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: t.call }));
    expect(Linking.openURL).toHaveBeenCalledWith(`tel:${PHONE}`);
    expect(screen.queryByText(/تعذّر بدء الاتصال/)).not.toBeOnTheScreen();

    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("No phone app"));
    await fireEvent.press(screen.getByRole("button", { name: t.call }));
    expect(await screen.findByText(`تعذّر بدء الاتصال من هذا الجهاز. رقم المشرف: ⁦${PHONE}⁩`)).toBeOnTheScreen();
    expectArabicOnly([PHONE]);
  });

  it("«تم الحل» needs a note first", async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole("button", { name: t.resolve }));
    expect(screen.getByText(t.noteRequired)).toBeOnTheScreen();
    expect(mockClient.resolveSupervisorIssue).not.toHaveBeenCalled();

    // Spaces only are not a note either; typing clears the message.
    await fireEvent.changeText(screen.getByLabelText(t.noteLabel), "   ");
    expect(screen.queryByText(t.noteRequired)).not.toBeOnTheScreen();
    await fireEvent.press(resolveButton());
    expect(screen.getByText(t.noteRequired)).toBeOnTheScreen();
    expect(mockClient.resolveSupervisorIssue).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("resolves with the note (once, even on a fast double tap), then goes back", async () => {
    await renderScreen();
    await fireEvent.changeText(await screen.findByLabelText(t.noteLabel), "  وصلت المعدات  ");
    await doubleTap(resolveButton());

    expect(mockClient.resolveSupervisorIssue).toHaveBeenCalledTimes(1);
    expect(mockClient.resolveSupervisorIssue).toHaveBeenCalledWith("iss-1", "وصلت المعدات");
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("once resolved: who resolved it, when, and the note -- no «تم الحل»", async () => {
    mockClient.getSupervisorIssue.mockResolvedValue(RESOLVED);
    await renderScreen();
    expect(await screen.findByText(`تم الحل بواسطة ${iso("سارة لوي")} في 15 أكتوبر 2026 في 11:30`)).toBeOnTheScreen();
    expect(screen.getByText(`الملاحظة: ${iso("وصلت المعدات")}`)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.resolve })).not.toBeOnTheScreen();
    expect(screen.queryByLabelText(t.noteLabel)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("resolved by someone else meanwhile: shows who did instead of the form", async () => {
    mockClient.resolveSupervisorIssue.mockRejectedValue(conflict());
    await renderScreen();
    await fireEvent.changeText(await screen.findByLabelText(t.noteLabel), "وصلت المعدات");
    mockClient.getSupervisorIssue.mockResolvedValue(RESOLVED);
    await fireEvent.press(resolveButton());

    expect(await screen.findByText(`تم الحل بواسطة ${iso("سارة لوي")} في 15 أكتوبر 2026 في 11:30`)).toBeOnTheScreen();
    expect(mockClient.getSupervisorIssue).toHaveBeenCalledTimes(2);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("says in Arabic when resolving fails, keeps the note, and stays", async () => {
    mockClient.resolveSupervisorIssue.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    await fireEvent.changeText(await screen.findByLabelText(t.noteLabel), "وصلت المعدات");
    await fireEvent.press(resolveButton());

    expect(await screen.findByText(ar.errors.network)).toBeOnTheScreen();
    expect(screen.getByLabelText(t.noteLabel).props.value).toBe("وصلت المعدات");
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(mockClient.getSupervisorIssue).toHaveBeenCalledTimes(1);
    expectArabicOnly();
  });

  it("says when the report does not exist (or is outside this member's projects)", async () => {
    mockClient.getSupervisorIssue.mockRejectedValue(new ApiRequestError(404, { statusCode: 404, code: "NOT_FOUND", message: "Not found", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(t.notFound)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: t.resolve })).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows an Arabic error and retries", async () => {
    mockClient.getSupervisorIssue.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${t.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText(iso("نقص في معدات السلامة"))).toBeOnTheScreen();
  });

  it("without VIEW_OPERATIONS: says so, and asks the API nothing", async () => {
    mockPermissions.clear();
    await renderScreen();
    expect(screen.getByText(ar.states.accessDeniedTitle)).toBeOnTheScreen();
    expect(mockClient.getSupervisorIssue).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("goes back", async () => {
    await renderScreen();
    await screen.findByText(iso("نقص في معدات السلامة"));
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});
