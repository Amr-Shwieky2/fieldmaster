import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Min } from "class-validator";

export class CreateTemporaryCheckInPointDto {
  @ApiProperty()
  @IsString()
  shiftId!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty()
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  radiusMeters?: number;
}
