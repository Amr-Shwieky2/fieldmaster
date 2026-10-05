import type { OrgRole } from "@fieldmaster/shared-types";
import type { Request } from "express";

export interface AccessTokenPayload {
  sub: string; // userId
  membershipId: string;
  organizationId: string;
  role: OrgRole;
  isTimeTrackable: boolean;
  workerProfileId: string | null;
  deviceId?: string;
  /** How the session started; absent on tokens issued before this claim existed (treated as OTP). */
  loginMethod?: string;
}

export interface AuthenticatedUser extends AccessTokenPayload {}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  correlationId?: string;
}
