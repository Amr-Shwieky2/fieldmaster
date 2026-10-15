import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { screen, within } from "@testing-library/react-native";
import { ApiRequestError, type CurrentSalaryEstimate, type MySalaryStatements, type SalaryStatement } from "@fieldmaster/api-client";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { isEmptyMonth, SalaryScreen } from "../SalaryScreen";
import { expectArabicOnly, renderInArabic } from "./clock-screens-test-utils";

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
const navigation = { navigate: jest.fn(), goBack: jest.fn() };

/** The file format's name stays Latin inside the Arabic button label. */
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

/** The current month on its first day: nothing approved, nothing waiting, no adjustment. */
const EMPTY_ESTIMATE: CurrentSalaryEstimate = {
  ...statement({ yearMonth: "2026-10" }),
  status: "DRAFT",
  isEstimate: true,
  version: null,
  finalizedAt: null,
  approvedShifts: 0,
  standardDaysCredited: 0,
  regularMinutes: 0,
  overtimeMinutes: 0,
  baseAgorot: 0,
  overtimeAgorot: 0,
  grossAgorot: 0,
  adjustmentsAgorot: 0,
  forgottenStampDeductionsAgorot: 0,
  netPayableAgorot: 0,
  pendingEntries: 0,
  basis: "APPROVED_ENTRIES_ONLY",
  calculatedAt: "2026-10-01T06:00:00.000Z",
};
const SEPTEMBER = statement({ yearMonth: "2026-09" });

function renderScreen() {
  return renderInArabic(<SalaryScreen navigation={navigation as unknown as Navigation} route={{ key: "Salary-1", name: "Salary", params: undefined }} />);
}

const noWorkerProfile = () =>
  new ApiRequestError(404, { statusCode: 404, code: "NO_WORKER_PROFILE", message: "This member has no worker profile", correlationId: "c" });

beforeEach(() => {
  for (const fn of Object.values(mockClient)) fn.mockReset();
  mockAuth.session = { role: "WORKER", workerProfileId: "worker-1" };
  mockSync.isOnline = true;
});

describe("SalaryScreen: a month with nothing in it yet", () => {
  it("nothing this month and no other month: «لا يوجد راتب لهذا الشهر بعد», never an error and never a card of zeros", async () => {
    const mine: MySalaryStatements = { statements: [], estimates: [statement({ ...EMPTY_ESTIMATE })] };
    mockClient.getMySalaryStatements.mockResolvedValue(mine);
    mockClient.getMyCurrentSalaryEstimate.mockResolvedValue(EMPTY_ESTIMATE);
    await renderScreen();

    const empty = within(await screen.findByTestId("salary-nothing-yet"));
    expect(empty.getByText("لا يوجد راتب لهذا الشهر بعد")).toBeOnTheScreen();
    expect(ar.salary.noSalaryYet).toBe("لا يوجد راتب لهذا الشهر بعد");
    expect(empty.getByText(ar.salary.emptyHint)).toBeOnTheScreen();
    expect(screen.queryByText(ar.salary.loadError, { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.salary.estimateLoadError, { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.states.retry })).not.toBeOnTheScreen();
    expect(screen.queryByTestId("salary-month-2026-10")).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.salary.finalizedMonths)).not.toBeOnTheScreen();
    expect(screen.queryByText(/₪/)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("an empty current month next to finalized months: the sentence under «الشهر الحالي», the finalized months as before", async () => {
    mockClient.getMySalaryStatements.mockResolvedValue({ statements: [SEPTEMBER], estimates: [statement({ ...EMPTY_ESTIMATE })] });
    mockClient.getMyCurrentSalaryEstimate.mockResolvedValue(EMPTY_ESTIMATE);
    await renderScreen();

    expect(await screen.findByTestId("salary-current-empty")).toHaveTextContent(ar.salary.noSalaryYet);
    expect(screen.getByText(ar.salary.currentMonth)).toBeOnTheScreen();
    expect(screen.queryByTestId("salary-month-2026-10")).not.toBeOnTheScreen();
    // The empty month is not repeated among the open months either.
    expect(screen.queryByText(ar.salary.openMonths)).not.toBeOnTheScreen();
    const september = within(screen.getByTestId("salary-month-2026-09"));
    expect(september.getByText(ar.salary.finalLabel)).toBeOnTheScreen();
    expect(september.getByRole("button", { name: ar.salary.download })).toBeOnTheScreen();
    expect(screen.queryByTestId("salary-nothing-yet")).not.toBeOnTheScreen();
    expectArabicOnly(PDF);
  });

  it("a month with entries waiting for approval is not empty: its estimate card says how many", async () => {
    const waiting = { ...EMPTY_ESTIMATE, pendingEntries: 2 };
    mockClient.getMySalaryStatements.mockResolvedValue({ statements: [], estimates: [] });
    mockClient.getMyCurrentSalaryEstimate.mockResolvedValue(waiting);
    await renderScreen();

    const october = within(await screen.findByTestId("salary-month-2026-10"));
    expect(october.getByText("دوامات بانتظار الموافقة غير محسوبة بعد: 2")).toBeOnTheScreen();
    expect(screen.queryByText(ar.salary.noSalaryYet)).not.toBeOnTheScreen();
  });

  it("a deduction alone is not «nothing»: the card shows it", async () => {
    const deducted = { ...EMPTY_ESTIMATE, forgottenStampDeductionsAgorot: -1000, netPayableAgorot: -1000 };
    mockClient.getMySalaryStatements.mockResolvedValue({ statements: [], estimates: [] });
    mockClient.getMyCurrentSalaryEstimate.mockResolvedValue(deducted);
    await renderScreen();
    expect(await screen.findByTestId("salary-month-2026-10")).toBeOnTheScreen();
    expect(screen.queryByText(ar.salary.noSalaryYet)).not.toBeOnTheScreen();
  });

  it("tells an empty month from one with anything in it", () => {
    expect(isEmptyMonth(EMPTY_ESTIMATE)).toBe(true);
    expect(isEmptyMonth({ ...EMPTY_ESTIMATE, approvedShifts: null, pendingEntries: null })).toBe(true);
    expect(isEmptyMonth({ ...EMPTY_ESTIMATE, approvedShifts: 1 })).toBe(false);
    expect(isEmptyMonth({ ...EMPTY_ESTIMATE, pendingEntries: 1 })).toBe(false);
    expect(isEmptyMonth({ ...EMPTY_ESTIMATE, adjustmentsAgorot: 5000, netPayableAgorot: 5000 })).toBe(false);
    expect(isEmptyMonth(SEPTEMBER)).toBe(false);
  });
});

describe("SalaryScreen: a member without a worker profile", () => {
  it("NO_WORKER_PROFILE: a clear Arabic message (not «not found»), without a retry that cannot help", async () => {
    mockAuth.session = { role: "OWNER", workerProfileId: null };
    mockClient.getMySalaryStatements.mockRejectedValue(noWorkerProfile());
    mockClient.getMyCurrentSalaryEstimate.mockRejectedValue(noWorkerProfile());
    await renderScreen();

    const unavailable = within(await screen.findByTestId("salary-unavailable"));
    expect(unavailable.getByText(ar.salary.unavailable)).toBeOnTheScreen();
    expect(unavailable.getByText(ar.errors.NO_WORKER_PROFILE)).toBeOnTheScreen();
    expect(screen.queryByText(ar.errors.NOT_FOUND, { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.salary.loadError, { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText(/no worker profile/i)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.states.retry })).not.toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.salary.title })).toBeOnTheScreen();
    expectArabicOnly();
  });
});
