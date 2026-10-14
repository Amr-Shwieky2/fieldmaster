import { Injectable } from "@nestjs/common";
import type { OrganizationMembership, Prisma, Role, User } from "@prisma/client";
import { AccountStatus, OrgRole, TimeEntryStatus, holdsAdminPermissions } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { OwnerLimitService } from "../organizations/owner-limit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { parseDurationMs } from "../auth/duration.util";
import { RealtimeEventsService } from "../notifications/realtime-events";
import { DeviceKeyStatus, DevicesService } from "../devices/devices.service";
import { RolesService } from "../roles/roles.service";
import { countAdmins, lastAdminError, lockAdmins } from "../../common/auth/admin-guard";
import { permissionsOfRole } from "../../common/auth/member-access";
import type { CreateMembershipDto } from "./dto/create-membership.dto";
import type { ChangeMemberRoleDto, MemberActionReasonDto, SetMemberScopeDto, SetTimeTrackingDto } from "./dto/member-actions.dto";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

type PrismaTx = Prisma.TransactionClient;
type MemberRow = OrganizationMembership & {
  user: User;
  workerProfile: { id: string } | null;
  roleRecord: Role | null;
  scopes: { projectId: string | null; siteId: string | null }[];
};

const MEMBER_INCLUDE = {
  user: true,
  workerProfile: { select: { id: true } },
  roleRecord: true,
  scopes: { select: { projectId: true, siteId: true } },
} as const;

/** The role as the audit log and the users page name it: the built-in key, or `CUSTOM:<name>`. */
function roleLabel(kind: string, record: Pick<Role, "name"> | null): string {
  return kind === OrgRole.CUSTOM ? `CUSTOM:${record?.name ?? ""}` : kind;
}

/**
 * Members, roles and devices (spec section 7, Step 6 users page; whoever
 * holds MANAGE_ORG_USERS). Every change needs a reason and is audited old ->
 * new. A member has one role (a built-in one, or a custom one an Owner
 * created) and may be restricted to some projects and sites. Suspending or
 * archiving a member ends their sessions at once: their refresh-token
 * families are revoked, their open WebSocket / SSE connections are closed,
 * and every REST call is refused by the guard's live status check. An
 * organization always keeps at least one active member who can manage roles
 * and settings (and so at least one active Owner, unless another role holds
 * those permissions), and has at most as many active Owners as its setting
 * allows (none: no limit).
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ownerLimitService: OwnerLimitService,
    private readonly realtime: RealtimeEventsService,
    private readonly devices: DevicesService,
    private readonly roles: RolesService,
  ) {}

  async create(organizationId: string, dto: CreateMembershipDto, actor: AuthenticatedUser, correlationId: string) {
    if (!dto.role && !dto.roleId) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Send a role or a roleId.");
    return this.prisma.$transaction(async (tx) => {
      const next = await this.resolveRole(tx, organizationId, dto);
      if (next.kind === OrgRole.WORKER) {
        throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Workers join through an onboarding invitation.");
      }
      if (next.kind === OrgRole.OWNER) {
        await this.ownerLimitService.assertCanAddOwner(organizationId, undefined, tx);
      }

      let user = await tx.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
      if (!user) {
        if (!dto.fullLegalName) {
          throw new Error("fullLegalName is required when creating a new user.");
        }
        user = await tx.user.create({
          data: { id: generateId(), phoneNumber: dto.phoneNumber, fullLegalName: dto.fullLegalName, status: AccountStatus.ACTIVE },
        });
      }

      const membership = await tx.organizationMembership.create({
        data: {
          id: generateId(),
          organizationId,
          userId: user.id,
          role: next.kind,
          roleId: next.record.id,
          isTimeTrackable: dto.isTimeTrackable ?? false,
          status: AccountStatus.ACTIVE,
        },
      });

      if (membership.isTimeTrackable) {
        await tx.workerProfile.create({
          data: { id: generateId(), membershipId: membership.id, organizationId },
        });
      }

      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "MEMBERSHIP_CREATED",
          entityType: "OrganizationMembership",
          entityId: membership.id,
          newValue: roleLabel(next.kind, next.record),
          correlationId,
        },
        tx,
      );

      return { ...membership, user };
    });
  }

  /** Every member, archived ones included, with their last activity (latest sign-in or refresh). */
  async list(organizationId: string, viewer: AuthenticatedUser) {
    const members = await this.prisma.organizationMembership.findMany({
      where: { organizationId },
      include: MEMBER_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
    const lastUse = await this.prisma.refreshTokenFamily.groupBy({
      by: ["membershipId"],
      where: { membershipId: { in: members.map((member) => member.id) } },
      _max: { lastUsedAt: true },
    });
    const lastActive = new Map(lastUse.map((row) => [row.membershipId, row._max.lastUsedAt]));
    return members.map((member) => this.toMember(member, viewer, lastActive.get(member.id) ?? null));
  }

  /**
   * Each member's role record and project scope, for the users page (the list
   * above keeps its shape): `{ membershipId, roleId, roleName, restrictedToScope, projectIds, siteIds }`.
   */
  async access(organizationId: string) {
    const members = await this.prisma.organizationMembership.findMany({
      where: { organizationId },
      select: { id: true, roleId: true, restrictedToScope: true, roleRecord: { select: { name: true, systemKey: true } }, scopes: { select: { projectId: true, siteId: true } } },
      orderBy: { createdAt: "asc" },
    });
    return members.map((member) => ({
      membershipId: member.id,
      roleId: member.roleId,
      roleName: member.roleRecord?.name ?? null,
      restrictedToScope: member.restrictedToScope,
      projectIds: member.scopes.flatMap((scope) => (scope.projectId ? [scope.projectId] : [])),
      siteIds: member.scopes.flatMap((scope) => (scope.siteId ? [scope.siteId] : [])),
    }));
  }

  async changeRole(organizationId: string, membershipId: string, dto: ChangeMemberRoleDto, actor: AuthenticatedUser, correlationId: string) {
    if (!dto.role && !dto.roleId) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Send a role or a roleId.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      const next = await this.resolveRole(tx, organizationId, dto);
      if (member.role === next.kind && member.roleId === next.record.id) return member;
      if (next.kind === OrgRole.OWNER && member.status === AccountStatus.ACTIVE) {
        await this.ownerLimitService.assertCanAddOwner(organizationId, member.id, tx);
      }
      // Moving an administrator to a role that cannot manage roles and settings must leave another one.
      if (isActiveAdmin(member) && !holdsAdminPermissions(permissionsOfRole(next.kind, next.record)) ) await this.assertAdminRemains(tx, member);
      if (next.kind === OrgRole.WORKER && (!member.isTimeTrackable || !member.workerProfile)) {
        throw new AppException(409, ErrorCodes.ROLE_REQUIRES_TIME_TRACKING, "A worker must have time tracking on.");
      }
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { role: next.kind, roleId: next.record.id },
        include: MEMBER_INCLUDE,
      });
      await this.audit(tx, actor, member, "MEMBERSHIP_ROLE_CHANGED", "role", roleLabel(member.role, member.roleRecord), roleLabel(next.kind, next.record), dto.reason, correlationId);
      return changed;
    });
    // Open connections re-authenticate with the new role (e.g. joining or leaving the live operations room).
    this.realtime.sessionsEnded({ membershipId: updated.id });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  /**
   * All projects, or only the listed projects and sites (flexible
   * organization model). A restricted member has no organization-wide
   * permissions (payroll months, the audit log, users, roles, settings...):
   * restricting an administrator is refused when no other one remains.
   */
  async setScope(organizationId: string, membershipId: string, dto: SetMemberScopeDto, actor: AuthenticatedUser, correlationId: string) {
    const projectIds = [...new Set(dto.projectIds ?? [])];
    const siteIds = [...new Set(dto.siteIds ?? [])];
    if (dto.restricted && projectIds.length + siteIds.length === 0) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Select at least one project or site, or choose all projects.");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (dto.restricted) {
        const [projects, sites] = await Promise.all([
          tx.project.count({ where: { organizationId, id: { in: projectIds } } }),
          tx.site.count({ where: { organizationId, id: { in: siteIds } } }),
        ]);
        if (projects !== projectIds.length || sites !== siteIds.length) {
          throw new AppException(404, ErrorCodes.SCOPE_TARGET_NOT_FOUND, "A project or site was not found in this organization.");
        }
        if (isActiveAdmin(member)) await this.assertAdminRemains(tx, member);
      }
      const before = scopeLabel(member);
      await tx.memberScope.deleteMany({ where: { membershipId: member.id } });
      if (dto.restricted) {
        await tx.memberScope.createMany({
          data: [
            ...projectIds.map((projectId) => ({ id: generateId(), organizationId, membershipId: member.id, projectId })),
            ...siteIds.map((siteId) => ({ id: generateId(), organizationId, membershipId: member.id, siteId })),
          ],
        });
      }
      const changed = await tx.organizationMembership.update({ where: { id: member.id }, data: { restrictedToScope: dto.restricted }, include: MEMBER_INCLUDE });
      const after = scopeLabel(changed);
      if (before !== after) await this.audit(tx, actor, member, "MEMBERSHIP_SCOPE_CHANGED", "scope", before, after, dto.reason, correlationId);
      return changed;
    });
    this.realtime.sessionsEnded({ membershipId: updated.id });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  async suspend(organizationId: string, membershipId: string, dto: MemberActionReasonDto, actor: AuthenticatedUser, correlationId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (member.status !== AccountStatus.ACTIVE) throw new AppException(409, ErrorCodes.CONFLICT, "Only an active member can be suspended.");
      if (isActiveAdmin(member)) await this.assertAdminRemains(tx, member);
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { status: AccountStatus.SUSPENDED },
        include: MEMBER_INCLUDE,
      });
      await this.revokeSessions(tx, member.id, "MEMBERSHIP_SUSPENDED");
      await this.audit(tx, actor, member, "MEMBERSHIP_SUSPENDED", "status", member.status, AccountStatus.SUSPENDED, dto.reason, correlationId);
      return changed;
    });
    this.realtime.sessionsEnded({ membershipId: updated.id });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  async reactivate(organizationId: string, membershipId: string, dto: MemberActionReasonDto, actor: AuthenticatedUser, correlationId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (member.status !== AccountStatus.SUSPENDED) throw new AppException(409, ErrorCodes.CONFLICT, "Only a suspended member can be reactivated.");
      if (member.role === OrgRole.OWNER) await this.ownerLimitService.assertCanAddOwner(organizationId, member.id, tx);
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { status: AccountStatus.ACTIVE },
        include: MEMBER_INCLUDE,
      });
      await this.audit(tx, actor, member, "MEMBERSHIP_REACTIVATED", "status", member.status, AccountStatus.ACTIVE, dto.reason, correlationId);
      return changed;
    });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  async archive(organizationId: string, membershipId: string, dto: MemberActionReasonDto, actor: AuthenticatedUser, correlationId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (isActiveAdmin(member)) await this.assertAdminRemains(tx, member);
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { status: AccountStatus.ARCHIVED, archivedAt: new Date() },
        include: MEMBER_INCLUDE,
      });
      await this.revokeSessions(tx, member.id, "MEMBERSHIP_ARCHIVED");
      await this.audit(tx, actor, member, "MEMBERSHIP_ARCHIVED", "status", member.status, AccountStatus.ARCHIVED, dto.reason, correlationId);
      return changed;
    });
    this.realtime.sessionsEnded({ membershipId: updated.id });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  async setTimeTracking(organizationId: string, membershipId: string, dto: SetTimeTrackingDto, actor: AuthenticatedUser, correlationId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (member.isTimeTrackable === dto.isTimeTrackable) return member;
      if (!dto.isTimeTrackable) {
        if (member.role === OrgRole.WORKER) throw new AppException(409, ErrorCodes.ROLE_REQUIRES_TIME_TRACKING, "A worker always has time tracking on.");
        const open = member.workerProfile
          ? await tx.timeEntry.findFirst({ where: { workerProfileId: member.workerProfile.id, status: TimeEntryStatus.ACTIVE }, select: { id: true } })
          : null;
        if (open) throw new AppException(409, ErrorCodes.ACTIVE_TIME_ENTRY_EXISTS, "This member has an open time entry; it must end first.");
      } else if (!member.workerProfile) {
        // Turning it on gives the member a worker profile (kept, for history, if it is turned off again).
        await tx.workerProfile.create({ data: { id: generateId(), membershipId: member.id, organizationId } });
      }
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { isTimeTrackable: dto.isTimeTrackable },
        include: MEMBER_INCLUDE,
      });
      await this.audit(
        tx,
        actor,
        member,
        "MEMBERSHIP_TIME_TRACKING_CHANGED",
        "isTimeTrackable",
        String(member.isTimeTrackable),
        String(dto.isTimeTrackable),
        dto.reason,
        correlationId,
      );
      return changed;
    });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  // ── Devices and sessions ─────────────────────────────────────────────

  /**
   * The devices this member signed in from in this organization, with their
   * sessions (refresh-token families) and their offline-signing key. Devices
   * the person used only for another organization are not shown.
   */
  async devicesAndSessions(organizationId: string, membershipId: string) {
    const member = await this.findMember(this.prisma, organizationId, membershipId);
    const sessions = await this.prisma.refreshTokenFamily.findMany({
      where: { membershipId: member.id },
      include: { device: true },
      orderBy: { lastUsedAt: "desc" },
    });
    const maxAgeMs = parseDurationMs(process.env.JWT_REFRESH_TTL ?? "30d");
    const now = Date.now();
    const devices = new Map<string, { device: (typeof sessions)[number]["device"]; sessions: typeof sessions }>();
    for (const session of sessions) {
      const entry = devices.get(session.deviceId) ?? { device: session.device, sessions: [] };
      entry.sessions.push(session);
      devices.set(session.deviceId, entry);
    }
    const keys = await this.prisma.devicePublicKey.findMany({
      where: { userId: member.userId, deviceId: { in: [...devices.values()].map(({ device }) => device.clientDeviceId) } },
    });

    return [...devices.values()].map(({ device, sessions: deviceSessions }) => {
      const key = keys.find((candidate) => candidate.deviceId === device.clientDeviceId) ?? null;
      return {
        id: device.id,
        clientDeviceId: device.clientDeviceId,
        platform: device.platform,
        appVersion: device.appVersion,
        osVersion: device.osVersion,
        lastActiveAt: deviceSessions[0]?.lastUsedAt ?? device.lastActiveAt,
        key: key
          ? { status: key.revokedAt ? DeviceKeyStatus.REVOKED : DeviceKeyStatus.ACTIVE, registeredAt: key.registeredAt, revokedAt: key.revokedAt }
          : { status: DeviceKeyStatus.NONE, registeredAt: null, revokedAt: null },
        sessions: deviceSessions.map((session) => ({
          id: session.id,
          origin: session.origin,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          revokedAt: session.revokedAt,
          revokedReason: session.revokedReason,
          active: session.revokedAt === null && session.createdAt.getTime() + maxAgeMs > now,
        })),
      };
    });
  }

  /** "إنهاء الجلسة": revokes one session; its access token stops working at once too (the guard checks the session). */
  async revokeSession(organizationId: string, membershipId: string, sessionId: string, dto: MemberActionReasonDto, actor: AuthenticatedUser, correlationId: string) {
    const member = await this.findMember(this.prisma, organizationId, membershipId);
    const session = UUID_PATTERN.test(sessionId)
      ? await this.prisma.refreshTokenFamily.findFirst({ where: { id: sessionId, membershipId: member.id } })
      : null;
    if (!session) throw new AppException(404, ErrorCodes.NOT_FOUND, "Session not found.");
    if (session.revokedAt) throw new AppException(409, ErrorCodes.CONFLICT, "This session has already ended.");

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshTokenFamily.update({ where: { id: session.id }, data: { revokedAt: new Date(), revokedReason: "REVOKED_BY_OWNER" } });
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "MEMBER_SESSION_REVOKED",
          entityType: "RefreshTokenFamily",
          entityId: session.id,
          reason: dto.reason,
          correlationId,
        },
        tx,
      );
    });
    this.realtime.sessionsEnded({ sessionId: session.id });
    return { id: session.id, revokedAt: new Date() };
  }

  /** "إلغاء مفتاح الجهاز": the device's offline events are refused from now on (existing rule). */
  async revokeDeviceKey(organizationId: string, membershipId: string, deviceId: string, dto: MemberActionReasonDto, actor: AuthenticatedUser, correlationId: string) {
    const member = await this.findMember(this.prisma, organizationId, membershipId);
    const device = UUID_PATTERN.test(deviceId)
      ? await this.prisma.userDevice.findFirst({ where: { id: deviceId, userId: member.userId, refreshTokenFamilies: { some: { membershipId: member.id } } } })
      : null;
    if (!device) throw new AppException(404, ErrorCodes.NOT_FOUND, "Device not found.");
    return this.devices.revokePublicKey(organizationId, device.clientDeviceId, member.userId, actor, correlationId, dto.reason);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** The member's latest sign-in or refresh in this organization. */
  private async lastActive(membershipId: string): Promise<Date | null> {
    const latest = await this.prisma.refreshTokenFamily.aggregate({ where: { membershipId }, _max: { lastUsedAt: true } });
    return latest._max.lastUsedAt;
  }

  private async findMember(client: PrismaTx | PrismaService, organizationId: string, membershipId: string): Promise<MemberRow> {
    const member = UUID_PATTERN.test(membershipId)
      ? await client.organizationMembership.findFirst({
          where: { id: membershipId, organizationId },
          include: MEMBER_INCLUDE,
        })
      : null;
    if (!member) throw new AppException(404, ErrorCodes.NOT_FOUND, "Member not found.");
    return member;
  }

  /** A member that can still be changed (not archived). */
  private async findEditable(tx: PrismaTx, organizationId: string, membershipId: string): Promise<MemberRow> {
    const member = await this.findMember(tx, organizationId, membershipId);
    if (member.archivedAt || member.status === AccountStatus.ARCHIVED) {
      throw new AppException(409, ErrorCodes.MEMBERSHIP_ARCHIVED, "This member is archived.");
    }
    return member;
  }

  /** The role a request names: a built-in role by its kind, or any unarchived role by id. */
  private async resolveRole(tx: PrismaTx, organizationId: string, input: { role?: OrgRole; roleId?: string }): Promise<{ kind: OrgRole; record: Role }> {
    if (input.roleId) {
      const record = await this.roles.findAssignable(tx, organizationId, input.roleId);
      return { kind: (record.systemKey as OrgRole | null) ?? OrgRole.CUSTOM, record };
    }
    const kind = input.role as OrgRole;
    if (kind === OrgRole.CUSTOM) throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "Name the custom role by its roleId.");
    return { kind, record: await this.roles.findSystem(tx, organizationId, kind as "OWNER" | "FIELD_MANAGER" | "WORKER") };
  }

  /** Taking an administrator away (demoting, suspending, archiving, restricting) must leave another active one. */
  private async assertAdminRemains(tx: PrismaTx, member: MemberRow): Promise<void> {
    await lockAdmins(tx, member.organizationId);
    if ((await countAdmins(tx, member.organizationId, { excludeMembershipId: member.id })) === 0) throw lastAdminError(member.role);
  }

  /** Ends every session of this membership (refresh-token families); access tokens then fail the guard. */
  private async revokeSessions(tx: PrismaTx, membershipId: string, reason: string): Promise<void> {
    await tx.refreshTokenFamily.updateMany({ where: { membershipId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  private async audit(
    tx: PrismaTx,
    actor: AuthenticatedUser,
    member: MemberRow,
    action: string,
    field: string,
    oldValue: string,
    newValue: string,
    reason: string,
    correlationId: string,
  ) {
    await this.auditService.record(
      {
        organizationId: member.organizationId,
        actorUserId: actor.sub,
        action,
        entityType: "OrganizationMembership",
        entityId: member.id,
        field,
        oldValue,
        newValue,
        reason,
        correlationId,
      },
      tx,
    );
  }

  private toMember(member: MemberRow, viewer: AuthenticatedUser, lastActiveAt: Date | null) {
    return {
      id: member.id,
      userId: member.userId,
      fullLegalName: member.user.fullLegalName,
      phoneNumber: member.user.phoneNumber,
      role: member.role,
      status: member.archivedAt ? AccountStatus.ARCHIVED : member.status,
      isTimeTrackable: member.isTimeTrackable,
      workerProfileId: member.workerProfile?.id ?? null,
      lastActiveAt,
      createdAt: member.createdAt,
      archivedAt: member.archivedAt,
      isSelf: member.id === viewer.membershipId,
    };
  }
}

/** An active, unrestricted member whose role can manage roles and settings. */
function isActiveAdmin(member: Pick<MemberRow, "role" | "roleRecord" | "status" | "archivedAt" | "restrictedToScope">): boolean {
  if (member.status !== AccountStatus.ACTIVE || member.archivedAt || member.restrictedToScope) return false;
  return holdsAdminPermissions(permissionsOfRole(member.role as OrgRole, member.roleRecord));
}

/** "all" or "projects:a,b;sites:c" (the audit's old -> new values). */
function scopeLabel(member: Pick<MemberRow, "restrictedToScope" | "scopes">): string {
  if (!member.restrictedToScope) return "all";
  const projects = member.scopes.flatMap((scope) => (scope.projectId ? [scope.projectId] : [])).sort();
  const sites = member.scopes.flatMap((scope) => (scope.siteId ? [scope.siteId] : [])).sort();
  return `projects:${projects.join(",")};sites:${sites.join(",")}`;
}
