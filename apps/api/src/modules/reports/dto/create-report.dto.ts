import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsIn, IsInt, IsObject, IsOptional, Matches, Max, Min, ValidateNested } from "class-validator";
import { ReportType } from "@fieldmaster/shared-types";
import { BUSINESS_DATE_PATTERN, UUID_PATTERN, YEAR_MONTH_PATTERN } from "../../../common/validation/patterns";
import type { ReportFileFormat } from "../report.types";

/**
 * The filters of `POST /reports` (the contract's `ReportFilters`). Shapes are
 * checked here; which filters a report type takes, and whether the period
 * is valid, in report-filters.ts.
 */
export class ReportFiltersDto {
  @ApiPropertyOptional({ example: "2026-10-01", description: "First business date (Asia/Jerusalem), inclusive." })
  @IsOptional()
  @Matches(BUSINESS_DATE_PATTERN)
  fromDate?: string;

  @ApiPropertyOptional({ example: "2026-10-31", description: "Last business date (Asia/Jerusalem), inclusive." })
  @IsOptional()
  @Matches(BUSINESS_DATE_PATTERN)
  toDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  workerProfileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  siteId?: string;

  @ApiPropertyOptional({ example: "2026-10", description: "PAYROLL (and FORGOTTEN_STAMPS instead of a period)." })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN)
  yearMonth?: string;

  @ApiPropertyOptional({ description: "PAYROLL: the payroll version (the latest when omitted)." })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  version?: number;
}

export class CreateReportDto {
  @ApiProperty({ enum: Object.values(ReportType) })
  @IsIn(Object.values(ReportType))
  reportType!: ReportType;

  @ApiProperty({ type: ReportFiltersDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters!: ReportFiltersDto;
}

/** `GET /reports/:id/download?format=pdf|csv` (PDF when omitted). */
export class DownloadReportQueryDto {
  @ApiPropertyOptional({ enum: ["pdf", "csv"], default: "pdf" })
  @IsOptional()
  @IsIn(["pdf", "csv"])
  format?: ReportFileFormat;
}
