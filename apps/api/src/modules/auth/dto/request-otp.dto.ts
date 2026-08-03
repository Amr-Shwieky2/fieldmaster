import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class RequestOtpDto {
  @ApiProperty({ example: "+972501234567" })
  @IsString()
  phoneNumber!: string;
}
