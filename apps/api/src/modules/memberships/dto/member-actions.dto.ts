import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";
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
  @ApiPropertyOptional({ enum: [OrgRole.OWNER, OrgRole.FIELD_MANAGER, OrgRole.WORKER], description: "A built-in role. Send this or `roleId`." })
  @IsOptional()
  @IsIn([OrgRole.OWNER, OrgRole.FIELD_MANAGER, OrgRole.WORKER])
  role?: OrgRole;

  @ApiPropertyOptional({ description: "Any role of the organization (a custom role, or a built-in one). Send this or `role`." })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}

export class SetTimeTrackingDto extends MemberActionReasonDto {
  @ApiProperty()
  @IsBoolean()
  isTimeTrackable!: boolean;
}

/** `PATCH /memberships/:id/scope`: all projects, or only the listed projects and sites. */
export class SetMemberScopeDto extends MemberActionReasonDto {
  @ApiProperty({ description: "false = every project; true = only the projects and sites below (at least one)." })
  @IsBoolean()
  restricted!: boolean;

  @ApiPropertyOptional({ type: [String], description: "Projects the member works with, with all their sites." })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({ type: [String], description: "Single sites the member works with." })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  siteIds?: string[];
}
