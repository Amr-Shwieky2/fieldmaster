import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";

export class UpdateOrganizationSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoDeductUnpaidBreaks?: boolean;

  @ApiPropertyOptional({ enum: ["en", "he"] })
  @IsOptional()
  @IsIn(["en", "he"])
  defaultLanguage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  onboardingInvitationTtlHours?: number;
}
