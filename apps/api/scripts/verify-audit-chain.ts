/**
 * Standalone audit-integrity verification command (spec section 31.4).
 * Walks every organization's SHA-256 hash chain and reports the first
 * broken link, if any. Run with: pnpm --filter @fieldmaster/api verify-audit
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const AUDIT_GENESIS_HASH = "0".repeat(64);

async function main() {
  const prisma = new PrismaClient();
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });

  let anyBroken = false;

  for (const org of organizations) {
    const events = await prisma.auditLog.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });
    let expectedPrevious = AUDIT_GENESIS_HASH;
    let broken = false;

    for (const event of events) {
      const canonicalPayload = JSON.stringify({
        organizationId: event.organizationId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        field: event.field ?? null,
        oldValue: event.oldValue ?? null,
        newValue: event.newValue ?? null,
        reason: event.reason ?? null,
        note: event.note ?? null,
        correlationId: event.correlationId,
      });
      const expectedHash = createHash("sha256").update(expectedPrevious + canonicalPayload).digest("hex");
      if (event.previousHash !== expectedPrevious || event.currentHash !== expectedHash) {
        console.error(`[FAIL] Organization "${org.name}" (${org.id}): chain broken at audit log ${event.id}`);
        broken = true;
        anyBroken = true;
        break;
      }
      expectedPrevious = event.currentHash;
    }

    if (!broken) {
      console.log(`[OK] Organization "${org.name}" (${org.id}): ${events.length} audit events verified.`);
    }
  }

  await prisma.$disconnect();
  process.exit(anyBroken ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
