import { Module } from "@nestjs/common";
import { OperationsController } from "./operations.controller";
import { OperationsService } from "./operations.service";
import { LongOpenEntriesService } from "./long-open-entries.service";
import { LongOpenEntriesProcessor } from "./long-open-entries.processor";

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, LongOpenEntriesService, LongOpenEntriesProcessor],
  exports: [LongOpenEntriesService],
})
export class OperationsModule {}
