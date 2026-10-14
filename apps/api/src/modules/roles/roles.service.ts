import { Injectable } from "@nestjs/common";
import type { Prisma, Role } from "@prisma/client";
import {
  AccountStatus,
  FINANCIAL_PERMISSIONS,
  ORG_WIDE_PERMISSIONS,
  OrgRole,
  PERMISSION_GROUPS,
  PERMISSION_REQUIRES,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRoleKey,
  checkRolePermissions,
  holdsAdminPermissions,
  isPermission,
  type Permission,
} from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { RealtimeEventsService } from "../notifications/realtime-events";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { generateId } from "../../common/ids";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { countAdmins, lastAdminError, lockAdmins } from "../../common/auth/admin-guard";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import { ensureSystemRoles, SYSTEM_ROLE_NAMES } from "./system-roles";
import type { ArchiveRoleDto, CreateRoleDto, UpdateRoleDto } from "./dto/role.dto";

type PrismaTx = Prisma.TransactionClient;

/** A member listed under a role (names only). */
export interface RoleMemberDto {
  membershipId: string;
  userId: string;
  fullLegalName: string;
  status: string;
}

export interface RoleDto {
  id: string;
  name: string;
  description: string | null;
  /** A built-in role: fixed permissions, never edited or archived. */
  isSystem: boolean;
  systemKey: string | null;
  permissions: Permission[];
  /** Active, non-archived members with this role. */
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

/** `GET /roles/catalog`: what a role's permission list is made of, so every client builds the same checklist. */
export interface PermissionCatalogDto {
  groups: { group: string; permissions: { permission: Permission; requires: Permission[]; financial: boolean; organizationWide: boolean }[] }[];
}

/**
 * Roles (flexible organization model). The three built-in roles (Owner,
 * Field Manager, Worker) are SYSTEM roles with the permissions the system
 * always gave them -- they are listed here but never changed. An Owner (or
 * whoever holds MANAGE_ROLES) creates custom roles from the catalog; a
 * member has one role; a custom role's permissions apply to the next request
 * of each of its members. Every change is audited old -> new, and an
 * organization always keeps at least one active member who can manage roles
 * and settings.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtime: RealtimeEventsService,
  ) {}

  /** The catalog of permissions in the order the editor shows them. */
  catalog(): PermissionCatalogDto {
    return {
      groups: PERMISSION_GROUPS.map(({ group, permissions }) => ({
        group,
        permissions: permissions.map((permission) => ({
          permission,
          requires: [...(PERMISSION_REQUIRES[permission] ?? [])],
          financial: FINANCIAL_PERMISSIONS.has(permission),
          organizationWide: ORG_WIDE_PERMISSIONS.has(permission),
        })),
      })),
    };
  }

  /** Every active role (built-in first), with the number of members each has. */
  async list(organizationId: string, options: { includeArchived?: boolean } = {}): Promise<RoleDto[]> {
    await ensureSystemRoles(this.prisma, organizationId);
    const [roles, counts] = await Promise.all([
      this.prisma.role.findMany({
        where: { organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.organizationMembership.groupBy({
        by: ["roleId"],
        where: { organizationId, status: { not: AccountStatus.ARCHIVED }, archivedAt: null },
        _count: { _all: true },
      }),
    ]);
    const countOf = new Map(counts.map((row) => [row.roleId, row._count._all]));
    return roles.map((role) => toRoleDto(role, countOf.get(role.id) ?? 0)).sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || systemOrder(a) - systemOrder(b) || a.createdAt.getTime() - b.createdAt.getTime());
  }

  /** One role with the members who have it (names, status; the first 200). */
  async getById(organizationId: string, roleId: string): Promise<RoleDto & { members: RoleMemberDto[] }> {
    await ensureSystemRoles(this.prisma, organizationId);
    const role = await this.find(this.prisma, organizationId, roleId);
    const [count, members] = await Promise.all([
      this.prisma.organizationMembership.count({ where: { organizationId, roleId: role.id, archivedAt: null } }),
      this.prisma.organizationMembership.findMany({
        where: { organizationId, roleId: role.id, archivedAt: null },
        select: { id: true, userId: true, status: true, user: { select: { fullLegalName: true } } },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
    ]);
    return {
      ...toRoleDto(role, count),
      members: members.map((member) => ({ membershipId: member.id, userId: member.userId, fullLegalName: member.user.fullLegalName, status: member.status })),
    };
  }

  async create(organizationId: string, dto: CreateRoleDto, actor: AuthenticatedUser, correlationId: string): Promise<RoleDto> {
    const permissions = this.validatedPermissions(dto.permissions);
    const name = dto.name.trim();
    await ensureSystemRoles(this.prisma, organizationId);
    const role = await this.prisma.$transaction(async (tx) => {
      await this.assertNameFree(tx, organizationId, name);
      const created = await tx.role.create({
        data: { id: generateId(), organizationId, name, description: dto.description?.trim() || null, permissions, createdBy: actor.sub },
      });
      await this.auditService.record(
        {
          organizationId,
          actorUserId: actor.sub,
          action: "ROLE_CREATED",
          entityType: "Role",
          entityId: created.id,
          field: "permissions",
          newValue: permissions.join(","),
          note: name,
          correlationId,
        },
        tx,
      );
      return created;
    });
    return toRoleDto(role, 0);
  }

  async update(organizationId: string, roleId: string, dto: UpdateRoleDto, actor: AuthenticatedUser, correlationId: string): Promise<RoleDto> {
    const nextPermissions = dto.permissions === undefined ? undefined : this.validatedPermissions(dto.permissions);
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockAdmins(tx, organizationId);
      const role = await this.find(tx, organizationId, roleId);
      if (role.systemKey) throw new AppException(409, ErrorCodes.SYSTEM_ROLE_IMMUTABLE, "A built-in role cannot be changed.");
      const data: Prisma.RoleUpdateInput = {};
      const changes: { field: string; oldValue: string; newValue: string }[] = [];

      if (dto.name !== undefined && dto.name.trim() !== role.name) {
        const name = dto.name.trim();
        await this.assertNameFree(tx, organizationId, name, role.id);
        data.name = name;
        changes.push({ field: "name", oldValue: role.name, newValue: name });
      }
      if (dto.description !== undefined && (dto.description.trim() || null) !== role.description) {
        data.description = dto.description.trim() || null;
        changes.push({ field: "description", oldValue: role.description ?? "", newValue: dto.description.trim() });
      }
      if (nextPermissions !== undefined && !sameSet(nextPermissions, role.permissions)) {
        // Taking the administrators' permissions away must leave another administrator.
        const hadAdmin = holdsAdminPermissions(role.permissions);
        if (hadAdmin && !holdsAdminPermissions(nextPermissions)) {
          const others = await countAdmins(tx, organizationId, { roleOverride: { roleId: role.id, permissions: nextPermissions } });
          if (others === 0) throw lastAdminError(OrgRole.CUSTOM);
        }
        data.permissions = nextPermissions;
        changes.push({ field: "permissions", oldValue: [...role.permissions].sort().join(","), newValue: [...nextPermissions].sort().join(",") });
      }

      if (changes.length === 0) return role;
      const saved = await tx.role.update({ where: { id: role.id }, data });
      for (const change of changes) {
        await this.auditService.record(
          {
            organizationId,
            actorUserId: actor.sub,
            action: "ROLE_UPDATED",
            entityType: "Role",
            entityId: role.id,
            field: change.field,
            oldValue: change.oldValue,
            newValue: change.newValue,
            reason: dto.reason,
            note: role.name,
            correlationId,
          },
          tx,
        );
      }
      return saved;
    });

    // The new permissions apply to the very next request; open real-time connections of its members rejoin with them.
    if (nextPermissions !== undefined) await this.endMemberConnections(organizationId, updated.id);
    const count = await this.prisma.organizationMembership.count({ where: { organizationId, roleId: updated.id, archivedAt: null } });
    return toRoleDto(updated, count);
  }

  /** A custom role with no members can be archived (it stays in the history; its name is free again). */
  async archive(organizationId: string, roleId: string, dto: ArchiveRoleDto, actor: AuthenticatedUser, correlationId: string): Promise<RoleDto> {
    const archived = await this.prisma.$transaction(async (tx) => {
      await lockAdmins(tx, organizationId);
      const role = await this.find(tx, organizationId, roleId);
      if (role.systemKey) throw new AppException(409, ErrorCodes.SYSTEM_ROLE_IMMUTABLE, "A built-in role cannot be archived.");
      if (role.archivedAt) throw new AppException(409, ErrorCodes.CONFLICT, "This role is already archived.");
      const members = await tx.organizationMembership.count({ where: { organizationId, roleId: role.id, archivedAt: null } });
      if (members > 0) throw new AppException(409, ErrorCodes.ROLE_IN_USE, "Move this role's members to another role first.", { memberCount: members });
      const saved = await tx.role.update({ where: { id: role.id }, data: { archivedAt: new Date() } });
      await this.auditService.record(
        { organizationId, actorUserId: actor.sub, action: "ROLE_ARCHIVED", entityType: "Role", entityId: role.id, note: role.name, reason: dto.reason, correlationId },
        tx,
      );
      return saved;
    });
    return toRoleDto(archived, 0);
  }

  /** The unarchived role of the organization, for assigning to a member (404 otherwise). */
  async findAssignable(db: PrismaTx | PrismaService, organizationId: string, roleId: string): Promise<Role> {
    const role = await this.find(db, organizationId, roleId);
    if (role.archivedAt) throw new AppException(404, ErrorCodes.NOT_FOUND, "Role not found.");
    return role;
  }

  /** A role of the organization looked up by a built-in key (OWNER / FIELD_MANAGER / WORKER). */
  async findSystem(db: PrismaTx | PrismaService, organizationId: string, key: SystemRoleKey): Promise<Role> {
    await ensureSystemRoles(db as PrismaTx, organizationId);
    return db.role.findFirstOrThrow({ where: { organizationId, systemKey: key } });
  }

  private async find(db: PrismaTx | PrismaService, organizationId: string, roleId: string): Promise<Role> {
    const role = UUID_PATTERN.test(roleId) ? await db.role.findFirst({ where: { id: roleId, organizationId } }) : null;
    if (!role) throw new AppException(404, ErrorCodes.NOT_FOUND, "Role not found.");
    return role;
  }

  private async assertNameFree(tx: PrismaTx, organizationId: string, name: string, exceptRoleId?: string): Promise<void> {
    const taken = await tx.role.findFirst({
      where: { organizationId, archivedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptRoleId ? { id: { not: exceptRoleId } } : {}) },
      select: { id: true },
    });
    if (taken) throw new AppException(409, ErrorCodes.ROLE_NAME_TAKEN, "A role with this name already exists.");
  }

  /** The permissions as a clean, ordered, de-duplicated list; 400 for an unknown one or one without the permissions it needs. */
  private validatedPermissions(input: readonly string[]): Permission[] {
    const unique = [...new Set(input)];
    const problems = checkRolePermissions(unique);
    if (problems.length > 0) {
      throw new AppException(400, ErrorCodes.INVALID_ROLE_PERMISSIONS, "The role's permissions are not valid.", { problems });
    }
    const known = new Set(unique.filter(isPermission));
    return PERMISSION_GROUPS.flatMap((group) => group.permissions).filter((permission) => known.has(permission));
  }

  private async endMemberConnections(organizationId: string, roleId: string): Promise<void> {
    const members = await this.prisma.organizationMembership.findMany({ where: { organizationId, roleId }, select: { id: true } });
    for (const member of members) this.realtime.sessionsEnded({ membershipId: member.id });
  }
}

function toRoleDto(role: Role, memberCount: number): RoleDto {
  const key = role.systemKey as SystemRoleKey | null;
  return {
    id: role.id,
    name: key ? SYSTEM_ROLE_NAMES[key] : role.name,
    description: role.description,
    isSystem: key !== null,
    systemKey: key,
    permissions: key ? [...SYSTEM_ROLE_PERMISSIONS[key]] : (role.permissions.filter(isPermission) as Permission[]),
    memberCount,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    archivedAt: role.archivedAt,
  };
}

const SYSTEM_ORDER: Record<string, number> = { [SystemRoleKey.OWNER]: 0, [SystemRoleKey.FIELD_MANAGER]: 1, [SystemRoleKey.WORKER]: 2 };
const systemOrder = (role: RoleDto) => (role.systemKey ? (SYSTEM_ORDER[role.systemKey] ?? 9) : 9);

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
