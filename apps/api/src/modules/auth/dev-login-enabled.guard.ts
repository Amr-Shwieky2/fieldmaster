import { CanActivate, ExecutionContext, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Request } from "express";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";

/**
 * Makes the /auth/dev/* routes indistinguishable from a route that does not
 * exist (404 with the same message Nest uses for unknown routes) unless dev
 * login mode is on.
 */
@Injectable()
export class DevLoginEnabledGuard implements CanActivate {
  constructor(@Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.appEnvironment.devLoginEnabled) return true;
    const request = context.switchToHttp().getRequest<Request>();
    throw new NotFoundException(`Cannot ${request.method} ${request.originalUrl ?? request.url}`);
  }
}
