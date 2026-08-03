import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsString, ValidateNested } from "class-validator";
import { CreateCompensationProfileDto } from "./create-compensation-profile.dto";

export class ApproveWorkerDto {
  @ApiProperty({ type: CreateCompensationProfileDto })
  @ValidateNested()
  @Type(() => CreateCompensationProfileDto)
  compensationProfile!: CreateCompensationProfileDto;
}

export class RejectWorkerDto {
  @ApiProperty()
  @IsString()
  reason!: string;
}
