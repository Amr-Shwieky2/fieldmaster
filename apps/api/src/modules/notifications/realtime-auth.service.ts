import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import type { AccessTokenPayload } from "../../common/auth/auth-context";
import { APP_ENVIRONMENT, type AppEnvironment } from "../../common/config/app-environment";
import { isTestModeLoginMethod } from "../../common/auth/login-method";
import { Permission, roleHasPermission } from "../../common/auth/permissions";

export interface RealtimeViewer {
  userId: string;
  membershipId: string;
  organizationId: string;
  role: OrgRole;
  /** The session (refresh-token family); absent on tokens issued before Step 6. */
  sessionId: string | null;
  /** May receive live operations events (Owner / Field Manager, from the current role). */
  canViewOperations: boolean;
}

/**
 * Authenticates a WebSocket or SSE connection with the same checks as
 * `JwtAuthGuard` on REST calls (Step 6): a valid access token, a test-mode
 * session only while dev login is on, an active membership and user, and a
 * session that has not been revoked. The role comes from the database, not
 * from the token, so a role change or suspension applies at once.
 */
@Injectable()
export class RealtimeAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_ENVIRONMENT) private readonly appEnvironment: AppEnvironment,
  ) {}

  async authenticate(token: string | undefined): Promise<RealtimeViewer | null> {
    if (!token) return null;
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      return null;
    }
    if (isTestModeLoginMethod(payload.loginMethod) && !this.appEnvironment.devLoginEnabled) return null;

    const [membership, session] = await Promise.all([
      this.prisma.organizationMembership.findUnique({ where: { id: payload.membershipId }, include: { user: { select: { status: true } } } }),
      payload.sid ? this.prisma.refreshTokenFamily.findUnique({ where: { id: payload.sid }, select: { revokedAt: true } }) : null,
    ]);
    if (
      !membership ||
      membership.archivedAt ||
      membership.status !== AccountStatus.ACTIVE ||
      membership.user.status !== AccountStatus.ACTIVE ||
      membership.organizationId !== payload.organizationId
    ) {
      return null;
    }
    if (payload.sid && (!session || session.revokedAt)) return null;

    const role = membership.role as OrgRole;
    return {
      userId: payload.sub,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      role,
      sessionId: payload.sid ?? null,
      canViewOperations: roleHasPermission(role, Permission.VIEW_OPERATIONS),
    };
  }
}
