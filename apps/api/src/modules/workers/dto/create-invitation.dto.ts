import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { isValidE164PhoneNumber } from "@fieldmaster/shared-validation";
import { Satisfies, TrimmedOrAbsent } from "./validation";

export class CreateInvitationDto {
  @ApiPropertyOptional({ example: "+972501234567", description: "E.164. When set, the application must use this phone number." })
  @TrimmedOrAbsent()
  @IsOptional()
  @IsString()
  @Satisfies(isValidE164PhoneNumber, "prefilledPhoneNumber must be an international (E.164) phone number")
  prefilledPhoneNumber?: string;
}
