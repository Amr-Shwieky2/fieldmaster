import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, Max, Min, ValidateIf, ValidateNested } from "class-validator";
import { CONFIGURABLE_NOTIFICATIONS } from "../../../common/settings/organization-settings.service";

/**
 * Like `@IsOptional()`, but only for a missing field: `null` is validated
 * (and refused) instead of reaching a non-nullable settings column.
 */
const IsPresentOrAbsent = () => ValidateIf((_object, value) => value !== undefined);

/** `PATCH /organizations/me/settings/workday`: only the fields sent change. */
export class UpdateWorkdaySettingsDto {
  @ApiPropertyOptional({ description: "Default grace minutes of a new shift.", minimum: 0, maximum: 120 })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(0)
  @Max(120)
  defaultGraceMinutes?: number;

  @ApiPropertyOptional({ description: "Default geofence radius of a new site (meters).", minimum: 10, maximum: 5000 })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(10)
  @Max(5000)
  defaultGeofenceRadiusMeters?: number;

  @ApiPropertyOptional({ description: "Required GPS accuracy of a new geofence (meters).", minimum: 5, maximum: 500 })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(5)
  @Max(500)
  defaultMinGpsAccuracyMeters?: number;

  @ApiPropertyOptional({ description: "Largest device-clock deviation accepted online (seconds).", minimum: 10, maximum: 3600 })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(10)
  @Max(3600)
  deviceTimeDeviationSeconds?: number;

  @ApiPropertyOptional({ description: "Default radius of a new temporary check-in point (meters).", minimum: 10, maximum: 2000 })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(10)
  @Max(2000)
  temporaryPointRadiusMeters?: number;

  @ApiPropertyOptional({ description: "Required GPS accuracy at a temporary check-in point (meters).", minimum: 5, maximum: 500 })
  @IsPresentOrAbsent()
  @IsInt()
  @Min(5)
  @Max(500)
  temporaryPointMinAccuracyMeters?: number;

  @ApiPropertyOptional()
  @IsPresentOrAbsent()
  @IsBoolean()
  autoDeductUnpaidBreaks?: boolean;
}

/** `PATCH /organizations/me/settings/onboarding`. */
export class UpdateOnboardingSettingsDto {
  @ApiProperty({ description: "How long an onboarding invitation stays valid (hours).", minimum: 1, maximum: 720 })
  @IsInt()
  @Min(1)
  @Max(720)
  invitationTtlHours!: number;
}

export class NotificationPreferenceDto {
  @ApiProperty({ enum: Object.keys(CONFIGURABLE_NOTIFICATIONS) })
  @IsIn(Object.keys(CONFIGURABLE_NOTIFICATIONS))
  type!: keyof typeof CONFIGURABLE_NOTIFICATIONS;

  @ApiPropertyOptional()
  @IsPresentOrAbsent()
  @IsBoolean()
  owners?: boolean;

  @ApiPropertyOptional()
  @IsPresentOrAbsent()
  @IsBoolean()
  fieldManagers?: boolean;
}

/** `PATCH /organizations/me/settings/notifications`: the events sent change, the rest keep their current choice. */
export class UpdateNotificationSettingsDto {
  @ApiProperty({ type: [NotificationPreferenceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  preferences!: NotificationPreferenceDto[];
}
