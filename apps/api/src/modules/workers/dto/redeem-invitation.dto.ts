import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

export class RedeemInvitationDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty()
  @IsString()
  phoneNumber!: string;

  @ApiProperty()
  @IsString()
  fullLegalName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferredName?: string;

  @ApiPropertyOptional({ enum: ["en", "he"] })
  @IsOptional()
  @IsIn(["en", "he"])
  preferredLanguage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  governmentIdType?: string;

  @ApiProperty({ description: "Bank name" })
  @IsString()
  bankName!: string;

  @ApiProperty()
  @IsString()
  branchNumber!: string;

  @ApiProperty()
  @IsString()
  accountNumber!: string;

  @ApiProperty()
  @IsString()
  accountHolderName!: string;

  @ApiProperty({ description: "Must be true; consent is mandatory to submit an application." })
  @IsIn([true])
  consentAccepted!: boolean;

  @ApiProperty()
  @IsString()
  privacyNoticeVersion!: string;
}
