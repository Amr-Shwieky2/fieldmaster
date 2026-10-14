import { Linking, Platform, ScrollView } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type CurrentSalaryEstimate, type GeneratedReport, type MySalaryStatements, type SalaryStatement } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import { colors } from "../../lib/theme";
import type { RootStackParamList } from "../../navigation/types";
import { monthRange, SalaryScreen, statementPolling } from "../SalaryScreen";
import { deferred, expectArabicOnly, fill, renderInArabic } from "./clock-screens-test-utils";

const mockClient = {
  getMySalaryStatements: jest.fn(),
  getMyCurrentSalaryEstimate: jest.fn(),
  createReport: jest.fn(),
  getReport: jest.fn(),
  getReportDownloadUrl: jest.fn(),
};
const mockAuth = { client: mockClient, session: { role: "WORKER", workerProfileId: "worker-1" } as { role: string; workerProfileId: string | null } };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));
const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

type Navigation = NativeStackScreenProps<RootStackParamList, "Salary">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

const ltr = (value: string) => `⁦${value}⁩`;

/** The file format's name stays Latin inside the Arabic button label, like "SMS" elsewhere. */
const PDF = ["PDF"];

function statement(overrides: Partial<SalaryStatement> & Pick<SalaryStatement, "yearMonth">): SalaryStatement {
  return {
    status: "FINALIZED",
    isEstimate: false,
    version: 1,
    finalizedAt: "2026-10-02T09:00:00.000Z",
    approvedShifts: 20,
    standardDaysCredited: 20,
    regularMinutes: 10800,
    overtimeMinutes: 120,
    baseAgorot: 900000,
    overtimeAgorot: 12000,
    grossAgorot: 912000,
    adjustmentsAgorot: 5000,
    forgottenStampDeductionsAgorot: -1000,
    netPayableAgorot: 916000,
    pendingEntries: null,
    ...overrides,
  };
}

const SEPTEMBER = statement({ yearMonth: "2026-09" });
const AUGUST = statement({ yearMonth: "2026-08", version: 2, netPayableAgorot: 800000 });
const ESTIMATE: CurrentSalaryEstimate = {
  ...statement({ yearMonth: "2026-10" }),
  status: "DRAFT",
  isEstimate: true,
  version: null,
  finalizedAt: null,
  approvedShifts: 8,
  netPayableAgorot: 360000,
  grossAgorot: 360000,
  pendingEntries: 2,
  basis: "APPROVED_ENTRIES_ONLY",
  calculatedAt: "2026-10-13T08:00:00.000Z",
};
const MINE: MySalaryStatements = { statements: [AUGUST, SEPTEMBER], estimates: [statement({ ...ESTIMATE })] };

function report(overrides: Partial<GeneratedReport> = {}): GeneratedReport {
  return {
    id: "report-1",
    reportType: "WORKER_ATTENDANCE_LEDGER",
    status: "QUEUED",
    progress: 0,
    filters: {},
    includesFinancials: true,
    templateVersion: "1",
    requestedByUserId: "user-1",
    requestedByName: null,
    subjectWorkerProfileId: "worker-1",
    subjectWorkerName: null,
    sha256Hash: null,
    pdfSha256: null,
    csvSha256: null,
    pageCount: null,
    errorCode: null,
    generatedAt: "2026-10-13T08:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

const DOWNLOAD = { downloadUrl: "https://files.example/ledger.pdf?sig=1", expiresInSeconds: 300, fileName: "ledger.pdf", sha256: null };

function renderScreen(params?: { yearMonth?: string }) {
  return renderInArabic(<SalaryScreen navigation={navigation as unknown as Navigation} route={{ key: "Salary-1", name: "Salary", params }} />);
}

const month = (yearMonth: string) => screen.getByTestId(`salary-month-${yearMonth}`);

beforeEach(() => {
  // Answers queued with mockResolvedValueOnce must not leak from one test into the next.
  for (const fn of Object.values(mockClient)) fn.mockReset();
  statementPolling.intervalMs = 1;
  statementPolling.maxAttempts = 80;
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockSync.isOnline = true;
  mockAuth.session = { role: "WORKER", workerProfileId: "worker-1" };
  mockClient.getMySalaryStatements.mockResolvedValue(MINE);
  mockClient.getMyCurrentSalaryEstimate.mockResolvedValue(ESTIMATE);
  mockClient.createReport.mockResolvedValue(report());
  mockClient.getReport.mockResolvedValueOnce(report({ status: "RUNNING", progress: 40 })).mockResolvedValue(report({ status: "READY", progress: 100 }));
  mockClient.getReportDownloadUrl.mockResolvedValue(DOWNLOAD);
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

describe("SalaryScreen (Arabic, RTL)", () => {
  it("shows the loading state, then the current month clearly as an estimate, from /me routes only", async () => {
    const mine = deferred<MySalaryStatements>();
    mockClient.getMySalaryStatements.mockReturnValue(mine.promise);
    await renderScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    await act(async () => mine.resolve(MINE));

    expect(screen.getByRole("header", { name: ar.salary.title })).toBeOnTheScreen();
    const current = within(month("2026-10"));
    expect(current.getByText("أكتوبر 2026")).toBeOnTheScreen();
    expect(current.getByText("تقدير — غير نهائي")).toBeOnTheScreen();
    expect(current.getByText(ar.salary.estimateBasis)).toBeOnTheScreen();
    expect(current.getByText(`الصافي: ${ltr("₪ 3,600.00")}`)).toBeOnTheScreen();
    expect(current.getByText("دوامات بانتظار الموافقة غير محسوبة بعد: 2")).toBeOnTheScreen();
    expect(current.getByText(`حالة الرواتب: ${ar.enums.SalaryStatementStatus.DRAFT}`)).toBeOnTheScreen();
    // No PDF for a month that is not final.
    expect(current.queryByRole("button", { name: ar.salary.download })).not.toBeOnTheScreen();
    // The estimate of the current month is not repeated among the open months.
    expect(screen.getAllByText("أكتوبر 2026")).toHaveLength(1);
    expect(mockClient.getMySalaryStatements).toHaveBeenCalledWith();
    expect(mockClient.getMyCurrentSalaryEstimate).toHaveBeenCalledWith();
    expectArabicOnly(PDF);
  });

  it("shows each finalized month (from statements only) with gross, base, overtime, adjustments, stamp deductions, net and status", async () => {
    await renderScreen();
    const september = within(await screen.findByTestId("salary-month-2026-09"));
    expect(september.getByText("نهائي")).toBeOnTheScreen();
    expect(september.queryByText("تقدير — غير نهائي")).not.toBeOnTheScreen();
    expect(september.getByText(`الصافي: ${ltr("₪ 9,160.00")}`)).toBeOnTheScreen();
    expect(september.getByText(`الإجمالي قبل الخصم: ${ltr("₪ 9,120.00")}`)).toBeOnTheScreen();
    expect(september.getByText(`الأجر الأساسي: ${ltr("₪ 9,000.00")}`)).toBeOnTheScreen();
    expect(september.getByText(`أجر الساعات الإضافية: ${ltr("₪ 120.00")}`)).toBeOnTheScreen();
    expect(september.getByText(`التعديلات: ${ltr("₪ 50.00")}`)).toBeOnTheScreen();
    expect(september.getByText(`خصم نسيان التسجيل: ${ltr("-₪ 10.00")}`)).toBeOnTheScreen();
    expect(september.getByText(`حالة الرواتب: ${ar.enums.SalaryStatementStatus.FINALIZED}`)).toBeOnTheScreen();
    expect(september.getByText("النسخة المعتمدة: 1")).toBeOnTheScreen();
    expect(september.getByText("اعتُمدت في 2 أكتوبر 2026")).toBeOnTheScreen();
    expect(september.getByText("ساعات عادية: 180 س 0 د")).toBeOnTheScreen();
    expect(within(month("2026-08")).getByText("النسخة المعتمدة: 2")).toBeOnTheScreen();
    expectArabicOnly(PDF);
  });

  it("never shows an estimate as final, even when the API lists it under estimates only", async () => {
    mockClient.getMyCurrentSalaryEstimate.mockRejectedValue(new ApiRequestError(409, { statusCode: 409, code: "PAYROLL_PERIOD_FINALIZED", message: "finalized", correlationId: "c" }));
    mockClient.getMySalaryStatements.mockResolvedValue({ statements: [SEPTEMBER], estimates: [statement({ ...ESTIMATE, yearMonth: "2026-08", status: "DRAFT", isEstimate: true })] });
    await renderScreen();
    expect(await screen.findByText(ar.salary.currentFinalized)).toBeOnTheScreen();
    expect(within(month("2026-08")).getByText("تقدير — غير نهائي")).toBeOnTheScreen();
    expect(within(month("2026-08")).queryByRole("button", { name: ar.salary.download })).not.toBeOnTheScreen();
    expect(screen.getByText(ar.salary.openMonths)).toBeOnTheScreen();
  });

  it("downloads a finalized month's statement: the worker's own ledger report, with progress, then opens it", async () => {
    const created = deferred<GeneratedReport>();
    mockClient.createReport.mockReturnValue(created.promise);
    await renderScreen();
    const september = within(await screen.findByTestId("salary-month-2026-09"));

    await fireEvent.press(september.getByRole("button", { name: ar.salary.download }));
    expect(september.getByRole("button", { name: ar.salary.preparing })).toBeBusy();
    await act(async () => created.resolve(report()));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(DOWNLOAD.downloadUrl));

    expect(mockClient.createReport).toHaveBeenCalledWith(
      { reportType: "WORKER_ATTENDANCE_LEDGER", filters: { workerProfileId: "worker-1", fromDate: "2026-09-01", toDate: "2026-09-30" } },
      expect.stringMatching(/^statement-2026-09-[0-9a-f]{24}$/),
    );
    expect(mockClient.getReport).toHaveBeenCalledWith("report-1");
    expect(mockClient.getReportDownloadUrl).toHaveBeenCalledWith("report-1", "pdf");
    expect(september.getByText(ar.salary.ready)).toBeOnTheScreen();

    await fireEvent.press(september.getByRole("button", { name: ar.salary.open }));
    expect(Linking.openURL).toHaveBeenCalledTimes(2);
    expectArabicOnly(PDF);
  });

  it("shows the progress percentage while the report is generated", async () => {
    const running = deferred<GeneratedReport>();
    mockClient.getReport.mockReset();
    mockClient.getReport.mockReturnValueOnce(running.promise).mockResolvedValue(report({ status: "READY", progress: 100 }));
    mockClient.createReport.mockResolvedValue(report({ status: "RUNNING", progress: 40 }));
    await renderScreen();
    await fireEvent.press(within(await screen.findByTestId("salary-month-2026-09")).getByRole("button", { name: ar.salary.download }));
    expect(await screen.findByRole("button", { name: fill(ar.salary.progress, { progress: "40" }) })).toBeBusy();
    await act(async () => running.resolve(report({ status: "READY", progress: 100 })));
    expect(await screen.findByText(ar.salary.ready)).toBeOnTheScreen();
  });

  it("explains a failed report in Arabic and can try again", async () => {
    mockClient.getReport.mockReset();
    mockClient.getReport.mockResolvedValue(report({ status: "FAILED", errorCode: "INTERNAL_ERROR" }));
    await renderScreen();
    const september = within(await screen.findByTestId("salary-month-2026-09"));
    await fireEvent.press(september.getByRole("button", { name: ar.salary.download }));
    expect(await september.findByText(`${ar.salary.failed}\n${ar.errors.INTERNAL_ERROR}`)).toBeOnTheScreen();
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(september.getByRole("button", { name: ar.salary.download })).toBeEnabled();
    expectArabicOnly(PDF);
  });

  it("explains a network failure while preparing the statement", async () => {
    mockClient.createReport.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    const september = within(await screen.findByTestId("salary-month-2026-09"));
    await fireEvent.press(september.getByRole("button", { name: ar.salary.download }));
    expect(await september.findByText(`${ar.salary.failed}\n${ar.errors.network}`)).toBeOnTheScreen();
  });

  it("gives up waiting after a while with an Arabic message", async () => {
    statementPolling.maxAttempts = 2;
    mockClient.getReport.mockReset();
    mockClient.getReport.mockResolvedValue(report({ status: "RUNNING", progress: 10 }));
    await renderScreen();
    const september = within(await screen.findByTestId("salary-month-2026-09"));
    await fireEvent.press(september.getByRole("button", { name: ar.salary.download }));
    expect(await september.findByText(ar.salary.timeout)).toBeOnTheScreen();
  });

  it("on the web, opens the file from a press (no popup opened after a wait)", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await renderScreen();
    const september = within(await screen.findByTestId("salary-month-2026-09"));
    await fireEvent.press(september.getByRole("button", { name: ar.salary.download }));
    expect(await september.findByText(ar.salary.ready)).toBeOnTheScreen();
    expect(Linking.openURL).not.toHaveBeenCalled();
    await fireEvent.press(september.getByRole("button", { name: ar.salary.open }));
    expect(Linking.openURL).toHaveBeenCalledWith(DOWNLOAD.downloadUrl);
  });

  it("only ever asks for the caller's own ledger, whatever ids the responses carry", async () => {
    mockClient.getMySalaryStatements.mockResolvedValue({ statements: [{ ...SEPTEMBER, workerProfileId: "worker-2" } as SalaryStatement], estimates: [] });
    await renderScreen();
    await fireEvent.press(within(await screen.findByTestId("salary-month-2026-09")).getByRole("button", { name: ar.salary.download }));
    await waitFor(() => expect(mockClient.createReport).toHaveBeenCalled());
    expect(mockClient.createReport.mock.calls[0][0].filters.workerProfileId).toBe("worker-1");
    expect(JSON.stringify(mockClient.createReport.mock.calls)).not.toContain("worker-2");
  });

  it("offers no statement download without a worker profile", async () => {
    mockAuth.session = { role: "OWNER", workerProfileId: null };
    await renderScreen();
    expect(within(await screen.findByTestId("salary-month-2026-09")).queryByRole("button", { name: ar.salary.download })).not.toBeOnTheScreen();
  });

  it("shows the empty state", async () => {
    mockClient.getMySalaryStatements.mockResolvedValue({ statements: [], estimates: [] });
    mockClient.getMyCurrentSalaryEstimate.mockRejectedValue(new ApiRequestError(409, { statusCode: 409, code: "PAYROLL_PERIOD_FINALIZED", message: "x", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(ar.salary.noFinalized)).toBeOnTheScreen();
  });

  it("shows an Arabic error from the API code, and retries", async () => {
    mockClient.getMySalaryStatements.mockRejectedValueOnce(new ApiRequestError(404, { statusCode: 404, code: "NOT_FOUND", message: "No worker profile", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(`${ar.salary.loadError}\n${ar.errors.NOT_FOUND}`)).toBeOnTheScreen();
    expect(screen.queryByText(/No worker profile/)).not.toBeOnTheScreen();
    await fireEvent.press(screen.getAllByRole("button", { name: ar.states.retry })[0]);
    expect(await screen.findByTestId("salary-month-2026-09")).toBeOnTheScreen();
  });

  it("offline: the connection banner and the Arabic network error", async () => {
    mockSync.isOnline = false;
    mockClient.getMySalaryStatements.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    mockClient.getMyCurrentSalaryEstimate.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`${ar.salary.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expectArabicOnly(PDF);
  });

  it("highlights the month a notification opened, and scrolls to it once", async () => {
    await renderScreen({ yearMonth: "2026-08" });
    const card = await screen.findByTestId("salary-month-2026-08");
    expect(card).toHaveStyle({ borderColor: colors.primary, borderWidth: 2 });
    expect(screen.getByTestId("salary-month-2026-09")).not.toHaveStyle({ borderWidth: 2 });

    const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;
    await fireEvent(card, "layout", { nativeEvent: { layout: { x: 0, y: 900, width: 340, height: 420 } } });
    expect(scrollTo).toHaveBeenCalledWith({ y: 888, animated: true });
    await fireEvent(card, "layout", { nativeEvent: { layout: { x: 0, y: 950, width: 340, height: 420 } } });
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("computes each month's business days for the ledger", () => {
    expect(monthRange("2026-02")).toEqual({ fromDate: "2026-02-01", toDate: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ fromDate: "2028-02-01", toDate: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ fromDate: "2026-12-01", toDate: "2026-12-31" });
    expect(monthRange("2026-13")).toBeNull();
  });
});
