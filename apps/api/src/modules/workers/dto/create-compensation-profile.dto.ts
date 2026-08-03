import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from "class-validator";
import { CompensationType } from "@fieldmaster/shared-types";

export class CreateCompensationProfileDto {
  @ApiProperty({ enum: [CompensationType.DAILY, CompensationType.HOURLY] })
  @IsIn([CompensationType.DAILY, CompensationType.HOURLY])
  compensationType!: typeof CompensationType.DAILY | typeof CompensationType.HOURLY;

  @ApiPropertyOptional({ description: "Required when compensationType is DAILY." })
  @ValidateIf((o) => o.compensationType === CompensationType.DAILY)
  @IsInt()
  @Min(0)
  dailyBaseRateAgorot?: number;

  @ApiPropertyOptional({ description: "Required when compensationType is HOURLY." })
  @ValidateIf((o) => o.compensationType === CompensationType.HOURLY)
  @IsInt()
  @Min(0)
  baseHourlyRateAgorot?: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  overtimeHourlyRateAgorot!: number;

  @ApiProperty({ example: "2026-08-01" })
  @IsDateString()
  effectiveStartDate!: string;

  @ApiPropertyOptional({ example: "2026-12-31" })
  @IsOptional()
  @IsDateString()
  effectiveEndDate?: string;

  @ApiProperty({ description: "Why this compensation change is being made." })
  @IsString()
  changeReason!: string;
}
