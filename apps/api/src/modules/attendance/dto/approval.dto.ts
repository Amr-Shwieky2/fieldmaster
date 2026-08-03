import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class FullDayCreditDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}

export class ApproveTimeEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RejectTimeEntryDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}

export class RequestCorrectionDto {
  @ApiProperty()
  @IsString()
  notes!: string;
}
