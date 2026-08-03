import { ApiProperty } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";
import { OrgRole } from "@fieldmaster/shared-types";

export class CreateMembershipDto {
  @ApiProperty({ example: "+972501234567" })
  @IsString()
  phoneNumber!: string;

  @ApiProperty({ example: "Dana Cohen", description: "Required if this phone number has no existing account." })
  @IsOptional()
  @IsString()
  fullLegalName?: string;

  @ApiProperty({ enum: [OrgRole.OWNER, OrgRole.FIELD_MANAGER] })
  @IsIn([OrgRole.OWNER, OrgRole.FIELD_MANAGER])
  role!: typeof OrgRole.OWNER | typeof OrgRole.FIELD_MANAGER;

  @ApiProperty({ default: false, description: "Allows this manager to be assigned to shifts / Turan themselves." })
  @IsOptional()
  @IsBoolean()
  isTimeTrackable?: boolean;
}
