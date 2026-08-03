import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";
import { CorrectionReason } from "@fieldmaster/shared-types";

export const CorrectionField = {
  CLOCK_IN: "CLOCK_IN",
  CLOCK_OUT: "CLOCK_OUT",
  UNPAID_BREAK_MINUTES: "UNPAID_BREAK_MINUTES",
} as const;
export type CorrectionField = (typeof CorrectionField)[keyof typeof CorrectionField];

export class CreateManualCorrectionDto {
  @ApiPropertyOptional({ description: "Omit to create a brand-new time entry for a fully missed clock-in." })
  @IsOptional()
  @IsString()
  timeEntryId?: string;

  @ApiPropertyOptional({ description: "Required when timeEntryId is omitted." })
  @IsOptional()
  @IsString()
  shiftId?: string;

  @ApiPropertyOptional({ description: "Required when timeEntryId is omitted." })
  @IsOptional()
  @IsString()
  workerProfileId?: string;

  @ApiProperty({ enum: Object.values(CorrectionField) })
  @IsIn(Object.values(CorrectionField))
  field!: CorrectionField;

  @ApiProperty({ description: "ISO datetime for CLOCK_IN/CLOCK_OUT, integer string for UNPAID_BREAK_MINUTES." })
  @IsString()
  newValue!: string;

  @ApiProperty({ enum: Object.values(CorrectionReason) })
  @IsIn(Object.values(CorrectionReason))
  reason!: CorrectionReason;

  @ApiPropertyOptional({ description: "Required when reason is OTHER." })
  @IsOptional()
  @IsString()
  note?: string;
}
