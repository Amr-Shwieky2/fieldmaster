import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsOptional, Matches, Max, Min } from "class-validator";
import { AttendanceFlag, AttendanceListTab, ShiftType } from "@fieldmaster/shared-types";
import { BUSINESS_DATE_PATTERN, MAX_PAGE_SIZE, UUID_PATTERN } from "../../../common/validation/patterns";

/** `GET /attendance/entries`: the admin attendance list (tabs, filters, pagination). */
export class ListAttendanceQueryDto {
  @ApiPropertyOptional({ enum: Object.values(AttendanceListTab), default: AttendanceListTab.PENDING })
  @IsOptional()
  @IsIn(Object.values(AttendanceListTab))
  tab?: AttendanceListTab;

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

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  siteId?: string;

  @ApiPropertyOptional({ enum: Object.values(ShiftType) })
  @IsOptional()
  @IsIn(Object.values(ShiftType))
  shiftType?: ShiftType;

  @ApiPropertyOptional({ description: "Comma-separated; an entry must carry every listed flag.", enum: Object.values(AttendanceFlag), isArray: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter((flag) => flag.length > 0) : value))
  @IsArray()
  @IsIn(Object.values(AttendanceFlag), { each: true })
  flags?: AttendanceFlag[];

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
