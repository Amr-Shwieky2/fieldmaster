import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class AssignWorkerDto {
  @ApiProperty()
  @IsString()
  workerProfileId!: string;
}
