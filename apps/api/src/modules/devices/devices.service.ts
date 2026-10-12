import { Injectable } from "@nestjs/common";
import { base64ToBytes } from "@fieldmaster/shared-validation";
import { PrismaService } from "../../common/prisma/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { generateId } from "../../common/ids";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { UUID_PATTERN } from "../../common/validation/patterns";
import type { AuthenticatedUser } from "../../common/auth/auth-context";
import type { RegisterDevicePublicKeyDto } from "./dto/register-device-public-key.dto";

const ED25519_PUBLIC_KEY_LENGTH = 32;

/**
 * Registers the Ed25519 public key a mobile device generated for signing
 * offline attendance events (spec section 20.2). One key per (user,
 * device); re-registering rotates the key going forward without
 * invalidating already-synced history, since verification always uses the
 * key that was current *at registration time* -- OfflineSyncService reads
 * whatever row is currently active, so a rotation simply supersedes it.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async registerPublicKey(organizationId: string, dto: RegisterDevicePublicKeyDto, actor: AuthenticatedUser, correlationId: string) {
    const keyBytes = base64ToBytes(dto.publicKey);
    if (keyBytes.length !== ED25519_PUBLIC_KEY_LENGTH) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, `publicKey must decode to exactly ${ED25519_PUBLIC_KEY_LENGTH} bytes.`);
    }

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
      correlationId,
    });

    return { id: record.id, deviceId: record.deviceId, algorithm: record.algorithm, registeredAt: record.registeredAt };
  }

  /**
   * Owners can revoke a device's signing key the same way they revoke a
   * session (spec section 7.3); offline events signed with it are refused
   * from then on. The key's user must be a member of the caller's
   * organization (Step 6: checked; before, any user id was accepted).
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
