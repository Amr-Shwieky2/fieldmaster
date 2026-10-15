import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min, IsArray, ArrayMaxSize, Matches } from "class-validator";
import { CheckInMethod, ShiftType } from "@fieldmaster/shared-types";
import { UUID_PATTERN } from "../../../common/validation/patterns";

export class CreateShiftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  geofenceId?: string;

  @ApiProperty({ enum: Object.values(ShiftType) })
  @IsIn(Object.values(ShiftType))
  shiftType!: ShiftType;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsISO8601()
  scheduledStart!: string;

  @ApiProperty()
  @IsISO8601()
  scheduledEnd!: string;

  @ApiPropertyOptional({ enum: Object.values(CheckInMethod), default: CheckInMethod.GEOFENCED })
  @IsOptional()
  @IsIn(Object.values(CheckInMethod))
  checkInMethod?: CheckInMethod;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  graceMinutes?: number;

  @ApiPropertyOptional({ description: "Defaults to the creating manager." })
  @IsOptional()
  @IsString()
  managerId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "Mobile manager mode: the workers, assigned in the same transaction (409 SHIFT_ASSIGNMENT_CONFLICT when one already has an overlapping shift: nothing is created).",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Matches(UUID_PATTERN, { each: true })
  workerProfileIds?: string[];
}
