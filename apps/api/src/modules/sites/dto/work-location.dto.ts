import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { UUID_PATTERN } from "../../../common/validation/patterns";

/** The geofence radius a work location may have (meters): the same bounds as the organization's default radius. */
export const WORK_LOCATION_RADIUS = { min: 10, max: 5000 } as const;

const NOT_BLANK = /\S/;

export class NewProjectInputDto {
  @ApiProperty()
  @IsString()
  @Matches(NOT_BLANK, { message: "name must not be blank" })
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  client?: string;

  @ApiPropertyOptional({ description: "Only for a member who may see financial amounts (VIEW_FINANCIALS)." })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetAgorot?: number;
}

export class CreateWorkLocationDto {
  @ApiPropertyOptional({ description: "An existing project; or `newProject`." })
  @IsOptional()
  @Matches(UUID_PATTERN)
  projectId?: string;

  @ApiPropertyOptional({ type: NewProjectInputDto, description: "A project created in the same transaction (not for a member restricted to some projects)." })
  @IsOptional()
  @ValidateNested()
  @Type(() => NewProjectInputDto)
  newProject?: NewProjectInputDto;

  @ApiProperty()
  @IsString()
  @Matches(NOT_BLANK, { message: "name must not be blank" })
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiProperty({ minimum: WORK_LOCATION_RADIUS.min, maximum: WORK_LOCATION_RADIUS.max })
  @IsInt()
  @Min(WORK_LOCATION_RADIUS.min)
  @Max(WORK_LOCATION_RADIUS.max)
  geofenceRadiusMeters!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContact?: string;
}

/** Only the fields sent change; `null` clears an optional text. */
export class UpdateWorkLocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK, { message: "name must not be blank" })
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ minimum: WORK_LOCATION_RADIUS.min, maximum: WORK_LOCATION_RADIUS.max })
  @IsOptional()
  @IsInt()
  @Min(WORK_LOCATION_RADIUS.min)
  @Max(WORK_LOCATION_RADIUS.max)
  geofenceRadiusMeters?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContact?: string | null;

  @ApiPropertyOptional({ description: "Why (kept in the audit log)." })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
