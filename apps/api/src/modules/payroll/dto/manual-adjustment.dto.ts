import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { PayrollAdjustmentType } from "@fieldmaster/shared-types";
import { UUID_PATTERN } from "../../../common/validation/patterns";

/** Something other than whitespace. */
const NOT_BLANK = /\S/;

export class CreateManualAdjustmentDto {
  @ApiProperty()
  @IsString()
  @Matches(UUID_PATTERN)
  workerProfileId!: string;

  @ApiProperty({ enum: [PayrollAdjustmentType.MANUAL_DEDUCTION, PayrollAdjustmentType.MANUAL_BONUS] })
  @IsIn([PayrollAdjustmentType.MANUAL_DEDUCTION, PayrollAdjustmentType.MANUAL_BONUS])
  type!: typeof PayrollAdjustmentType.MANUAL_DEDUCTION | typeof PayrollAdjustmentType.MANUAL_BONUS;

  /** At most ₪1,000,000 in one adjustment: keeps monthly sums far inside a 32-bit integer column. */
  @ApiProperty({ description: "Positive magnitude in agorot; sign is derived from type.", minimum: 1, maximum: 100_000_000 })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountAgorot!: number;

  @ApiProperty({ description: "Why (required, stored and shown in the audit log)." })
  @IsString()
  @Matches(NOT_BLANK, { message: "reason must not be blank" })
  @MaxLength(500)
  reason!: string;
}

export class ReopenPeriodDto {
  @ApiProperty({ description: "Why the finalized version is reopened (required, stored on the new version and in the audit log)." })
  @IsString()
  @Matches(NOT_BLANK, { message: "reason must not be blank" })
  @MaxLength(500)
  reason!: string;
}
