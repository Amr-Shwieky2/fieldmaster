import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsISO8601, IsOptional, IsString } from "class-validator";

export class AssignTemporarySupervisorDto {
  @ApiProperty()
  @IsString()
  workerProfileId!: string;

  @ApiPropertyOptional({ description: "Defaults to now." })
  @IsOptional()
  @IsISO8601()
  activatedAt?: string;

  @ApiPropertyOptional({ description: "Defaults to the shift's scheduled end." })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
