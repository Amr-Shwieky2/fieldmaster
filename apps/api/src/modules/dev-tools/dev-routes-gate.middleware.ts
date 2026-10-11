import { Inject, Injectable, NestMiddleware, NotFoundException } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";

/**
 * The /dev/* routes need a signed-in user, and the global JwtAuthGuard runs
 * before any controller guard, so with dev login off an anonymous request
 * would get 401 and reveal that the route exists. Middleware runs before
 * every guard: it answers exactly like an unknown route (the same 404 that
 * DevLoginEnabledGuard gives /auth/dev/*), whether or not a token was sent.
 */
@Injectable()
export class DevRoutesGateMiddleware implements NestMiddleware {
  constructor(@Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment) {}

  use(req: Request, _res: Response, next: NextFunction) {
    if (this.appEnvironment.devLoginEnabled) {
      next();
      return;
    }
    throw new NotFoundException(`Cannot ${req.method} ${req.originalUrl ?? req.url}`);
  }
}
