import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, Matches } from "class-validator";
import { YEAR_MONTH_PATTERN } from "../../../common/validation/patterns";

export class EstimatedEarningsQueryDto {
  @ApiPropertyOptional({ description: "Business month (YYYY-MM, Asia/Jerusalem); the current month when omitted." })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN)
  month?: string;
}
