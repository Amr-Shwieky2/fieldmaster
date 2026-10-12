import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";

export class ReverseInfractionDto {
  @ApiProperty({ description: "Why the deduction is cancelled (mandatory, stored on the reversal and in the audit log)." })
  @IsString()
  @Matches(/\S/, { message: "reason must not be blank" })
  reason!: string;
}
