import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { OrganizationSettingsService } from "../../common/settings/organization-settings.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { projectScopeWhere, scopeOf, siteScopeWhere, projectInScope } from "../../common/scope/scope-filters";
import type { CreateProjectDto } from "./dto/create-project.dto";
import type { CreateSiteDto } from "./dto/create-site.dto";
import type { CreateGeofenceDto } from "./dto/create-geofence.dto";
import { projectSelectFor } from "./project-fields";
import { listOrPage, type PageWindow } from "../../common/validation/page-query";

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly settings: OrganizationSettingsService,
  ) {}

  // ── Projects ──────────────────────────────────────────────────────────
  async createProject(organizationId: string, dto: CreateProjectDto, actor: AuthenticatedUser, correlationId: string) {
    // A new project belongs to no one's selection yet: only a member who is not restricted may start one.
    if (scopeOf(actor).restricted) throw new AppException(403, ErrorCodes.SCOPE_RESTRICTED, "A member restricted to some projects cannot create a project.");
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
      select: projectSelectFor(actor),
    });
    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "PROJECT_CREATED",
      entityType: "Project",
      entityId: project.id,
      correlationId,
    });
    return project;
  }

  async listProjects(organizationId: string, viewer: AuthenticatedUser, window: PageWindow | null = null) {
    const where = { organizationId, archivedAt: null, ...(projectScopeWhere(scopeOf(viewer)) ?? {}) };
    return listOrPage(
      window,
      (range) => this.prisma.project.findMany({ where, select: projectSelectFor(viewer), orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...range }),
      () => this.prisma.project.count({ where }),
    );
  }

  async getProject(organizationId: string, id: string, viewer: AuthenticatedUser) {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId, archivedAt: null, ...(projectScopeWhere(scopeOf(viewer)) ?? {}) },
      select: projectSelectFor(viewer),
    });
    if (!project) throw new AppException(404, ErrorCodes.NOT_FOUND, "Project not found.");
    return project;
  }

  // ── Sites ─────────────────────────────────────────────────────────────
  async createSite(organizationId: string, dto: CreateSiteDto, actor: AuthenticatedUser, correlationId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, organizationId } });
    if (!project || !projectInScope(scopeOf(actor), project.id)) throw new AppException(404, ErrorCodes.NOT_FOUND, "Project not found.");
    const settings = await this.settings.get(organizationId);

    const site = await this.prisma.site.create({
      data: {
        id: generateId(),
        organizationId,
        projectId: dto.projectId,
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        defaultGeofenceRadiusMeters: dto.defaultGeofenceRadiusMeters ?? settings.defaultGeofenceRadiusMeters,
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

  async listSites(organizationId: string, viewer: AuthenticatedUser, projectId?: string, window: PageWindow | null = null) {
    const where = { organizationId, archivedAt: null, ...(siteScopeWhere(scopeOf(viewer)) ?? {}), ...(projectId ? { projectId } : {}) };
    return listOrPage(
      window,
      (range) => this.prisma.site.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], ...range }),
      () => this.prisma.site.count({ where }),
    );
  }

  async getSite(organizationId: string, id: string, viewer: AuthenticatedUser) {
    const site = await this.prisma.site.findFirst({
      where: { id, organizationId, archivedAt: null, ...(siteScopeWhere(scopeOf(viewer)) ?? {}) },
      include: { geofences: true },
    });
    if (!site) throw new AppException(404, ErrorCodes.NOT_FOUND, "Site not found.");
    return site;
  }

  // ── Geofences ─────────────────────────────────────────────────────────
  async createGeofence(organizationId: string, dto: CreateGeofenceDto, actor: AuthenticatedUser, correlationId: string) {
    const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, organizationId, ...(siteScopeWhere(scopeOf(actor)) ?? {}) } });
    if (!site) throw new AppException(404, ErrorCodes.NOT_FOUND, "Site not found.");

    const previousVersion = await this.prisma.geofence.findFirst({
      where: { siteId: dto.siteId },
      orderBy: { version: "desc" },
    });
    const settings = await this.settings.get(organizationId);

    const geofence = await this.prisma.geofence.create({
      data: {
        id: generateId(),
        organizationId,
        siteId: dto.siteId,
        centerLatitude: dto.centerLatitude,
        centerLongitude: dto.centerLongitude,
        radiusMeters: dto.radiusMeters,
        minAccuracyMeters: dto.minAccuracyMeters ?? settings.defaultMinGpsAccuracyMeters,
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

  async listGeofencesForSite(organizationId: string, siteId: string, viewer: AuthenticatedUser) {
    return this.prisma.geofence.findMany({ where: { organizationId, siteId, site: siteScopeWhere(scopeOf(viewer)) ?? {} }, orderBy: { version: "desc" } });
  }
}
