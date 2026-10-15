import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from "class-validator";
import { OrgRole } from "@fieldmaster/shared-types";

export class CreateMembershipDto {
  @ApiProperty({ example: "+972501234567" })
  @IsString()
  phoneNumber!: string;

  @ApiProperty({ example: "Dana Cohen", description: "Required if this phone number has no existing account." })
  @IsOptional()
  @IsString()
  fullLegalName?: string;

  @ApiPropertyOptional({ enum: [OrgRole.OWNER, OrgRole.FIELD_MANAGER], description: "A built-in role. Send this or `roleId`." })
  @IsOptional()
  @IsIn([OrgRole.OWNER, OrgRole.FIELD_MANAGER])
  role?: typeof OrgRole.OWNER | typeof OrgRole.FIELD_MANAGER;

  @ApiPropertyOptional({ description: "Any role of the organization (a custom role, or the Owner / Field Manager role). Send this or `role`." })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiProperty({ default: false, description: "Allows this member to be assigned to shifts / Turan themselves." })
  @IsOptional()
  @IsBoolean()
  isTimeTrackable?: boolean;
}
