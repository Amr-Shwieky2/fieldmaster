import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from "class-validator";
import { EventOrigin, MAX_ATTENDANCE_PHOTOS, MockLocationState } from "@fieldmaster/shared-types";
import { LOCATION_SIGNAL_PATTERN, MAX_LOCATION_SIGNALS, MAX_LOCATION_SIGNAL_LENGTH } from "./clock-event-fields";

export class ClockInDto {
  @ApiProperty()
  @IsString()
  shiftId!: string;

  @ApiPropertyOptional({ description: "Use when clocking in at a Temporary Supervisor check-in point instead of the shift's own geofence." })
  @IsOptional()
  @IsString()
  temporaryCheckInPointId?: string;

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

  // ── Step 9: the mobile app ─────────────────────────────────────────────
  @ApiPropertyOptional({
    description: `The caller's own, unused ATTENDANCE_PHOTO uploads (POST /attachments), at most ${MAX_ATTENDANCE_PHOTOS}; linked to the time entry.`,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ATTENDANCE_PHOTOS)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  photoAssetIds?: string[];

  @ApiPropertyOptional({
    enum: Object.values(MockLocationState),
    description: "What the phone could tell about a fake location. DETECTED is refused exactly like mockLocationSuspected: true.",
  })
  @IsOptional()
  @IsIn(Object.values(MockLocationState))
  mockLocationState?: MockLocationState;

  @ApiPropertyOptional({ description: "Movement heuristics that looked suspicious (e.g. IMPOSSIBLE_SPEED); recorded for review, never a refusal.", type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LOCATION_SIGNALS)
  @IsString({ each: true })
  @MaxLength(MAX_LOCATION_SIGNAL_LENGTH, { each: true })
  @Matches(LOCATION_SIGNAL_PATTERN, { each: true })
  locationSignals?: string[];
}
