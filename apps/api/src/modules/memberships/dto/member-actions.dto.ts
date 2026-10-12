import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsString, Matches, MaxLength } from "class-validator";
import { OrgRole } from "@fieldmaster/shared-types";

/** Every change to a member needs a reason; it is stored in the audit log. */
export class MemberActionReasonDto {
  @ApiProperty({ description: "Why (stored in the audit log)." })
  @IsString()
  @Matches(/\S/, { message: "reason must not be blank" })
  @MaxLength(500)
  reason!: string;
}

export class ChangeMemberRoleDto extends MemberActionReasonDto {
  @ApiProperty({ enum: Object.values(OrgRole) })
  @IsIn(Object.values(OrgRole))
  role!: OrgRole;
}

export class SetTimeTrackingDto extends MemberActionReasonDto {
  @ApiProperty()
  @IsBoolean()
  isTimeTrackable!: boolean;
}
