import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { AccountStatus } from "@fieldmaster/shared-types";
import { PrismaService } from "../../common/prisma/prisma.service";
import { generateId } from "../../common/ids";
import { AppException } from "../../common/errors/app-exception";
import { OTP_PROVIDER } from "./otp-providers/otp-provider.token";
import type { OtpProvider } from "./otp-providers/otp-provider.interface";
import type { VerifyOtpDto } from "./dto/verify-otp.dto";
import { parseDurationMs } from "./duration.util";

const OTP_TTL_MS = Number(process.env.OTP_TTL_SECONDS ?? 300) * 1000;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);
const OTP_MAX_REQUESTS_PER_WINDOW = 5;
const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  async requestOtp(phoneNumber: string): Promise<void> {
    const windowStart = new Date(Date.now() - OTP_REQUEST_WINDOW_MS);
    const recentCount = await this.prisma.otpChallenge.count({
      where: { phoneNumber, createdAt: { gte: windowStart } },
    });
    if (recentCount >= OTP_MAX_REQUESTS_PER_WINDOW) {
      throw new AppException(429, "OTP_RATE_LIMITED", "Too many verification codes requested. Try again later.");
    }

    const result = await this.otpProvider.request(phoneNumber);
    const codeHash = result.devCode ? await argon2.hash(result.devCode) : null;

    await this.prisma.otpChallenge.create({
      data: {
        id: generateId(),
        phoneNumber,
        provider: this.otpProvider.name,
        codeHash,
        providerRef: result.providerRef,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<AuthTokens & { organizationId: string; role: string }> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phoneNumber: dto.phoneNumber, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!challenge || challenge.expiresAt < new Date()) {
      throw new AppException(401, "OTP_INVALID_OR_EXPIRED", "This verification code is invalid or has expired.");
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppException(401, "OTP_MAX_ATTEMPTS_EXCEEDED", "Too many incorrect attempts. Request a new code.");
    }

    const isValid =
      challenge.provider === "CONSOLE"
        ? challenge.codeHash !== null && (await argon2.verify(challenge.codeHash, dto.code))
        : await this.otpProvider.verify(dto.phoneNumber, dto.code, challenge.providerRef);

    if (!isValid) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new AppException(401, "OTP_INVALID_OR_EXPIRED", "Incorrect verification code.");
    }

    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const user = await this.prisma.user.findUnique({ where: { phoneNumber: dto.phoneNumber } });
    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new NotFoundException("No active account found for this phone number.");
    }

    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId: user.id, status: AccountStatus.ACTIVE, archivedAt: null },
    });

    let membership = memberships[0];
    if (memberships.length === 0) {
      throw new AppException(403, "NO_ACTIVE_MEMBERSHIP", "This account has no active organization membership.");
    }
    if (memberships.length > 1) {
      if (!dto.organizationId) {
        throw new AppException(400, "ORGANIZATION_SELECTION_REQUIRED", "Select which organization to sign in to.", {
          organizations: memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
        });
      }
      const selected = memberships.find((m) => m.organizationId === dto.organizationId);
      if (!selected) {
        throw new AppException(403, "FORBIDDEN", "You are not a member of the requested organization.");
      }
      membership = selected;
    }

    const device = await this.prisma.userDevice.upsert({
      where: { userId_clientDeviceId: { userId: user.id, clientDeviceId: dto.deviceId } },
      create: {
        id: generateId(),
        userId: user.id,
        clientDeviceId: dto.deviceId,
        platform: dto.platform,
        appVersion: dto.appVersion,
        pushToken: dto.pushToken,
        lastActiveAt: new Date(),
      },
      update: {
        platform: dto.platform,
        appVersion: dto.appVersion ?? undefined,
        pushToken: dto.pushToken ?? undefined,
        lastActiveAt: new Date(),
      },
    });

    const workerProfile = await this.prisma.workerProfile.findUnique({ where: { membershipId: membership.id } });

    const tokens = await this.issueTokenPair({
      userId: user.id,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      role: membership.role,
      isTimeTrackable: membership.isTimeTrackable,
      workerProfileId: workerProfile?.id ?? null,
      deviceId: device.id,
    });

    return { ...tokens, organizationId: membership.organizationId, role: membership.role };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const [familyId, secret] = refreshToken.split(":");
    if (!familyId || !secret) {
      throw new AppException(401, "INVALID_REFRESH_TOKEN", "Malformed refresh token.");
    }

    const family = await this.prisma.refreshTokenFamily.findUnique({ where: { id: familyId } });
    if (!family || family.revokedAt) {
      throw new AppException(401, "REFRESH_TOKEN_REVOKED", "This session has been revoked. Please sign in again.");
    }

    const maxAgeMs = parseDurationMs(process.env.JWT_REFRESH_TTL ?? "30d");
    if (family.createdAt.getTime() + maxAgeMs < Date.now()) {
      await this.revokeFamily(family.id, "EXPIRED");
      throw new AppException(401, "REFRESH_TOKEN_EXPIRED", "Session expired. Please sign in again.");
    }

    const providedHash = createHash("sha256").update(secret).digest("hex");
    if (providedHash !== family.currentTokenHash) {
      // Reuse of a rotated-out token is a strong signal of theft: kill the
      // whole family immediately (spec section 7.1).
      await this.revokeFamily(family.id, "TOKEN_REUSE_DETECTED");
      this.logger.warn(`Refresh token reuse detected for family ${family.id}`);
      throw new AppException(401, "REFRESH_TOKEN_REUSED", "Session invalidated due to suspicious activity. Please sign in again.");
    }

    // Re-derive full context from the user's current active membership
    // rather than trusting anything embedded in the old token.
    const activeMembership = await this.prisma.organizationMembership.findFirst({
      where: { userId: family.userId, status: AccountStatus.ACTIVE, archivedAt: null },
    });
    if (!activeMembership) {
      throw new AppException(401, "NO_ACTIVE_MEMBERSHIP", "This account has no active organization membership.");
    }

    const workerProfile = await this.prisma.workerProfile.findUnique({
      where: { membershipId: activeMembership.id },
    });

    return this.rotateTokens(family.id, {
      userId: activeMembership.userId,
      membershipId: activeMembership.id,
      organizationId: activeMembership.organizationId,
      role: activeMembership.role,
      isTimeTrackable: activeMembership.isTimeTrackable,
      workerProfileId: workerProfile?.id ?? null,
      deviceId: family.deviceId,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const [familyId] = refreshToken.split(":");
    if (!familyId) return;
    await this.revokeFamily(familyId, "LOGOUT");
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.prisma.refreshTokenFamily.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "DEVICE_REVOKED_BY_OWNER" },
    });
    await this.prisma.userDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
  }

  private async issueTokenPair(payload: {
    userId: string;
    membershipId: string;
    organizationId: string;
    role: string;
    isTimeTrackable: boolean;
    workerProfileId: string | null;
    deviceId: string;
  }): Promise<AuthTokens> {
    const familyId = generateId();
    const secret = randomBytes(32).toString("hex");
    const currentTokenHash = createHash("sha256").update(secret).digest("hex");

    await this.prisma.refreshTokenFamily.create({
      data: { id: familyId, userId: payload.userId, deviceId: payload.deviceId, currentTokenHash },
    });

    return this.signAccessToken(payload, familyId, secret);
  }

  private async rotateTokens(
    familyId: string,
    payload: {
      userId: string;
      membershipId: string;
      organizationId: string;
      role: string;
      isTimeTrackable: boolean;
      workerProfileId: string | null;
      deviceId: string;
    },
  ): Promise<AuthTokens> {
    const secret = randomBytes(32).toString("hex");
    const currentTokenHash = createHash("sha256").update(secret).digest("hex");
    await this.prisma.refreshTokenFamily.update({ where: { id: familyId }, data: { currentTokenHash } });
    return this.signAccessToken(payload, familyId, secret);
  }

  private async signAccessToken(
    payload: {
      userId: string;
      membershipId: string;
      organizationId: string;
      role: string;
      isTimeTrackable: boolean;
      workerProfileId: string | null;
      deviceId: string;
    },
    familyId: string,
    refreshSecret: string,
  ): Promise<AuthTokens> {
    const accessTtl = process.env.JWT_ACCESS_TTL ?? "15m";
    const accessToken = await this.jwtService.signAsync(
      {
        sub: payload.userId,
        membershipId: payload.membershipId,
        organizationId: payload.organizationId,
        role: payload.role,
        isTimeTrackable: payload.isTimeTrackable,
        workerProfileId: payload.workerProfileId,
        deviceId: payload.deviceId,
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: accessTtl },
    );

    return {
      accessToken,
      refreshToken: `${familyId}:${refreshSecret}`,
      expiresIn: Math.floor(parseDurationMs(accessTtl) / 1000),
    };
  }

  private async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshTokenFamily.update({
      where: { id: familyId },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }
}
