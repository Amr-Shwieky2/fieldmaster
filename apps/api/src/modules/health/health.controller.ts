import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { PrismaService } from "../../common/prisma/prisma.service";

/**
 * Unauthenticated liveness/readiness probe for the ECS/ALB target group
 * (infrastructure/terraform/modules/ecs) and for local `docker compose`
 * smoke checks. Confirms the database connection is actually usable, not
 * just that the Node process is up -- a container that can accept TCP
 * connections but can't reach Postgres should fail its health check and
 * get cycled by ECS rather than serve traffic it can't fulfill.
 */
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException("Database is not reachable.");
    }
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
