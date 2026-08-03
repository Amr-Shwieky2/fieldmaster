import { Injectable } from "@nestjs/common";
import { OrgRole } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { CreateProjectDto } from "./dto/create-project.dto";
import type { CreateSiteDto } from "./dto/create-site.dto";
import type { CreateGeofenceDto } from "./dto/create-geofence.dto";

function serializeProject(project: { budgetAgorot: number | null; [k: string]: unknown }, viewer: AuthenticatedUser) {
  if (viewer.role === OrgRole.OWNER) return project;
  const { budgetAgorot: _budgetAgorot, ...rest } = project;
  return rest;
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ── Projects ──────────────────────────────────────────────────────────
  async createProject(organizationId: string, dto: CreateProjectDto, actor: AuthenticatedUser, correlationId: string) {
    const project = await this.prisma.project.create({
      data: {
        id: generateId(),
        organizationId,
        name: dto.name,
        client: dto.client,
        projectCode: dto.projectCode,
        description: dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        budgetAgorot: dto.budgetAgorot,
      },
    });
    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "PROJECT_CREATED",
      entityType: "Project",
      entityId: project.id,
      correlationId,
    });
    return serializeProject(project, actor);
  }

  async listProjects(organizationId: string, viewer: AuthenticatedUser) {
    const projects = await this.prisma.project.findMany({ where: { organizationId, archivedAt: null }, orderBy: { createdAt: "asc" } });
    return projects.map((p) => serializeProject(p, viewer));
  }

  async getProject(organizationId: string, id: string, viewer: AuthenticatedUser) {
    const project = await this.prisma.project.findFirst({ where: { id, organizationId, archivedAt: null } });
    if (!project) throw new AppException(404, ErrorCodes.NOT_FOUND, "Project not found.");
    return serializeProject(project, viewer);
  }

  // ── Sites ─────────────────────────────────────────────────────────────
  async createSite(organizationId: string, dto: CreateSiteDto, actor: AuthenticatedUser, correlationId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, organizationId } });
    if (!project) throw new AppException(404, ErrorCodes.NOT_FOUND, "Project not found.");

    const site = await this.prisma.site.create({
      data: {
        id: generateId(),
        organizationId,
        projectId: dto.projectId,
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        defaultGeofenceRadiusMeters: dto.defaultGeofenceRadiusMeters ?? 100,
        instructions: dto.instructions,
        emergencyContact: dto.emergencyContact,
      },
    });
    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "SITE_CREATED",
      entityType: "Site",
      entityId: site.id,
      correlationId,
    });
    return site;
  }

  async listSites(organizationId: string, projectId?: string) {
    return this.prisma.site.findMany({
      where: { organizationId, archivedAt: null, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "asc" },
    });
  }

  async getSite(organizationId: string, id: string) {
    const site = await this.prisma.site.findFirst({ where: { id, organizationId, archivedAt: null }, include: { geofences: true } });
    if (!site) throw new AppException(404, ErrorCodes.NOT_FOUND, "Site not found.");
    return site;
  }

  // ── Geofences ─────────────────────────────────────────────────────────
  async createGeofence(organizationId: string, dto: CreateGeofenceDto, actor: AuthenticatedUser, correlationId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, organizationId } });
    if (!site) throw new AppException(404, ErrorCodes.NOT_FOUND, "Site not found.");

    const previousVersion = await this.prisma.geofence.findFirst({
      where: { siteId: dto.siteId },
      orderBy: { version: "desc" },
    });

    const geofence = await this.prisma.geofence.create({
      data: {
        id: generateId(),
        organizationId,
        siteId: dto.siteId,
        centerLatitude: dto.centerLatitude,
        centerLongitude: dto.centerLongitude,
        radiusMeters: dto.radiusMeters,
        minAccuracyMeters: dto.minAccuracyMeters ?? 50,
        version: (previousVersion?.version ?? 0) + 1,
        createdBy: actor.sub,
      },
    });
    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "GEOFENCE_CREATED",
      entityType: "Geofence",
      entityId: geofence.id,
      correlationId,
    });
    return geofence;
  }

  async listGeofencesForSite(organizationId: string, siteId: string) {
    return this.prisma.geofence.findMany({ where: { organizationId, siteId }, orderBy: { version: "desc" } });
  }
}
