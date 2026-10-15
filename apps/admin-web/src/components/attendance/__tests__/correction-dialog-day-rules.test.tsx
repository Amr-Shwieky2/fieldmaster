import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Permission } from "@fieldmaster/shared-types";
import { renderWithIntl } from "@/test/render-with-intl";
import { EVIDENCE, infractions } from "@/test/attendance-fixtures";
import { authWithAccess, myAccess } from "@/test/access-fixtures";
import { CorrectionDialog, type CorrectionEntry } from "../correction-dialog";

// Flexible organization model: the work rules are versioned by date, so the correction preview splits the
// minutes with the day rules of the entry's own business date (the evidence's `dayRules`), and the
// deduction is money: shown by permission, whatever the role is called.

const machineTimeZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (machineTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = machineTimeZone;
});

const client = vi.hoisted(() => ({
  createManualCorrection: vi.fn(),
  listForgottenStampInfractions: vi.fn(),
  listWorkers: vi.fn(),
  listShifts: vi.fn(),
}));
const auth = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => auth.value }));

/** The detail page's entry (clock-in 07:00 in Jerusalem), ended at 15:00 after 8 hours. */
const ENDED: CorrectionEntry = {
  id: EVIDENCE.id,
  workerProfileId: EVIDENCE.worker.id,
  workerName: EVIDENCE.worker.fullLegalName,
  status: EVIDENCE.status,
  clockInAt: EVIDENCE.clockInAt,
  clockOutAt: "2026-10-04T12:00:00.000Z",
  rawDurationMinutes: 480,
  unpaidBreakMinutes: 0,
  fullDayCredit: false,
};

/** A custom role that corrects attendance but may not see money. */
const CORRECTOR = myAccess({ roleName: "مصحح الحضور", permissions: [Permission.VIEW_ATTENDANCE, Permission.CORRECT_TIME_ENTRIES] });

function renderDialog(entry: CorrectionEntry) {
  renderWithIntl(<CorrectionDialog entry={entry} onClose={vi.fn()} onSaved={vi.fn()} />, { queryClient: true });
  return screen.getByRole("dialog");
}

function previewRows(dialog: HTMLElement) {
  return within(within(dialog).getByRole("table", { name: "معاينة قبل الحفظ" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => Array.from(row.children).map((cell) => cell.textContent));
}

function correctClockOut(time: string) {
  fireEvent.click(screen.getByRole("radio", { name: "تصحيح وقت إنهاء الدوام" }));
  fireEvent.change(screen.getByLabelText("الوقت الجديد (توقيت القدس)"), { target: { value: time } });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.value = authWithAccess(CORRECTOR, client);
  client.listForgottenStampInfractions.mockResolvedValue([]);
});

describe("CorrectionDialog: the entry's own day rules", () => {
  it("splits with the standard day and overtime threshold of the entry's date", () => {
    // That date's version: an 8-hour day, overtime after 8½ hours.
    const dialog = renderDialog({ ...ENDED, dayRules: { standardDayMinutes: 480, overtimeThresholdMinutes: 510 } });
    correctClockOut("2026-10-04T17:30"); // 10 h 30 m after the 07:00 clock-in

    expect(previewRows(dialog)).toEqual([
      ["مدة العمل", "8 س 0 د", "10 س 30 د"],
      ["ساعات عادية", "8 س 0 د", "8 س 30 د"],
      ["ساعات إضافية", "0 س 0 د", "2 س 0 د"],
    ]);
  });

  it("falls back to the default rules (540 minutes) when the evidence has none", () => {
    const dialog = renderDialog(ENDED);
    correctClockOut("2026-10-04T17:30");

    expect(previewRows(dialog)).toEqual([
      ["مدة العمل", "8 س 0 د", "10 س 30 د"],
      ["ساعات عادية", "8 س 0 د", "9 س 0 د"],
      ["ساعات إضافية", "0 س 0 د", "1 س 30 د"],
    ]);
  });

  it("never shows the deduction to a custom role without money", async () => {
    client.listForgottenStampInfractions.mockResolvedValue(infractions(false).slice(0, 2));
    renderDialog(ENDED);
    fireEvent.change(screen.getByRole("combobox", { name: "السبب" }), { target: { value: "FORGOTTEN_CLOCK_OUT" } });

    expect(await screen.findByText("هذه المخالفة رقم 3 لهذا الشهر")).toBeTruthy();
    expect(document.body.textContent).not.toContain("₪");
    expect(document.body.textContent).not.toContain("سيُخصم");
  });

  it("shows it to a custom role that may see money", async () => {
    auth.value = authWithAccess(myAccess({ roleName: "محاسب", permissions: [Permission.VIEW_ATTENDANCE, Permission.CORRECT_TIME_ENTRIES, Permission.VIEW_FINANCIALS] }), client);
    client.listForgottenStampInfractions.mockResolvedValue(infractions(true).slice(0, 2));
    renderDialog(ENDED);
    fireEvent.change(screen.getByRole("combobox", { name: "السبب" }), { target: { value: "FORGOTTEN_CLOCK_OUT" } });

    expect(await screen.findByText("هذه المخالفة رقم 3 لهذا الشهر")).toBeTruthy();
    expect(screen.getByText("₪ 10.00").closest("p")?.textContent).toBe("سيُخصم ₪ 10.00");
  });
});
