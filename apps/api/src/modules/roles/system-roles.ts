import type { Prisma } from "@prisma/client";
import { SystemRoleKey } from "@fieldmaster/shared-types";
import { generateId } from "../../common/ids";

type Db = Pick<Prisma.TransactionClient, "role" | "$executeRaw">;

/** The built-in roles' names (Arabic, as the screens show them). Their permissions are in the code, never in the database. */
export const SYSTEM_ROLE_NAMES: Record<SystemRoleKey, string> = {
  [SystemRoleKey.OWNER]: "المالك",
  [SystemRoleKey.FIELD_MANAGER]: "مدير ميدان",
  [SystemRoleKey.WORKER]: "عامل",
};

/**
 * Makes sure the organization has its three built-in role records and that
 * every member of a built-in kind points at theirs. New organizations get
 * them when they are created; the migration made them for the existing
 * ones; this covers an organization created without (a test fixture, a
 * restore) the first time roles are used.
 */
export async function ensureSystemRoles(db: Db, organizationId: string): Promise<void> {
  const existing = await db.role.findMany({ where: { organizationId, systemKey: { not: null } }, select: { systemKey: true } });
  const have = new Set(existing.map((role) => role.systemKey));
  const missing = (Object.values(SystemRoleKey) as SystemRoleKey[]).filter((key) => !have.has(key));
  if (missing.length > 0) {
    await db.role.createMany({
      data: missing.map((key) => ({ id: generateId(), organizationId, name: SYSTEM_ROLE_NAMES[key], systemKey: key, permissions: [] })),
      skipDuplicates: true,
    });
  }
  // Members of a built-in kind without a role record (written before the roles existed).
  await db.$executeRaw`
    UPDATE organization_memberships m
    SET role_id = r.id
    FROM roles r
    WHERE m.organization_id = ${organizationId}::uuid
      AND m.role_id IS NULL
      AND m.role <> 'CUSTOM'
      AND r.organization_id = m.organization_id
      AND r.system_key = m.role::text`;
}
