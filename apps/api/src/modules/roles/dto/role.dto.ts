import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength, Matches } from "class-validator";
import { ALL_PERMISSIONS } from "@fieldmaster/shared-types";

/** `POST /roles`: a custom role. */
export class CreateRoleDto {
  @ApiProperty({ minLength: 2, maxLength: 60 })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/\S{2}/, { message: "name must not be blank" })
  name!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiProperty({ type: [String], description: "Permission names from the catalog; every permission must come with the ones it requires." })
  @IsArray()
  @ArrayMaxSize(ALL_PERMISSIONS.length)
  @IsString({ each: true })
  permissions!: string[];
}

/** `PATCH /roles/:id`: only the fields sent change. A reason is stored with the audit. */
export class UpdateRoleDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @Matches(/\S{2}/, { message: "name must not be blank" })
  name?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ALL_PERMISSIONS.length)
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ArchiveRoleDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
