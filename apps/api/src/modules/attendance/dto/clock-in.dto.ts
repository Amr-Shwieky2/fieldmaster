import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { EventOrigin } from "@fieldmaster/shared-types";

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
}
