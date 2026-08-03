import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Min } from "class-validator";
import { PayrollAdjustmentType } from "@fieldmaster/shared-types";

export class CreateManualAdjustmentDto {
  @ApiProperty()
  @IsString()
  workerProfileId!: string;

  @ApiProperty({ enum: [PayrollAdjustmentType.MANUAL_DEDUCTION, PayrollAdjustmentType.MANUAL_BONUS] })
  @IsIn([PayrollAdjustmentType.MANUAL_DEDUCTION, PayrollAdjustmentType.MANUAL_BONUS])
  type!: typeof PayrollAdjustmentType.MANUAL_DEDUCTION | typeof PayrollAdjustmentType.MANUAL_BONUS;

  @ApiProperty({ description: "Positive magnitude in agorot; sign is derived from type." })
  @IsInt()
  @Min(1)
  amountAgorot!: number;

  @ApiProperty()
  @IsString()
  reason!: string;
}

export class ReopenPeriodDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
