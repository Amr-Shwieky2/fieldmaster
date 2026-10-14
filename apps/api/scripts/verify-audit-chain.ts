/**
 * Standalone audit-integrity verification command (spec section 31.4).
 * Walks every organization's SHA-256 hash chain in its order (sequence
 * number) and reports the first broken link, if any -- the same check as
 * GET /audit-logs/verify. Run with: pnpm --filter @fieldmaster/api verify-audit
 */
import { PrismaClient } from "@prisma/client";
import { findChainBreak, readOrganizationChain } from "../src/common/audit/audit-chain";

async function main() {
  const prisma = new PrismaClient();
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });

  let anyBroken = false;

  for (const org of organizations) {
    const events = await readOrganizationChain(prisma, org.id);
    const brokenAtId = findChainBreak(events);
    if (brokenAtId) {
      console.error(`[FAIL] Organization "${org.name}" (${org.id}): chain broken at audit log ${brokenAtId}`);
      anyBroken = true;
    } else {
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
