import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { EventOrigin, TaskCategory } from "@fieldmaster/shared-types";

export class ClockOutDto {
  @ApiProperty()
  @IsString()
  deviceId!: string;

  @ApiProperty()
  @IsString()
  clientEventId!: string;

  @ApiProperty()
  @IsISO8601()
  deviceTimestamp!: string;

  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  accuracyMeters!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  altitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationProvider?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  mockLocationSuspected?: boolean;

  @ApiPropertyOptional({ enum: Object.values(EventOrigin), default: EventOrigin.ONLINE })
  @IsOptional()
  @IsIn(Object.values(EventOrigin))
  origin?: EventOrigin;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;

  // ── Mandatory daily summary (spec section 21) ──────────────────────────
  @ApiPropertyOptional({ description: "Required unless voiceNoteUrl is provided." })
  @IsOptional()
  @IsString()
  summaryText?: string;

  @ApiPropertyOptional({ description: "Required unless summaryText is provided." })
  @IsOptional()
  @IsString()
  voiceNoteUrl?: string;

  @ApiProperty({ enum: Object.values(TaskCategory) })
  @IsIn(Object.values(TaskCategory))
  taskCategory!: TaskCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  materialsUsed?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  problemsEncountered?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;
}
