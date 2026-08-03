import { CompensationType, STANDARD_DAY_MINUTES } from "@fieldmaster/shared-types";

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

export function calculateDailyCompensation(
  input: DailyCompensationInput,
): DailyCompensationResult {
  const { dailyBaseRateAgorot, overtimeHourlyRateAgorot, approvedMinutes, fullDayCredit } = input;

  if (approvedMinutes >= STANDARD_DAY_MINUTES) {
    const overtimeMinutes = approvedMinutes - STANDARD_DAY_MINUTES;
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

  const proratedAgorot = Math.round((dailyBaseRateAgorot * approvedMinutes) / STANDARD_DAY_MINUTES);
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
): HourlyCompensationResult {
  const { baseHourlyRateAgorot, overtimeHourlyRateAgorot, approvedMinutes, fullDayCredit } = input;

  if (approvedMinutes < STANDARD_DAY_MINUTES && fullDayCredit) {
    return {
      regularMinutes: STANDARD_DAY_MINUTES,
      overtimeMinutes: 0,
      regularCompensationAgorot: proportionalAgorot(baseHourlyRateAgorot, STANDARD_DAY_MINUTES),
      overtimeCompensationAgorot: 0,
      totalCompensationAgorot: proportionalAgorot(baseHourlyRateAgorot, STANDARD_DAY_MINUTES),
    };
  }

  const regularMinutes = Math.min(approvedMinutes, STANDARD_DAY_MINUTES);
  const overtimeMinutes = Math.max(0, approvedMinutes - STANDARD_DAY_MINUTES);
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

export function calculateShiftCompensation(input: CompensationCalcInput): {
  totalCompensationAgorot: number;
  regularMinutes: number;
  overtimeMinutes: number;
} {
  if (input.compensationType === CompensationType.DAILY) {
    if (input.dailyBaseRateAgorot === undefined) {
      throw new Error("dailyBaseRateAgorot is required for DAILY compensation");
    }
    const result = calculateDailyCompensation({
      dailyBaseRateAgorot: input.dailyBaseRateAgorot,
      overtimeHourlyRateAgorot: input.overtimeHourlyRateAgorot,
      approvedMinutes: input.approvedMinutes,
      fullDayCredit: input.fullDayCredit,
    });
    return {
      totalCompensationAgorot: result.totalCompensationAgorot,
      regularMinutes: Math.min(input.approvedMinutes, STANDARD_DAY_MINUTES),
      overtimeMinutes: result.overtimeMinutes,
    };
  }

  if (input.baseHourlyRateAgorot === undefined) {
    throw new Error("baseHourlyRateAgorot is required for HOURLY compensation");
  }
  const result = calculateHourlyCompensation({
    baseHourlyRateAgorot: input.baseHourlyRateAgorot,
    overtimeHourlyRateAgorot: input.overtimeHourlyRateAgorot,
    approvedMinutes: input.approvedMinutes,
    fullDayCredit: input.fullDayCredit,
  });
  return {
    totalCompensationAgorot: result.totalCompensationAgorot,
    regularMinutes: result.regularMinutes,
    overtimeMinutes: result.overtimeMinutes,
  };
}
