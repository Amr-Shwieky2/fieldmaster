import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsISO8601, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { UUID_PATTERN } from "../../../common/validation/patterns";

export class AssignTemporarySupervisorDto {
  @ApiProperty({ description: "A time-trackable worker assigned to this shift." })
  @Matches(UUID_PATTERN)
  workerProfileId!: string;

  @ApiPropertyOptional({ description: "Defaults to now." })
  @IsOptional()
  @IsISO8601()
  activatedAt?: string;

  @ApiPropertyOptional({ description: "Defaults to the shift's scheduled end." })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({ default: true, description: "May open (and close) temporary check-in points for this shift." })
  @IsOptional()
  @IsBoolean()
  canOpenCheckInPoints?: boolean;
}

export class ReportIssueDto {
  @ApiProperty({ description: "What happened, for the shift's manager and the Owners." })
  @IsString()
  @Matches(/\S/, { message: "text must not be blank" })
  @MaxLength(2000)
  text!: string;
}
