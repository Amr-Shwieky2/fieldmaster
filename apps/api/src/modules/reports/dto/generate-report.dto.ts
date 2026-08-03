import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsString } from "class-validator";

export class GenerateWorkerLedgerDto {
  @ApiProperty()
  @IsString()
  workerProfileId!: string;

  @ApiProperty({ example: "2026-08-01" })
  @IsDateString()
  fromDate!: string;

  @ApiProperty({ example: "2026-08-31" })
  @IsDateString()
  toDate!: string;
}
