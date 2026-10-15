import type { OrgRole, Permission } from "@fieldmaster/shared-types";
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
  /** The session (refresh-token family id); absent on tokens issued before Step 6. A revoked session is refused at once. */
  sid?: string;
}

/**
 * Which projects and sites a member is restricted to. Not restricted: every
 * project. `siteIds` already holds the sites of the selected projects as well
 * as the sites selected one by one; `projectIds` are the projects selected
 * whole; `visibleProjectIds` also has the projects of the sites selected one
 * by one (a project the member can see, though maybe not all of its sites).
 */
export type MemberScope =
  | { restricted: false }
  | { restricted: true; projectIds: string[]; siteIds: string[]; visibleProjectIds: string[] };

/**
 * The signed-in member as the guard resolves them on every request. Role,
 * permissions and scope come from the database (the membership and its
 * role), never from the token: a change applies to the very next request.
 */
export interface AuthenticatedUser extends AccessTokenPayload {
  /** The member's role record; absent in plain test objects. */
  roleId?: string | null;
  roleName?: string;
  /** The effective permissions: the role's, minus the organization-wide ones when the member is restricted to some projects. */
  permissions?: ReadonlySet<Permission>;
  scope?: MemberScope;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  correlationId?: string;
}
