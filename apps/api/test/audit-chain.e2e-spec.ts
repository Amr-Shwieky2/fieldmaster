import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { createOrgWithOwner } from "./fixtures";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { AuditService, type RecordAuditEventInput } from "../src/common/audit/audit.service";
import { AUDIT_GENESIS_HASH } from "../src/common/audit/audit-chain";

/**
 * The audit log's hash chain (spec section 31.4) with concurrent writers and
 * rows written in the same millisecond. Each organization's rows form one
 * line: every row links to the row before it, writers never fork it (a
 * request and a background job at the same time, or a transaction still
 * open), and verification follows that order, never created_at. A changed
 * or deleted row is still reported where the chain breaks.
 */

const OWNER_PHONE = "+972500000001";
const OTHER_ORG_OWNER_PHONE = "+972500000099";

describe("Audit log hash chain", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  let organizationId: string;
  let ownerUserId: string;
  let ownerToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    audit = app.get(AuditService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE);
    organizationId = owner.org.id;
    ownerUserId = owner.user.id;
    ownerToken = (await loginAs(app, OWNER_PHONE)).accessToken;
  });

  /** A distinct event: its own entity, value and correlation id. */
  function event(n: number, orgId = organizationId, actorUserId = ownerUserId): RecordAuditEventInput {
    return { organizationId: orgId, actorUserId, action: "CHAIN_TEST", entityType: "ChainTest", entityId: `entity-${n}`, newValue: String(n), correlationId: uuidv7() };
  }

  async function recordInOrder(count: number) {
    const rows = [];
    for (let n = 1; n <= count; n += 1) rows.push(await audit.record(event(n)));
    return rows;
  }

  /** What the Owner's "verify" button gets. */
  async function verify() {
    const response = await request(app.getHttpServer()).get("/api/v1/audit-logs/verify").set("Authorization", `Bearer ${ownerToken}`).expect(200);
    return response.body;
  }

  /** The organization's rows and the line their links draw: from the genesis hash, each row's current hash to the row whose previous hash it is. */
  async function links(orgId: string) {
    const rows = await prisma.auditLog.findMany({ where: { organizationId: orgId } });
    const byPreviousHash = new Map<string, typeof rows>();
    for (const row of rows) byPreviousHash.set(row.previousHash, [...(byPreviousHash.get(row.previousHash) ?? []), row]);
    const line = [];
    for (let next = byPreviousHash.get(AUDIT_GENESIS_HASH)?.[0]; next; next = byPreviousHash.get(next.currentHash)?.[0]) line.push(next);
    const forks = [...byPreviousHash.values()].filter((children) => children.length > 1).length;
    return { rows, line, forks };
  }

  it("concurrent writers -- on their own or inside a caller's transaction -- still give each organization one chain that verifies", async () => {
    const other = await createOrgWithOwner(prisma, OTHER_ORG_OWNER_PHONE);
    await Promise.all(
      Array.from({ length: 40 }, (_, n) => {
        const input = n % 4 === 3 ? event(n, other.org.id, other.user.id) : event(n);
        return n % 2 === 0 ? audit.record(input) : prisma.$transaction((tx) => audit.record(input, tx));
      }),
    );

    // One line through every row, numbered 1, 2, 3, ... along it.
    for (const [orgId, count] of [[organizationId, 30], [other.org.id, 10]] as const) {
      const { rows, line, forks } = await links(orgId);
      expect(rows).toHaveLength(count);
      expect(forks).toBe(0);
      expect(line.map((row) => row.sequenceNumber)).toEqual(rows.map((_, index) => index + 1));
    }
    expect(await verify()).toEqual({ valid: true });
    expect(await audit.verifyOrganizationChain(other.org.id)).toEqual({ valid: true });
  });

  it("a writer whose transaction is still open holds the chain: the next writer waits for it and links to its row", async () => {
    let firstRecorded!: () => void;
    const recorded = new Promise<void>((resolve) => (firstRecorded = resolve));
    // E.g. a report job: its audit row is written, its transaction is not committed yet.
    const job = prisma.$transaction(async (tx) => {
      const row = await audit.record(event(1), tx);
      firstRecorded();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return row;
    });
    await recorded;

    // A request meanwhile.
    const next = await audit.record(event(2));
    const first = await job;
    expect(next).toMatchObject({ previousHash: first.currentHash, sequenceNumber: first.sequenceNumber + 1 });
    expect(await verify()).toEqual({ valid: true });
  });

  it("a row rolled back with its transaction leaves no gap: the next row links to the last committed one", async () => {
    const [kept] = await recordInOrder(1);
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.record(event(2), tx);
        throw new Error("The caller's change failed");
      }),
    ).rejects.toThrow("The caller's change failed");

    const next = await audit.record(event(3));
    expect(next).toMatchObject({ previousHash: kept!.currentHash, sequenceNumber: kept!.sequenceNumber + 1 });
    expect(await verify()).toEqual({ valid: true });
  });

  /** Gives the rows one created_at, written last to first: sorted by created_at, the ties come back newest first. */
  async function shareOneMillisecond(rows: { id: string }[]) {
    const sameMillisecond = new Date("2026-10-13T09:00:00.000Z");
    for (const row of [...rows].reverse()) await prisma.auditLog.update({ where: { id: row.id }, data: { createdAt: sameMillisecond } });
  }

  it("rows with identical created_at verify, and the next row links to the last of them: the chain's own order counts, not the timestamps", async () => {
    const rows = await recordInOrder(6);
    await shareOneMillisecond(rows);

    const next = await audit.record(event(7));
    expect(next.previousHash).toBe(rows[5]!.currentHash);
    expect(await verify()).toEqual({ valid: true });
  });

  it("a row changed in the database is reported at that row, also among rows with identical created_at", async () => {
    const rows = await recordInOrder(5);
    await shareOneMillisecond(rows);

    await prisma.auditLog.update({ where: { id: rows[2]!.id }, data: { newValue: "999" } });
    expect(await verify()).toEqual({ valid: false, brokenAtId: rows[2]!.id });
  });

  it("a row deleted from the middle is reported at the row after it", async () => {
    const rows = await recordInOrder(5);

    await prisma.auditLog.delete({ where: { id: rows[2]!.id } });
    expect(await verify()).toEqual({ valid: false, brokenAtId: rows[3]!.id });
  });
});
