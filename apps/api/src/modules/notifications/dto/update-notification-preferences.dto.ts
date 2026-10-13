import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, ValidateNested } from "class-validator";
import { NotificationType } from "@fieldmaster/shared-types";

export class NotificationPreferenceInputDto {
  @ApiProperty({ enum: Object.values(NotificationType) })
  @IsIn(Object.values(NotificationType))
  type!: NotificationType;

  @ApiProperty()
  @IsBoolean()
  push!: boolean;
}

/** `PATCH /notifications/preferences` (the contract's `MyNotificationPreferences`): the switches to change; types left out keep theirs. */
export class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceInputDto] })
  @IsArray()
  @ArrayMaxSize(Object.values(NotificationType).length)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceInputDto)
  preferences!: NotificationPreferenceInputDto[];
}
