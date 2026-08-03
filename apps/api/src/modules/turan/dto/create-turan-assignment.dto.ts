import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString } from "class-validator";
import { TuranType } from "@fieldmaster/shared-types";

export class CreateTuranAssignmentDto {
  @ApiProperty({ enum: Object.values(TuranType) })
  @IsIn(Object.values(TuranType))
  turanType!: TuranType;

  @ApiProperty()
  @IsISO8601()
  startAt!: string;

  @ApiProperty()
  @IsISO8601()
  endAt!: string;

  @ApiProperty()
  @IsString()
  assignedWorkerProfileId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  backupWorkerProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: "Set true to proceed despite an overlapping assignment for this worker." })
  @IsOptional()
  @IsBoolean()
  confirmOverlap?: boolean;
}
