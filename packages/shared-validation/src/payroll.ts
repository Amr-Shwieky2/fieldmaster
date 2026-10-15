import { CompensationType } from "@fieldmaster/shared-types";
import type { DayRules } from "./attendance";

/**
 * All monetary values are integer agorot (1 ILS = 100 agorot). Every
 * function here does integer numerator/denominator division with a single
 * rounding step at the end -- never chained float arithmetic -- so payroll
 * results are deterministic and reproducible.
 */
function proportionalAgorot(rateAgorotPerHour: number, minutes: number): number {
  return Math.round((rateAgorotPerHour * minutes) / 60);
}

export interface DailyCompensationInput {
  dailyBaseRateAgorot: number;
  overtimeHourlyRateAgorot: number;
  approvedMinutes: number;
  fullDayCredit: boolean;
}

export interface DailyCompensationResult {
  standardDaysCredited: number;
  baseCompensationAgorot: number;
  overtimeMinutes: number;
  overtimeCompensationAgorot: number;
  totalCompensationAgorot: number;
}

/**
 * `rules` are the work rules in force on the entry's business date (the
 * standard day and the overtime threshold). Required: a caller always prices
 * with the organization's rules, never a default.
 */
export function calculateDailyCompensation(
  input: DailyCompensationInput,
  rules: DayRules,
): DailyCompensationResult {
  const { dailyBaseRateAgorot, overtimeHourlyRateAgorot, approvedMinutes, fullDayCredit } = input;

  if (approvedMinutes >= rules.standardDayMinutes) {
    const overtimeMinutes = Math.max(0, approvedMinutes - rules.overtimeThresholdMinutes);
    const overtimeCompensationAgorot = proportionalAgorot(overtimeHourlyRateAgorot, overtimeMinutes);
    return {
      standardDaysCredited: 1,
      baseCompensationAgorot: dailyBaseRateAgorot,
      overtimeMinutes,
      overtimeCompensationAgorot,
      totalCompensationAgorot: dailyBaseRateAgorot + overtimeCompensationAgorot,
    };
  }

  if (fullDayCredit) {
    return {
      standardDaysCredited: 1,
      baseCompensationAgorot: dailyBaseRateAgorot,
      overtimeMinutes: 0,
      overtimeCompensationAgorot: 0,
      totalCompensationAgorot: dailyBaseRateAgorot,
    };
  }

  const proratedAgorot = Math.round((dailyBaseRateAgorot * approvedMinutes) / rules.standardDayMinutes);
  return {
    standardDaysCredited: 0,
    baseCompensationAgorot: proratedAgorot,
    overtimeMinutes: 0,
    overtimeCompensationAgorot: 0,
    totalCompensationAgorot: proratedAgorot,
  };
}

export interface HourlyCompensationInput {
  baseHourlyRateAgorot: number;
  overtimeHourlyRateAgorot: number;
  approvedMinutes: number;
  fullDayCredit: boolean;
}

export interface HourlyCompensationResult {
  regularMinutes: number;
  overtimeMinutes: number;
  regularCompensationAgorot: number;
  overtimeCompensationAgorot: number;
  totalCompensationAgorot: number;
}

export function calculateHourlyCompensation(
  input: HourlyCompensationInput,
  rules: DayRules,
): HourlyCompensationResult {
  const { baseHourlyRateAgorot, overtimeHourlyRateAgorot, approvedMinutes, fullDayCredit } = input;

  if (approvedMinutes < rules.standardDayMinutes && fullDayCredit) {
    return {
      regularMinutes: rules.standardDayMinutes,
      overtimeMinutes: 0,
      regularCompensationAgorot: proportionalAgorot(baseHourlyRateAgorot, rules.standardDayMinutes),
      overtimeCompensationAgorot: 0,
      totalCompensationAgorot: proportionalAgorot(baseHourlyRateAgorot, rules.standardDayMinutes),
    };
  }

  const regularMinutes = Math.min(approvedMinutes, rules.overtimeThresholdMinutes);
  const overtimeMinutes = Math.max(0, approvedMinutes - rules.overtimeThresholdMinutes);
  const regularCompensationAgorot = proportionalAgorot(baseHourlyRateAgorot, regularMinutes);
  const overtimeCompensationAgorot = proportionalAgorot(overtimeHourlyRateAgorot, overtimeMinutes);

  return {
    regularMinutes,
    overtimeMinutes,
    regularCompensationAgorot,
    overtimeCompensationAgorot,
    totalCompensationAgorot: regularCompensationAgorot + overtimeCompensationAgorot,
  };
}

export interface CompensationCalcInput {
  compensationType: CompensationType;
  approvedMinutes: number;
  fullDayCredit: boolean;
  dailyBaseRateAgorot?: number;
  baseHourlyRateAgorot?: number;
  overtimeHourlyRateAgorot: number;
}

export function calculateShiftCompensation(input: CompensationCalcInput, rules: DayRules): {
  totalCompensationAgorot: number;
  regularMinutes: number;
  overtimeMinutes: number;
} {
  if (input.compensationType === CompensationType.DAILY) {
    if (input.dailyBaseRateAgorot === undefined) {
      throw new Error("dailyBaseRateAgorot is required for DAILY compensation");
    }
    const result = calculateDailyCompensation(
      {
        dailyBaseRateAgorot: input.dailyBaseRateAgorot,
        overtimeHourlyRateAgorot: input.overtimeHourlyRateAgorot,
        approvedMinutes: input.approvedMinutes,
        fullDayCredit: input.fullDayCredit,
      },
      rules,
    );
    return {
      totalCompensationAgorot: result.totalCompensationAgorot,
      regularMinutes: Math.min(input.approvedMinutes, rules.overtimeThresholdMinutes),
      overtimeMinutes: result.overtimeMinutes,
    };
  }

  if (input.baseHourlyRateAgorot === undefined) {
    throw new Error("baseHourlyRateAgorot is required for HOURLY compensation");
  }
  const result = calculateHourlyCompensation(
    {
      baseHourlyRateAgorot: input.baseHourlyRateAgorot,
      overtimeHourlyRateAgorot: input.overtimeHourlyRateAgorot,
      approvedMinutes: input.approvedMinutes,
      fullDayCredit: input.fullDayCredit,
    },
    rules,
  );
  return {
    totalCompensationAgorot: result.totalCompensationAgorot,
    regularMinutes: result.regularMinutes,
    overtimeMinutes: result.overtimeMinutes,
  };
}
