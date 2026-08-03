import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Min } from "class-validator";

export class CreateGeofenceDto {
  @ApiProperty()
  @IsString()
  siteId!: string;

  @ApiProperty()
  @IsLatitude()
  centerLatitude!: number;

  @ApiProperty()
  @IsLongitude()
  centerLongitude!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  radiusMeters!: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  minAccuracyMeters?: number;
}
