import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsInt, IsOptional, IsString, Min } from "class-validator";

export class CreateProjectDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  client?: string;

  @ApiProperty()
  @IsString()
  projectCode!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: "Owner-only field." })
  @IsOptional()
  @IsInt()
  @Min(0)
  budgetAgorot?: number;
}
