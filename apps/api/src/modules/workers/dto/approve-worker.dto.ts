import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDefined, IsString, Matches, ValidateNested } from "class-validator";
import { CreateCompensationProfileDto } from "./create-compensation-profile.dto";
import { NOT_BLANK } from "./validation";

export class ApproveWorkerDto {
  @ApiProperty({ type: CreateCompensationProfileDto, description: "The worker's first compensation profile (required)." })
  @IsDefined({ message: "compensationProfile is required" })
  @ValidateNested()
  @Type(() => CreateCompensationProfileDto)
  compensationProfile!: CreateCompensationProfileDto;
}

export class RejectWorkerDto {
  @ApiProperty({ description: "Why the application is rejected (required, not blank)." })
  @IsString()
  @Matches(NOT_BLANK, { message: "reason must not be blank" })
  reason!: string;
}
