import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class VerifyOtpDto {
  @ApiProperty({ example: "+972501234567" })
  @IsString()
  phoneNumber!: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  @Length(4, 8)
  code!: string;

  @ApiProperty({ example: "device-uuid-or-install-id" })
  @IsString()
  deviceId!: string;

  @ApiProperty({ enum: ["IOS", "ANDROID", "WEB"] })
  @IsIn(["IOS", "ANDROID", "WEB"])
  platform!: "IOS" | "ANDROID" | "WEB";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pushToken?: string;

  @ApiPropertyOptional({ description: "Required when the user belongs to more than one organization." })
  @IsOptional()
  @IsString()
  organizationId?: string;
}
