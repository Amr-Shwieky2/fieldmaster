import { Injectable } from "@nestjs/common";
import type { OrganizationMembership, Prisma, User } from "@prisma/client";
import { AccountStatus, OrgRole, TimeEntryStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { OwnerLimitService } from "../organizations/owner-limit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import { parseDurationMs } from "../auth/duration.util";
import { RealtimeEventsService } from "../notifications/realtime-events";
import { DeviceKeyStatus, DevicesService } from "../devices/devices.service";
import type { CreateMembershipDto } from "./dto/create-membership.dto";
import type { ChangeMemberRoleDto, MemberActionReasonDto, SetTimeTrackingDto } from "./dto/member-actions.dto";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

type PrismaTx = Prisma.TransactionClient;
type MemberRow = OrganizationMembership & { user: User; workerProfile: { id: string } | null };

/**
 * Members, roles and devices (spec section 7, Step 6 users page; Owners
 * only). Every change needs a reason and is audited old -> new. Suspending
 * or archiving a member ends their sessions at once: their refresh-token
 * families are revoked, their open WebSocket / SSE connections are closed,
 * and every REST call is refused by the guard's live status check. An
 * organization always keeps at least one active Owner (and at most two).
 */
@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly ownerLimitService: OwnerLimitService,
    private readonly realtime: RealtimeEventsService,
    private readonly devices: DevicesService,
  ) {}

  async create(organizationId: string, dto: CreateMembershipDto, actor: AuthenticatedUser, correlationId: string) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.role === OrgRole.OWNER) {
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
          role: dto.role,
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
          newValue: dto.role,
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
      include: { user: true, workerProfile: { select: { id: true } } },
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

  async changeRole(organizationId: string, membershipId: string, dto: ChangeMemberRoleDto, actor: AuthenticatedUser, correlationId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (member.role === dto.role) return member;
      if (dto.role === OrgRole.OWNER && member.status === AccountStatus.ACTIVE) {
        await this.ownerLimitService.assertCanAddOwner(organizationId, member.id, tx);
      }
      if (member.role === OrgRole.OWNER) await this.assertNotLastActiveOwner(tx, member);
      if (dto.role === OrgRole.WORKER && (!member.isTimeTrackable || !member.workerProfile)) {
        throw new AppException(409, ErrorCodes.ROLE_REQUIRES_TIME_TRACKING, "A worker must have time tracking on.");
      }
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { role: dto.role },
        include: { user: true, workerProfile: { select: { id: true } } },
      });
      await this.audit(tx, actor, member, "MEMBERSHIP_ROLE_CHANGED", "role", member.role, dto.role, dto.reason, correlationId);
      return changed;
    });
    // Open connections re-authenticate with the new role (e.g. joining or leaving the live operations room).
    this.realtime.sessionsEnded({ membershipId: updated.id });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  async suspend(organizationId: string, membershipId: string, dto: MemberActionReasonDto, actor: AuthenticatedUser, correlationId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (member.status !== AccountStatus.ACTIVE) throw new AppException(409, ErrorCodes.CONFLICT, "Only an active member can be suspended.");
      if (member.role === OrgRole.OWNER) await this.assertNotLastActiveOwner(tx, member);
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { status: AccountStatus.SUSPENDED },
        include: { user: true, workerProfile: { select: { id: true } } },
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
        include: { user: true, workerProfile: { select: { id: true } } },
      });
      await this.audit(tx, actor, member, "MEMBERSHIP_REACTIVATED", "status", member.status, AccountStatus.ACTIVE, dto.reason, correlationId);
      return changed;
    });
    return this.toMember(updated, actor, await this.lastActive(updated.id));
  }

  async archive(organizationId: string, membershipId: string, dto: MemberActionReasonDto, actor: AuthenticatedUser, correlationId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const member = await this.findEditable(tx, organizationId, membershipId);
      if (member.role === OrgRole.OWNER) await this.assertNotLastActiveOwner(tx, member);
      const changed = await tx.organizationMembership.update({
        where: { id: member.id },
        data: { status: AccountStatus.ARCHIVED, archivedAt: new Date() },
        include: { user: true, workerProfile: { select: { id: true } } },
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
        include: { user: true, workerProfile: { select: { id: true } } },
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
          include: { user: true, workerProfile: { select: { id: true } } },
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

  /** Demoting, suspending or archiving this Owner must leave another active Owner. */
  private async assertNotLastActiveOwner(tx: PrismaTx, member: MemberRow): Promise<void> {
    if (member.role !== OrgRole.OWNER || member.status !== AccountStatus.ACTIVE) return;
    const otherActiveOwners = await tx.organizationMembership.count({
      where: { organizationId: member.organizationId, role: OrgRole.OWNER, status: AccountStatus.ACTIVE, archivedAt: null, id: { not: member.id } },
    });
    if (otherActiveOwners === 0) {
      throw new AppException(409, ErrorCodes.LAST_ACTIVE_OWNER, "The organization must keep at least one active Owner.");
    }
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
