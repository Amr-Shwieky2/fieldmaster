import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { DevicePlatform } from "@fieldmaster/shared-types";

/** An Expo push token: `ExponentPushToken[...]` or `ExpoPushToken[...]`. */
export const EXPO_PUSH_TOKEN_PATTERN = /^(?:ExponentPushToken|ExpoPushToken)\[[^\s[\]]+\]$/;
export const MAX_PUSH_TOKEN_LENGTH = 200;
export const MAX_VERSION_LENGTH = 50;
export const MAX_DEVICE_ID_LENGTH = 200;
/** What the attestation adapter could tell, as a code (e.g. DEV_MOCK, UNAVAILABLE). */
export const ATTESTATION_STATE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
export const MAX_ATTESTATION_STATE_LENGTH = 40;

/**
 * `PUT /devices/me` (Step 9, the contract's `RegisterDeviceInput`): the
 * signed-in device registers itself on every sign-in and app start. A field
 * left out keeps its stored value; `null` clears it (e.g. `pushToken: null`
 * when the worker turned notifications off).
 */
export class RegisterDeviceDto {
  @ApiProperty({ description: "The app's stable install id (the one sent at sign-in)." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DEVICE_ID_LENGTH)
  deviceId!: string;

  @ApiProperty({ enum: Object.values(DevicePlatform) })
  @IsIn(Object.values(DevicePlatform))
  platform!: DevicePlatform;

  @ApiPropertyOptional({ nullable: true, maxLength: MAX_VERSION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_VERSION_LENGTH)
  osVersion?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: MAX_VERSION_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_VERSION_LENGTH)
  appVersion?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'An Expo push token ("ExponentPushToken[...]" or "ExpoPushToken[...]"), or null.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PUSH_TOKEN_LENGTH)
  @Matches(EXPO_PUSH_TOKEN_PATTERN, { message: 'pushToken must be an Expo push token ("ExponentPushToken[...]" or "ExpoPushToken[...]") or null.' })
  pushToken?: string | null;

  @ApiPropertyOptional({ description: 'What the attestation adapter could tell (dev: "DEV_MOCK"; without one: "UNAVAILABLE").' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ATTESTATION_STATE_LENGTH)
  @Matches(ATTESTATION_STATE_PATTERN, { message: "attestationState must be an upper-case code such as UNAVAILABLE." })
  attestationState?: string;
}
