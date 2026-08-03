import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsIn, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { TaskCategory } from "@fieldmaster/shared-types";

export class StartEmergencyCalloutDto {
  @ApiPropertyOptional({ description: "Provide when starting from a specific Night Turan assignment." })
  @IsOptional()
  @IsString()
  turanAssignmentId?: string;

  @ApiPropertyOptional({ description: "Manager-only: workerProfileId to start on behalf of, granting manual authorization." })
  @IsOptional()
  @IsString()
  workerProfileId?: string;

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
}

export class EndEmergencyCalloutDto {
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
  @IsString()
  summaryText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voiceNoteUrl?: string;

  @ApiProperty({ enum: Object.values(TaskCategory) })
  @IsIn(Object.values(TaskCategory))
  taskCategory!: TaskCategory;
}
