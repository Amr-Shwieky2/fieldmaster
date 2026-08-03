import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import { roleHasPermission, type Permission } from "../auth/permissions";
import type { AuthenticatedRequest } from "../auth/auth-context";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException("No authenticated user in context.");

    const hasAll = required.every((permission) => roleHasPermission(user.role, permission));
    if (!hasAll) {
      throw new ForbiddenException(`Missing required permission(s): ${required.join(", ")}`);
    }
    return true;
  }
}
