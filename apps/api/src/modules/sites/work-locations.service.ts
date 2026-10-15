import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { OrganizationSettingsService } from "../../common/settings/organization-settings.service";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { canViewFinancials } from "../../common/auth/permissions";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { projectInScope, scopeOf, siteScopeWhere } from "../../common/scope/scope-filters";
import { WORK_LOCATION_RADIUS, type CreateWorkLocationDto, type UpdateWorkLocationDto } from "./dto/work-location.dto";

const TEXT_FIELDS = ["name", "address", "instructions", "emergencyContact"] as const;

/**
 * Work locations from the phone (mobile manager mode, MANAGE_SITES): a site
 * with its geofence, created or edited in ONE transaction -- the project
 * (when it is new), the site and its geofence are saved together or not at
 * all, never half. Every change is audited (old -> new per field). A member
 * restricted to some projects works in those projects only and cannot start
 * a project; a project's budget needs VIEW_FINANCIALS.
 */
@Injectable()
export class WorkLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly settings: OrganizationSettingsService,
  ) {}

  async defaults(organizationId: string) {
    const settings = await this.settings.get(organizationId);
    return { defaultGeofenceRadiusMeters: settings.defaultGeofenceRadiusMeters, minRadiusMeters: WORK_LOCATION_RADIUS.min, maxRadiusMeters: WORK_LOCATION_RADIUS.max };
  }

  async get(organizationId: string, siteId: string, viewer: AuthenticatedUser) {
    const site = await this.findSite(this.prisma, organizationId, siteId, viewer);
    return this.view(this.prisma, site.id);
  }

  async create(organizationId: string, dto: CreateWorkLocationDto, actor: AuthenticatedUser, correlationId: string) {
    const scope = scopeOf(actor);
    if (!dto.projectId === !dto.newProject) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Send either projectId or newProject.", { field: "projectId" });
    }
    if (dto.newProject && scope.restricted) throw new AppException(403, ErrorCodes.SCOPE_RESTRICTED, "A member restricted to some projects cannot create a project.");
    if (dto.newProject?.budgetAgorot !== undefined && !canViewFinancials(actor)) {
      throw new AppException(403, ErrorCodes.FORBIDDEN, "A project's budget needs the permission to see financial amounts.");
    }
    const settings = await this.settings.get(organizationId);

    const siteId = await this.prisma.$transaction(async (tx) => {
      let projectId = dto.projectId ?? null;
      if (projectId) {
        const project = await tx.project.findFirst({ where: { id: projectId, organizationId, archivedAt: null }, select: { id: true } });
        if (!project || !projectInScope(scope, project.id)) throw new AppException(404, ErrorCodes.NOT_FOUND, "Project not found.");
      } else if (dto.newProject) {
        projectId = generateId();
        await tx.project.create({
          data: {
            id: projectId,
            organizationId,
            name: dto.newProject.name.trim(),
            client: dto.newProject.client?.trim() || null,
            // Like a project created on the web: a code from its first id characters (unique per organization).
            projectCode: `P-${projectId.slice(-8).toUpperCase()}`,
            budgetAgorot: dto.newProject.budgetAgorot,
          },
        });
        await this.auditService.record({ organizationId, actorUserId: actor.sub, action: "PROJECT_CREATED", entityType: "Project", entityId: projectId, correlationId }, tx);
      }

      const site = await tx.site.create({
        data: {
          id: generateId(),
          organizationId,
          projectId: projectId as string,
          name: dto.name.trim(),
          address: dto.address?.trim() || null,
          latitude: dto.latitude,
          longitude: dto.longitude,
          defaultGeofenceRadiusMeters: dto.geofenceRadiusMeters,
          instructions: dto.instructions?.trim() || null,
          emergencyContact: dto.emergencyContact?.trim() || null,
        },
      });
      await this.auditService.record({ organizationId, actorUserId: actor.sub, action: "SITE_CREATED", entityType: "Site", entityId: site.id, correlationId }, tx);
      await this.createGeofence(tx, organizationId, site.id, dto.latitude, dto.longitude, dto.geofenceRadiusMeters, settings.defaultMinGpsAccuracyMeters, actor, correlationId);
      return site.id;
    });
    return this.view(this.prisma, siteId);
  }

  async update(organizationId: string, siteId: string, dto: UpdateWorkLocationDto, actor: AuthenticatedUser, correlationId: string) {
    const settings = await this.settings.get(organizationId);
    await this.prisma.$transaction(async (tx) => {
      const site = await this.findSite(tx, organizationId, siteId, actor);
      const current = await tx.geofence.findFirst({ where: { siteId: site.id }, orderBy: { version: "desc" } });

      const changes: Prisma.SiteUpdateInput = {};
      const audits: { field: string; oldValue: string | null; newValue: string | null }[] = [];
      for (const field of TEXT_FIELDS) {
        if (dto[field] === undefined) continue;
        const next = dto[field] === null ? null : (dto[field] as string).trim() || null;
        if (field === "name" && next === null) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "name must not be blank", { field: "name" });
        if (next === site[field]) continue;
        changes[field] = next as never;
        audits.push({ field, oldValue: site[field], newValue: next });
      }
      const latitude = dto.latitude ?? site.latitude;
      const longitude = dto.longitude ?? site.longitude;
      const radius = dto.geofenceRadiusMeters ?? current?.radiusMeters ?? site.defaultGeofenceRadiusMeters;
      if (latitude !== site.latitude || longitude !== site.longitude) {
        changes.latitude = latitude;
        changes.longitude = longitude;
        audits.push({ field: "location", oldValue: `${site.latitude},${site.longitude}`, newValue: `${latitude},${longitude}` });
      }
      if (radius !== site.defaultGeofenceRadiusMeters) {
        changes.defaultGeofenceRadiusMeters = radius;
        audits.push({ field: "defaultGeofenceRadiusMeters", oldValue: String(site.defaultGeofenceRadiusMeters), newValue: String(radius) });
      }
      if (audits.length === 0) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Nothing changes.");

      await tx.site.update({ where: { id: site.id }, data: changes });
      for (const audit of audits) {
        await this.auditService.record(
          { organizationId, actorUserId: actor.sub, action: "SITE_UPDATED", entityType: "Site", entityId: site.id, field: audit.field, oldValue: audit.oldValue ?? undefined, newValue: audit.newValue ?? undefined, reason: dto.reason, correlationId },
          tx,
        );
      }
      // A new center or radius is a new geofence version (shifts keep the version they were created with).
      const moved = !current || current.centerLatitude !== latitude || current.centerLongitude !== longitude || current.radiusMeters !== radius;
      if (moved) await this.createGeofence(tx, organizationId, site.id, latitude, longitude, radius, current?.minAccuracyMeters ?? settings.defaultMinGpsAccuracyMeters, actor, correlationId);
    });
    return this.view(this.prisma, siteId);
  }

  /** The site, within the member's projects; otherwise 404 (it does not exist for them). */
  private async findSite(client: Prisma.TransactionClient | PrismaService, organizationId: string, siteId: string, viewer: AuthenticatedUser) {
    const site = UUID_PATTERN.test(siteId)
      ? await client.site.findFirst({ where: { id: siteId, organizationId, archivedAt: null, ...(siteScopeWhere(scopeOf(viewer)) ?? {}) } })
      : null;
    if (!site) throw new AppException(404, ErrorCodes.NOT_FOUND, "Site not found.");
    return site;
  }

  private async createGeofence(
    tx: Prisma.TransactionClient,
    organizationId: string,
    siteId: string,
    latitude: number,
    longitude: number,
    radiusMeters: number,
    minAccuracyMeters: number,
    actor: AuthenticatedUser,
    correlationId: string,
  ) {
    const previous = await tx.geofence.findFirst({ where: { siteId }, orderBy: { version: "desc" }, select: { version: true } });
    const geofence = await tx.geofence.create({
      data: {
        id: generateId(),
        organizationId,
        siteId,
        centerLatitude: latitude,
        centerLongitude: longitude,
        radiusMeters,
        minAccuracyMeters,
        version: (previous?.version ?? 0) + 1,
        createdBy: actor.sub,
      },
    });
    await this.auditService.record({ organizationId, actorUserId: actor.sub, action: "GEOFENCE_CREATED", entityType: "Geofence", entityId: geofence.id, correlationId }, tx);
  }

  private async view(client: Prisma.TransactionClient | PrismaService, siteId: string) {
    const site = await client.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { project: { select: { name: true } }, geofences: { orderBy: { version: "desc" }, take: 1 } },
    });
    const geofence = site.geofences[0] ?? null;
    return {
      id: site.id,
      projectId: site.projectId,
      projectName: site.project.name,
      name: site.name,
      address: site.address,
      latitude: site.latitude,
      longitude: site.longitude,
      instructions: site.instructions,
      emergencyContact: site.emergencyContact,
      geofence: geofence
        ? { id: geofence.id, centerLatitude: geofence.centerLatitude, centerLongitude: geofence.centerLongitude, radiusMeters: geofence.radiusMeters, version: geofence.version }
        : null,
    };
  }
}
