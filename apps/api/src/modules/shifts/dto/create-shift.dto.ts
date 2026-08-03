import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Min } from "class-validator";
import { CheckInMethod, ShiftType } from "@fieldmaster/shared-types";

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
}
