import type { Prisma } from "@prisma/client";
import { OrgRole } from "@fieldmaster/shared-types";
import type { AuthenticatedUser } from "../../common/auth/auth-context";

/**
 * Every project column except the budget, which only Owners may see (spec
 * section 6.2 / 23.5). Queries that return a project to anyone else select
 * these columns instead of fetching the budget and stripping it afterwards.
 * An allowlist on purpose: a column added to Project later stays hidden from
 * Field Managers and Workers until it is added here.
 */
export const PROJECT_FIELDS_WITHOUT_BUDGET = {
  id: true,
  organizationId: true,
  name: true,
  client: true,
  projectCode: true,
  description: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
} satisfies Prisma.ProjectSelect;

/** The project columns `viewer` may see, as a Prisma `select`: all of them for an Owner, never the budget for anyone else. */
export function projectSelectFor(viewer: AuthenticatedUser): Prisma.ProjectSelect | undefined {
  return viewer.role === OrgRole.OWNER ? undefined : PROJECT_FIELDS_WITHOUT_BUDGET;
}
