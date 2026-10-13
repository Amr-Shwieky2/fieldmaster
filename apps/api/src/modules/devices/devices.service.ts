import { Injectable } from "@nestjs/common";
import type { DevicePublicKey } from "@prisma/client";
import { base64ToBytes } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { RegisterDevicePublicKeyDto } from "./dto/register-device-public-key.dto";
import type { RegisterDeviceDto } from "./dto/register-device.dto";

const ED25519_PUBLIC_KEY_LENGTH = 32;

/** A device's offline-signing key: none registered yet, active, or revoked by an Owner. */
export const DeviceKeyStatus = { NONE: "NONE", ACTIVE: "ACTIVE", REVOKED: "REVOKED" } as const;
export type DeviceKeyStatus = (typeof DeviceKeyStatus)[keyof typeof DeviceKeyStatus];

export function deviceKeyStatusOf(key: Pick<DevicePublicKey, "revokedAt"> | null): DeviceKeyStatus {
  if (!key) return DeviceKeyStatus.NONE;
  return key.revokedAt ? DeviceKeyStatus.REVOKED : DeviceKeyStatus.ACTIVE;
}

/** `PUT /devices/me` answer (the contract's `RegisteredDevice`). */
export interface RegisteredDevice {
  deviceId: string;
  platform: string;
  keyStatus: DeviceKeyStatus;
  registeredAt: Date;
}

/**
 * Registers the Ed25519 public key a mobile device generated for signing
 * offline attendance events (spec section 20.2). One key per (user,
 * device); re-registering rotates the key going forward without
 * invalidating already-synced history, since verification always uses the
 * key that was current *at registration time* -- OfflineSyncService reads
 * whatever row is currently active, so a rotation simply supersedes it.
 *
 * Step 9: the signed-in device's own registration (`PUT /devices/me`:
 * platform, versions, push token), and the rule for a revoked key below.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Upserts the caller's UserDevice for `deviceId` (Step 9; called on every
   * sign-in and app start). A field left out keeps its value; `null` clears
   * it. A push token is kept on one device only: registering it here removes
   * it from any other device row (another account signed in on the same
   * phone before, or an earlier install), so pushes never reach the previous
   * user. Tokens are never logged or audited.
   */
  async registerDevice(actor: AuthenticatedUser, dto: RegisterDeviceDto): Promise<RegisteredDevice> {
    const now = new Date();
    const optional = <T>(value: T | null | undefined) => (value === undefined ? {} : { value: value ?? null });
    const osVersion = optional(dto.osVersion);
    const appVersion = optional(dto.appVersion);
    const pushToken = optional(dto.pushToken);

    const device = await this.prisma.$transaction(async (tx) => {
      const device = await tx.userDevice.upsert({
        where: { userId_clientDeviceId: { userId: actor.sub, clientDeviceId: dto.deviceId } },
        create: {
          id: generateId(),
          userId: actor.sub,
          clientDeviceId: dto.deviceId,
          platform: dto.platform,
          osVersion: dto.osVersion ?? null,
          appVersion: dto.appVersion ?? null,
          pushToken: dto.pushToken ?? null,
          attestationState: dto.attestationState ?? undefined,
          lastActiveAt: now,
        },
        update: {
          platform: dto.platform,
          ...("value" in osVersion ? { osVersion: osVersion.value } : {}),
          ...("value" in appVersion ? { appVersion: appVersion.value } : {}),
          ...("value" in pushToken ? { pushToken: pushToken.value } : {}),
          ...(dto.attestationState ? { attestationState: dto.attestationState } : {}),
          lastActiveAt: now,
        },
      });
      if (device.pushToken) {
        await tx.userDevice.updateMany({ where: { pushToken: device.pushToken, id: { not: device.id } }, data: { pushToken: null } });
      }
      return device;
    });

    const key = await this.prisma.devicePublicKey.findUnique({ where: { userId_deviceId: { userId: actor.sub, deviceId: dto.deviceId } } });
    return { deviceId: device.clientDeviceId, platform: device.platform, keyStatus: deviceKeyStatusOf(key), registeredAt: device.createdAt };
  }

  /**
   * Re-registering after an Owner revoked the device's key (Step 9). A
   * revoked key stays revoked for every session that existed when it was
   * revoked: a stolen phone that is still signed in must not be able to put
   * a new key in place of the revoked one. Only a session started after the
   * revocation -- the worker signed in again with a fresh OTP, which is what
   * the app does on DEVICE_KEY_REVOKED -- may register a new key for that
   * device. Sessions are refresh-token families: the access token carries the
   * family id (`sid`), and the family's `createdAt` is when that session
   * signed in (refreshing keeps it). A token without `sid` (issued before
   * Step 6) cannot prove when its session started, so it is refused too.
   * Otherwise 403 DEVICE_KEY_REVOKED.
   */
  private async assertMayReplaceRevokedKey(actor: AuthenticatedUser, key: DevicePublicKey): Promise<void> {
    const revokedAt = key.revokedAt;
    if (!revokedAt) return;
    const session = actor.sid ? await this.prisma.refreshTokenFamily.findUnique({ where: { id: actor.sid }, select: { userId: true, createdAt: true } }) : null;
    if (!session || session.userId !== actor.sub || session.createdAt.getTime() <= revokedAt.getTime()) {
      throw new AppException(403, ErrorCodes.DEVICE_KEY_REVOKED, "This device's key was revoked. Sign in again on this device to register a new key.");
    }
  }

  async registerPublicKey(organizationId: string, dto: RegisterDevicePublicKeyDto, actor: AuthenticatedUser, correlationId: string) {
    const keyBytes = base64ToBytes(dto.publicKey);
    if (keyBytes.length !== ED25519_PUBLIC_KEY_LENGTH) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, `publicKey must decode to exactly ${ED25519_PUBLIC_KEY_LENGTH} bytes.`);
    }

    const existing = await this.prisma.devicePublicKey.findUnique({ where: { userId_deviceId: { userId: actor.sub, deviceId: dto.deviceId } } });
    if (existing) await this.assertMayReplaceRevokedKey(actor, existing);

    const record = await this.prisma.devicePublicKey.upsert({
      where: { userId_deviceId: { userId: actor.sub, deviceId: dto.deviceId } },
      create: {
        id: generateId(),
        userId: actor.sub,
        deviceId: dto.deviceId,
        publicKey: dto.publicKey,
        algorithm: dto.algorithm ?? "Ed25519",
      },
      update: {
        publicKey: dto.publicKey,
        algorithm: dto.algorithm ?? "Ed25519",
        revokedAt: null,
        registeredAt: new Date(),
      },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "DEVICE_PUBLIC_KEY_REGISTERED",
      entityType: "DevicePublicKey",
      entityId: record.id,
      note: existing?.revokedAt ? `Replaced the key revoked at ${existing.revokedAt.toISOString()} (a session started after the revocation)` : undefined,
      correlationId,
    });

    return { id: record.id, deviceId: record.deviceId, algorithm: record.algorithm, registeredAt: record.registeredAt };
  }

  /**
   * Owners can revoke a device's signing key the same way they revoke a
   * session (spec section 7.3); offline events signed with it are refused
   * from then on (Step 9: with DEVICE_KEY_REVOKED). The key's user must be a
   * member of the caller's organization (Step 6: checked; before, any user
   * id was accepted).
   */
  async revokePublicKey(organizationId: string, deviceId: string, userId: string, actor: AuthenticatedUser, correlationId: string, reason?: string) {
    const member = UUID_PATTERN.test(userId) ? await this.prisma.organizationMembership.findFirst({ where: { organizationId, userId }, select: { id: true } }) : null;
    const key = member ? await this.prisma.devicePublicKey.findUnique({ where: { userId_deviceId: { userId, deviceId } } }) : null;
    if (!key) throw new AppException(404, ErrorCodes.NOT_FOUND, "Device key not found.");
    if (key.revokedAt) throw new AppException(409, ErrorCodes.CONFLICT, "This device key was already revoked.");

    const record = await this.prisma.devicePublicKey.update({
      where: { id: key.id },
      data: { revokedAt: new Date() },
    });

    await this.auditService.record({
      organizationId,
      actorUserId: actor.sub,
      action: "DEVICE_PUBLIC_KEY_REVOKED",
      entityType: "DevicePublicKey",
      entityId: record.id,
      reason,
      correlationId,
    });

    return { id: record.id, revokedAt: record.revokedAt };
  }
}
