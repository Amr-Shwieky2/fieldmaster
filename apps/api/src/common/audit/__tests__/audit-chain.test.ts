import { createHash } from "node:crypto";
import { AUDIT_GENESIS_HASH, auditChainHash, findChainBreak, type AuditChainRow } from "../audit-chain";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("auditChainHash", () => {
  it("is SHA-256 of the previous hash and the canonical payload, as before; a stored row's other columns are not part of it", () => {
    const previousHash = "ab".repeat(32);
    const event = {
      organizationId: "org-1",
      actorUserId: "user-1",
      action: "PAYROLL_PERIOD_REOPENED",
      entityType: "PayrollPeriod",
      entityId: "period-1",
      oldValue: "1",
      newValue: "2",
      reason: "Late approvals",
      correlationId: "corr-1",
    };
    const expected = sha256(
      previousHash +
        '{"organizationId":"org-1","actorUserId":"user-1","action":"PAYROLL_PERIOD_REOPENED","entityType":"PayrollPeriod","entityId":"period-1",' +
        '"field":null,"oldValue":"1","newValue":"2","reason":"Late approvals","note":null,"correlationId":"corr-1"}',
    );

    expect(auditChainHash(previousHash, event)).toBe(expected);
    const storedRow = { ...event, id: "row-1", field: null, note: null, requestIp: "10.0.0.7", userAgent: "okhttp/4.12", createdAt: new Date(), sequenceNumber: 41 };
    expect(auditChainHash(previousHash, storedRow)).toBe(expected);
  });
});

describe("findChainBreak", () => {
  /** n rows numbered 1..n, each linked to the one before. */
  function chainOf(count: number): AuditChainRow[] {
    const rows: AuditChainRow[] = [];
    let previousHash = AUDIT_GENESIS_HASH;
    for (let n = 1; n <= count; n += 1) {
      const fields = {
        organizationId: "org-1",
        actorUserId: null,
        action: "TEST",
        entityType: "Test",
        entityId: `entity-${n}`,
        field: null,
        oldValue: null,
        newValue: String(n),
        reason: null,
        note: null,
        correlationId: `corr-${n}`,
      };
      const currentHash = auditChainHash(previousHash, fields);
      rows.push({ id: `row-${n}`, sequenceNumber: n, previousHash, currentHash, ...fields });
      previousHash = currentHash;
    }
    return rows;
  }

  it("finds no break in an intact chain or an empty one", () => {
    expect(findChainBreak(chainOf(4))).toBeNull();
    expect(findChainBreak([])).toBeNull();
  });

  it("a changed row breaks the chain at that row: its content, or only its link to the row before", () => {
    const changedContent = chainOf(4);
    changedContent[2] = { ...changedContent[2]!, newValue: "999" };
    expect(findChainBreak(changedContent)).toBe("row-3");

    const changedLink = chainOf(4);
    changedLink[2] = { ...changedLink[2]!, previousHash: "f".repeat(64) };
    expect(findChainBreak(changedLink)).toBe("row-3");
  });

  it("a deleted row breaks the chain at the row after it", () => {
    const rows = chainOf(4);
    rows.splice(2, 1);
    expect(findChainBreak(rows)).toBe("row-4");
  });

  it("the first row must start from the genesis hash", () => {
    expect(findChainBreak(chainOf(3).slice(1))).toBe("row-2");
  });

  it("a fork -- a second row linked to a row that already has a successor -- breaks the chain at that row", () => {
    const rows = chainOf(3);
    const fields = { ...rows[2]!, entityId: "entity-fork", correlationId: "corr-fork" };
    const previousHash = rows[1]!.currentHash;
    rows.push({ ...fields, id: "row-fork", sequenceNumber: 4, previousHash, currentHash: auditChainHash(previousHash, fields) });
    expect(findChainBreak(rows)).toBe("row-fork");
  });

  it("the numbers run 1, 2, 3, ... with no gap: a renumbered row is reported even though its links hold", () => {
    const rows = chainOf(4);
    rows[2] = { ...rows[2]!, sequenceNumber: 7 };
    expect(findChainBreak(rows)).toBe("row-3");
  });
});
