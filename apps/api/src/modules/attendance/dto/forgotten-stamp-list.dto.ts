import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Matches, Max, Min } from "class-validator";
import { MAX_PAGE_SIZE, UUID_PATTERN, YEAR_MONTH_PATTERN } from "../../../common/validation/patterns";

export class ListForgottenStampsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(UUID_PATTERN)
  workerProfileId?: string;

  @ApiPropertyOptional({ description: "Business month (YYYY-MM, Asia/Jerusalem) the infractions were counted in." })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN)
  month?: string;

  @ApiPropertyOptional({ description: "A page of the list (with `pageSize`): the answer is then `{ items, total, page, pageSize }`." })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}
