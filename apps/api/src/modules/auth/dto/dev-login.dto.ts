import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class DevLoginDto {
  @ApiProperty({ description: "OrganizationMembership id from GET /auth/dev/users." })
  @IsUUID("all")
  membershipId!: string;

  @ApiPropertyOptional({ example: "admin-web", description: "Client install id, registered as a device exactly like OTP login. Defaults to \"dev-login\"." })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceId?: string;

  @ApiPropertyOptional({ enum: ["IOS", "ANDROID", "WEB"], description: "Defaults to WEB." })
  @IsOptional()
  @IsIn(["IOS", "ANDROID", "WEB"])
  platform?: "IOS" | "ANDROID" | "WEB";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;
}
