import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsString, Matches, MaxLength, Max, Min, ValidateIf, IsOptional } from "class-validator";
import { WORK_RULE_LIMITS } from "@fieldmaster/shared-types";
import { BUSINESS_DATE_PATTERN } from "../../../common/validation/patterns";

/** Like `@IsOptional()`, but only for a missing field: `null` is refused instead of reaching a non-nullable column. */
const IsPresentOrAbsent = () => ValidateIf((_object, value) => value !== undefined);

const limits = WORK_RULE_LIMITS;

/**
 * `POST /organizations/me/work-rules`: a new version of the work rules. Only
 * the rules sent change (the rest keep the values in force on the effective
 * date); the version applies from `effectiveFrom` on, never to a day before
 * it, and never earlier than tomorrow.
 */
export class CreateWorkRuleVersionDto {
  @ApiProperty({ description: "The first business date (YYYY-MM-DD, Asia/Jerusalem) the new rules apply to; after today.", example: "2026-11-01" })
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, { message: "effectiveFrom must be a date in the form YYYY-MM-DD" })
  effectiveFrom!: string;

  @ApiProperty({ description: "Why (stored in the audit log and the history).", maxLength: 500 })
  @IsString()
  @Matches(/\S/, { message: "reason must not be blank" })
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ minimum: limits.standardDayMinutes.min, maximum: limits.standardDayMinutes.max })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(limits.standardDayMinutes.min)
  @Max(limits.standardDayMinutes.max)
  standardDayMinutes?: number;

  @ApiPropertyOptional({ minimum: limits.overtimeThresholdMinutes.min, maximum: limits.overtimeThresholdMinutes.max })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(limits.overtimeThresholdMinutes.min)
  @Max(limits.overtimeThresholdMinutes.max)
  overtimeThresholdMinutes?: number;

  @ApiPropertyOptional({ minimum: limits.freeForgottenStampsPerMonth.min, maximum: limits.freeForgottenStampsPerMonth.max })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(limits.freeForgottenStampsPerMonth.min)
  @Max(limits.freeForgottenStampsPerMonth.max)
  freeForgottenStampsPerMonth?: number;

  @ApiPropertyOptional({ description: "Agorot. Money: only for a member who may see financials.", minimum: limits.forgottenStampPenaltyAgorot.min, maximum: limits.forgottenStampPenaltyAgorot.max })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(limits.forgottenStampPenaltyAgorot.min)
  @Max(limits.forgottenStampPenaltyAgorot.max)
  forgottenStampPenaltyAgorot?: number;

  @ApiPropertyOptional({ minimum: limits.emergencyMinutesBefore.min, maximum: limits.emergencyMinutesBefore.max })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(limits.emergencyMinutesBefore.min)
  @Max(limits.emergencyMinutesBefore.max)
  emergencyMinutesBefore?: number;

  @ApiPropertyOptional({ minimum: limits.emergencyMinutesAfter.min, maximum: limits.emergencyMinutesAfter.max })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(limits.emergencyMinutesAfter.min)
  @Max(limits.emergencyMinutesAfter.max)
  emergencyMinutesAfter?: number;

  @ApiPropertyOptional({ minimum: limits.clockInEarlyWindowMinutes.min, maximum: limits.clockInEarlyWindowMinutes.max })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(limits.clockInEarlyWindowMinutes.min)
  @Max(limits.clockInEarlyWindowMinutes.max)
  clockInEarlyWindowMinutes?: number;
}

/** `GET /organizations/me/work-rules/impact?effectiveFrom=...` (default: tomorrow, the earliest a change can take effect). */
export class WorkRulesImpactQueryDto {
  @ApiPropertyOptional({ example: "2026-11-01" })
  @IsOptional()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, { message: "effectiveFrom must be a date in the form YYYY-MM-DD" })
  effectiveFrom?: string;
}

/** `PATCH /organizations/me/settings/owners` */
export class UpdateOwnerLimitDto {
  @ApiProperty({ nullable: true, description: "The most active Owners the organization may have; null = no limit.", minimum: 1, maximum: 100 })
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(100)
  maxOwners!: number | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
