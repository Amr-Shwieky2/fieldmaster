import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, Matches } from "class-validator";
import { UUID_PATTERN, YEAR_MONTH_PATTERN } from "../../../common/validation/patterns";

export class ListForgottenStampsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  workerProfileId?: string;

  @ApiPropertyOptional({ description: "Business month (YYYY-MM, Asia/Jerusalem) the infractions were counted in." })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN)
  month?: string;
}
