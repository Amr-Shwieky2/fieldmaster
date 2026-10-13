import type { DashboardDay, DashboardWorkerCost, FinancialDashboard } from "@fieldmaster/api-client";

/**
 * Step 7 test data: `GET /payroll-periods/2026-10/dashboard` for an Owner.
 * Money is integer agorot (123456 = ₪ 1,234.56); the amounts are chosen so
 * each one appears once on the page.
 */

/** Twelve workers with pay this month, highest net payable first (the API's order). */
export const WORKER_COSTS: DashboardWorkerCost[] = [
  { workerProfileId: "wp-1", fullLegalName: "خالد ناصر", approvedShifts: 22, overtimeMinutes: 540, laborCostAgorot: 980000, netPayableAgorot: 965000 },
  { workerProfileId: "wp-2", fullLegalName: "سلمى حداد", approvedShifts: 21, overtimeMinutes: 300, laborCostAgorot: 870500, netPayableAgorot: 870000 },
  { workerProfileId: "wp-3", fullLegalName: "يوسف عيسى", approvedShifts: 20, overtimeMinutes: 120, laborCostAgorot: 760500, netPayableAgorot: 755000 },
  { workerProfileId: "wp-4", fullLegalName: "مريم خوري", approvedShifts: 19, overtimeMinutes: 0, laborCostAgorot: 640500, netPayableAgorot: 640000 },
  { workerProfileId: "wp-5", fullLegalName: "أحمد سليمان", approvedShifts: 18, overtimeMinutes: 60, laborCostAgorot: 530500, netPayableAgorot: 530000 },
  { workerProfileId: "wp-6", fullLegalName: "رنا عودة", approvedShifts: 15, overtimeMinutes: 0, laborCostAgorot: 420500, netPayableAgorot: 420000 },
  { workerProfileId: "wp-7", fullLegalName: "سامي بشارة", approvedShifts: 12, overtimeMinutes: 0, laborCostAgorot: 310500, netPayableAgorot: 310000 },
  { workerProfileId: "wp-8", fullLegalName: "ليلى منصور", approvedShifts: 10, overtimeMinutes: 0, laborCostAgorot: 250500, netPayableAgorot: 250000 },
  { workerProfileId: "wp-9", fullLegalName: "طارق حمدان", approvedShifts: 8, overtimeMinutes: 0, laborCostAgorot: 190500, netPayableAgorot: 190000 },
  { workerProfileId: "wp-10", fullLegalName: "هالة زيدان", approvedShifts: 6, overtimeMinutes: 0, laborCostAgorot: 150500, netPayableAgorot: 150000 },
  { workerProfileId: "wp-11", fullLegalName: "نبيل جبران", approvedShifts: 4, overtimeMinutes: 0, laborCostAgorot: 90500, netPayableAgorot: 90000 },
  { workerProfileId: "wp-12", fullLegalName: "دينا سابا", approvedShifts: 2, overtimeMinutes: 0, laborCostAgorot: 40500, netPayableAgorot: 40000 },
];

/** October 1-7; the 7th is an overtime spike. */
export const DAILY_TREND: DashboardDay[] = [
  { date: "2026-10-01", laborCostAgorot: 150100, overtimeAgorot: 0, overtimeMinutes: 0, isOvertimeSpike: false },
  { date: "2026-10-02", laborCostAgorot: 180200, overtimeAgorot: 15000, overtimeMinutes: 60, isOvertimeSpike: false },
  { date: "2026-10-03", laborCostAgorot: 0, overtimeAgorot: 0, overtimeMinutes: 0, isOvertimeSpike: false },
  { date: "2026-10-04", laborCostAgorot: 170300, overtimeAgorot: 7500, overtimeMinutes: 30, isOvertimeSpike: false },
  { date: "2026-10-05", laborCostAgorot: 160400, overtimeAgorot: 0, overtimeMinutes: 0, isOvertimeSpike: false },
  { date: "2026-10-06", laborCostAgorot: 175500, overtimeAgorot: 12000, overtimeMinutes: 50, isOvertimeSpike: false },
  { date: "2026-10-07", laborCostAgorot: 240600, overtimeAgorot: 52500, overtimeMinutes: 420, isOvertimeSpike: true },
];

export const FINANCIALS: FinancialDashboard = {
  yearMonth: "2026-10",
  source: "LIVE",
  finalizedVersion: null,
  netPayableAgorot: 1234567,
  laborCostAgorot: 1250000,
  previousMonth: { yearMonth: "2026-09", source: "FINALIZED", netPayableAgorot: 1000000, laborCostAgorot: 1010000 },
  costByProject: [
    { id: "p1", name: "Highway 6 signs", approvedShifts: 40, laborCostAgorot: 800000, overtimeAgorot: 60000 },
    { id: null, name: null, approvedShifts: 2, laborCostAgorot: 200000, overtimeAgorot: 0 },
  ],
  costBySite: [
    { id: "s1", name: "تقاطع الشمال", projectName: "Highway 6 signs", approvedShifts: 30, laborCostAgorot: 600000, overtimeAgorot: 45000 },
    { id: "s2", name: "جسر الوادي", projectName: "Highway 6 signs", approvedShifts: 10, laborCostAgorot: 200100, overtimeAgorot: 15000 },
    { id: null, name: null, projectName: null, approvedShifts: 2, laborCostAgorot: 199900, overtimeAgorot: 0 },
  ],
  costByWorker: WORKER_COSTS,
  topEarners: WORKER_COSTS.slice(0, 5),
  overtime: {
    totalAgorot: 98050,
    totalMinutes: 1020,
    averageDailyMinutes: 90,
    spikeFactor: 2,
    spikeMinimumMinutes: 120,
    spikes: [
      {
        date: "2026-10-07",
        overtimeMinutes: 420,
        overtimeAgorot: 52500,
        thresholdMinutes: 180,
        workers: [
          { workerProfileId: "wp-1", fullLegalName: "خالد ناصر", overtimeMinutes: 240 },
          { workerProfileId: "wp-2", fullLegalName: "سلمى حداد", overtimeMinutes: 180 },
        ],
      },
    ],
  },
  forgottenStamps: { penalties: 3, penaltiesAgorot: 20000, reversals: 1, reversalsAgorot: 5000, netDeductionsAgorot: 15000 },
  emergencies: { callouts: 2, compensatedMinutes: 330, costAgorot: 64000 },
  dailyTrend: DAILY_TREND,
  pendingApproval: { entries: 3, exposureAgorot: 432100, entriesWithoutCompensation: 1 },
  workersWithoutCompensation: [{ workerProfileId: "wp-13", fullLegalName: "رامي سعيد", entries: 2 }],
};

/** A copy of FINANCIALS with some fields replaced. */
export function financials(overrides: Partial<FinancialDashboard> = {}): FinancialDashboard {
  return { ...FINANCIALS, ...overrides };
}
