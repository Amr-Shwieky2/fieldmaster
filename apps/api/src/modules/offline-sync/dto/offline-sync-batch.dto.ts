import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from "class-validator";
import { ClockEventType, TaskCategory } from "@fieldmaster/shared-types";

export class OfflineSyncEventInputDto {
  @ApiProperty({ description: "Client-generated unique ID for this event (per device)." })
  @IsString()
  clientEventId!: string;

  @ApiProperty({ enum: Object.values(ClockEventType) })
  @IsIn(Object.values(ClockEventType))
  eventType!: ClockEventType;

  @ApiPropertyOptional({ description: "Required for CLOCK_IN." })
  @IsOptional()
  @IsString()
  shiftId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  temporaryCheckInPointId?: string;

  @ApiProperty({ description: "The device's own clock at the moment the worker tapped clock-in/out, captured while offline." })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;

  // ── Clock-out only (mirrors ClockOutDto's mandatory-summary fields) ────
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summaryText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voiceNoteUrl?: string;

  @ApiPropertyOptional({ enum: Object.values(TaskCategory) })
  @IsOptional()
  @IsIn(Object.values(TaskCategory))
  taskCategory?: TaskCategory;

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

  @ApiProperty({
    description:
      "Base64 Ed25519 detached signature, produced on-device with the device's private key, over the deterministic (sorted-key) JSON encoding of this event's signable fields (everything above except `signature` itself).",
  })
  @IsString()
  signature!: string;
}

export class OfflineSyncBatchDto {
  @ApiProperty({ description: "Client device identifier; must have a registered public key via POST /devices/public-key." })
  @IsString()
  deviceId!: string;

  @ApiProperty({ type: [OfflineSyncEventInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OfflineSyncEventInputDto)
  events!: OfflineSyncEventInputDto[];
}
