import { ApiProperty } from "@nestjs/swagger";
import { IsInt, Max, Min } from "class-validator";
import { DEV_REWIND_MAX_MINUTES } from "../dev-tools.constants";

export class RewindTimeEntryDto {
  @ApiProperty({ minimum: 1, maximum: DEV_REWIND_MAX_MINUTES, description: "How many minutes to move the open entry's clock-in back." })
  @IsInt()
  @Min(1)
  @Max(DEV_REWIND_MAX_MINUTES)
  minutes!: number;
}
