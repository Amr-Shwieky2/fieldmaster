import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { AccountStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import type { AccessTokenPayload, AuthenticatedRequest } from "../auth/auth-context";
import { APP_ENVIRONMENT, type AppEnvironment } from "../config/app-environment";
import { TEST_MODE_SESSION_ENDED_MESSAGE, isTestModeLoginMethod } from "../auth/login-method";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    @Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException("Missing bearer token.");

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException("Invalid or expired access token.");
    }

    // Test-mode sessions (quick login / fixed code 123456) end immediately
    // when dev login is turned off, not only when the access token expires.
    if (isTestModeLoginMethod(payload.loginMethod) && !this.appEnvironment.devLoginEnabled) {
      throw new UnauthorizedException(TEST_MODE_SESSION_ENDED_MESSAGE);
    }

    // Re-check membership + user status on every request so a suspension or
    // archival takes effect immediately, not only after the token expires.
    const membership = await this.prisma.organizationMembership.findUnique({
      where: { id: payload.membershipId },
      include: { user: true, workerProfile: true },
    });

    if (
      !membership ||
      membership.archivedAt ||
      membership.status !== AccountStatus.ACTIVE ||
      membership.user.status !== AccountStatus.ACTIVE ||
      membership.organizationId !== payload.organizationId
    ) {
      throw new UnauthorizedException("Account or membership is not active.");
    }

    request.user = {
      ...payload,
      workerProfileId: membership.workerProfile?.id ?? null,
    };
    return true;
  }

  private extractToken(request: AuthenticatedRequest): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [type, token] = header.split(" ");
    return type === "Bearer" ? token : undefined;
  }
}
