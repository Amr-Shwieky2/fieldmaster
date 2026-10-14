import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import type { AttendanceListItem, WorkerMonthEarnings } from "@fieldmaster/api-client";
import { LIST_ITEM, listPage } from "@/test/attendance-fixtures";
import { ACCOUNTANT, COORDINATOR, authWithAccess } from "@/test/access-fixtures";
import WorkerDetailPage from "../page";
import { MANAGER_WORKERS, renderWorkersPage } from "../../__tests__/workers-test-utils";

// Flexible organization model on the worker's attendance tab: each row is split with the day rules of its
// own business date (the work rules are versioned by date), and the month's earnings (money) are shown by
// permission (VIEW_FINANCIALS with VIEW_COMPENSATION), whatever the role is called.

const nav = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() },
  searchParams: new URLSearchParams("tab=attendance&month=2026-10"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => "/workers/w-daily",
  useParams: () => ({ id: "w-daily" }),
  useSearchParams: () => nav.searchParams,
}));

const client = vi.hoisted(() => ({ getWorker: vi.fn(), listAttendanceEntries: vi.fn(), getWorkerEstimatedEarnings: vi.fn() }));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

/** 615 minutes with a 30-minute unpaid break: 585 worked. */
const PENDING: AttendanceListItem = {
  ...LIST_ITEM,
  id: "te-2",
  status: "PENDING_APPROVAL",
  businessDate: "2026-10-05",
  clockInAt: "2026-10-05T05:00:00.000Z",
  clockOutAt: "2026-10-05T15:15:00.000Z",
  rawDurationMinutes: 615,
  unpaidBreakMinutes: 30,
  flags: [],
};

const EARNINGS: WorkerMonthEarnings = {
  workerProfileId: "w-daily",
  month: "2026-10",
  approvedAgorot: 49_000,
  pendingEstimateAgorot: 40_000,
  adjustmentsAgorot: 0,
  totalEstimatedAgorot: 89_000,
  approvedEntries: 1,
  pendingEntries: 1,
  openEntries: 0,
  entriesWithoutCompensationProfile: 0,
};

/** Worked, regular and overtime minutes of the table's only row. */
async function minutes(): Promise<(string | null)[]> {
  const table = await screen.findByRole("table", { name: "سجلات حضور العامل في الشهر المختار" });
  const [, row] = within(table).getAllByRole("row");
  return within(row)
    .getAllByRole("cell")
    .slice(4, 7)
    .map((cell) => cell.textContent);
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.value = authWithAccess(COORDINATOR, client);
  client.getWorker.mockResolvedValue(MANAGER_WORKERS[0]);
  client.getWorkerEstimatedEarnings.mockResolvedValue(EARNINGS);
});

describe("Worker attendance tab: day rules and money by permission", () => {
  it("splits a row with the day rules of its own date", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([{ ...PENDING, dayRules: { standardDayMinutes: 480, overtimeThresholdMinutes: 480 } } as AttendanceListItem]));
    renderWorkersPage(<WorkerDetailPage />);
    expect(await minutes()).toEqual(["9 س 45 د", "8 س 0 د", "1 س 45 د"]);
  });

  it("falls back to the default rules when the row has none", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([PENDING]));
    renderWorkersPage(<WorkerDetailPage />);
    expect(await minutes()).toEqual(["9 س 45 د", "9 س 0 د", "0 س 45 د"]);
  });

  it("never asks for the earnings of a custom role without money", async () => {
    client.listAttendanceEntries.mockResolvedValue(listPage([PENDING]));
    renderWorkersPage(<WorkerDetailPage />);
    await minutes();
    expect(client.getWorkerEstimatedEarnings).not.toHaveBeenCalled();
    expect(screen.queryByText("الأرباح التقديرية لهذا الشهر")).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
  });

  it("shows the earnings to a custom role that may see pay", async () => {
    auth.value = authWithAccess(ACCOUNTANT, client);
    client.listAttendanceEntries.mockResolvedValue(listPage([PENDING]));
    renderWorkersPage(<WorkerDetailPage />);

    expect(await screen.findByText("₪ 890.00")).toBeTruthy();
    expect(client.getWorkerEstimatedEarnings).toHaveBeenCalledWith("w-daily", "2026-10");
  });
});
