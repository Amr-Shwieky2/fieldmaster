import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class CreateInvitationDto {
  @ApiPropertyOptional({ example: "+972501234567" })
  @IsOptional()
  @IsString()
  prefilledPhoneNumber?: string;
}
