import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class RegisterDevicePublicKeyDto {
  @ApiProperty({ description: "Client device identifier, matching the deviceId used on clock-in/out and offline-sync requests." })
  @IsString()
  deviceId!: string;

  @ApiProperty({ description: "Base64-encoded 32-byte Ed25519 public key generated on-device." })
  @IsString()
  publicKey!: string;

  @ApiPropertyOptional({ default: "Ed25519" })
  @IsOptional()
  @IsString()
  algorithm?: string;
}
