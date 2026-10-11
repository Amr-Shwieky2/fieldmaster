import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { TuranModule } from "../turan/turan.module";
import { DevToolsController } from "./dev-tools.controller";
import { DevToolsService } from "./dev-tools.service";
import { DevRoutesGateMiddleware } from "./dev-routes-gate.middleware";

@Module({
  imports: [TuranModule],
  controllers: [DevToolsController],
  providers: [DevToolsService],
})
export class DevToolsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DevRoutesGateMiddleware).forRoutes(DevToolsController);
  }
}
