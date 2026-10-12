import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from "class-validator";
import { TimeEntryStatus } from "@fieldmaster/shared-types";
import { BUSINESS_DATE_PATTERN, MAX_PAGE_SIZE, UUID_PATTERN } from "../../../common/validation/patterns";

/** `GET /emergency-callouts`: filters on the worker, the call-out's business date and its approval status. */
export class ListEmergencyCalloutsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  workerProfileId?: string;

  @ApiPropertyOptional({ description: "First business date (YYYY-MM-DD, Asia/Jerusalem), inclusive." })
  @IsOptional()
  @Matches(BUSINESS_DATE_PATTERN)
  from?: string;

  @ApiPropertyOptional({ description: "Last business date (YYYY-MM-DD, Asia/Jerusalem), inclusive." })
  @IsOptional()
  @Matches(BUSINESS_DATE_PATTERN)
  to?: string;

  @ApiPropertyOptional({ enum: Object.values(TimeEntryStatus), description: "The approval status of the call-out's time entry." })
  @IsOptional()
  @IsIn(Object.values(TimeEntryStatus))
  status?: TimeEntryStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}
