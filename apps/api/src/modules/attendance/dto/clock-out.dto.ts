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
import { EventOrigin, MAX_ATTENDANCE_PHOTOS, MockLocationState, SummarySource, TaskCategory } from "@fieldmaster/shared-types";
import { MAX_TRANSCRIPTION_LENGTH } from "../../attachments/transcription";
import { LOCATION_SIGNAL_PATTERN, MAX_LOCATION_SIGNALS, MAX_LOCATION_SIGNAL_LENGTH } from "./clock-event-fields";

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
  @ApiPropertyOptional({ description: "Required unless a voice note (voiceNoteAssetId, or the legacy voiceNoteUrl) is provided." })
  @IsOptional()
  @IsString()
  summaryText?: string;

  @ApiPropertyOptional({ description: "Legacy (before Step 9): a voice note URL. The mobile app sends voiceNoteAssetId instead." })
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

  // ── Step 9: the mobile app ─────────────────────────────────────────────
  @ApiPropertyOptional({
    enum: Object.values(SummarySource),
    description: "TYPED, or VOICE (recorded, transcribed, possibly edited). Default: VOICE with a voiceNoteAssetId, otherwise TYPED.",
  })
  @IsOptional()
  @IsIn(Object.values(SummarySource))
  summarySource?: SummarySource;

  @ApiPropertyOptional({ description: "The caller's own, unused VOICE_SUMMARY upload (POST /attachments); satisfies the summary requirement." })
  @IsOptional()
  @IsUUID("all")
  voiceNoteAssetId?: string;

  @ApiPropertyOptional({ description: `The transcript as the service returned it, before the worker's edits (at most ${MAX_TRANSCRIPTION_LENGTH} characters).` })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TRANSCRIPTION_LENGTH)
  transcription?: string;

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
