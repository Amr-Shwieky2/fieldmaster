-- Audit log: an explicit, race-safe chain order (spec section 31.4).
--
-- Each organization's audit rows form a SHA-256 hash chain. Until now the
-- writer linked a new row to the newest row by created_at, without a lock,
-- and the verifier walked the rows by created_at. Rows written in the same
-- millisecond could be walked in another order than they were linked (an
-- untampered chain reported broken), and two concurrent writers could link
-- to the same row (a real fork).
--
-- sequence_number is the row's place in its organization's chain: 1, 2, 3,
-- ... with no gap, unique per organization. AuditService.record() assigns it
-- under a per-organization advisory lock held until the writer's transaction
-- ends, and the verifier walks the chain by it. The hash formula does not
-- change.
--
-- Existing rows are numbered by following their own links: the row whose
-- previous_hash is the genesis hash is 1, the row whose previous_hash is that
-- row's current_hash is 2, and so on. Rows the links do not reach -- a chain
-- already broken by a changed or deleted row, or forked by two concurrent
-- writers (the oldest branch is followed) -- come after them, oldest first,
-- so the verifier still reports the break. Nothing is re-hashed or repaired.

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "sequence_number" INTEGER;

-- One index lookup per row while numbering; dropped below.
CREATE INDEX "audit_logs_numbering_idx" ON "audit_logs"("organization_id", "previous_hash");

DO $$
DECLARE
  org_id UUID;
  tip_hash TEXT;
  numbered INTEGER;
  next_id UUID;
  next_hash TEXT;
BEGIN
  FOR org_id IN SELECT DISTINCT "organization_id" FROM "audit_logs" LOOP
    -- Follow the links from the genesis hash. "Not numbered yet" stops a
    -- tampered chain that links back to an earlier row from looping.
    tip_hash := repeat('0', 64);
    numbered := 0;
    LOOP
      SELECT "id", "current_hash" INTO next_id, next_hash
      FROM "audit_logs"
      WHERE "organization_id" = org_id AND "previous_hash" = tip_hash AND "sequence_number" IS NULL
      ORDER BY "created_at", "id"
      LIMIT 1;
      EXIT WHEN NOT FOUND;
      numbered := numbered + 1;
      UPDATE "audit_logs" SET "sequence_number" = numbered WHERE "id" = next_id;
      tip_hash := next_hash;
    END LOOP;

    -- The rows the links did not reach, oldest first.
    UPDATE "audit_logs" AS a
    SET "sequence_number" = numbered + unreached.n
    FROM (
      SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS n
      FROM "audit_logs"
      WHERE "organization_id" = org_id AND "sequence_number" IS NULL
    ) AS unreached
    WHERE a."id" = unreached."id";
  END LOOP;
END $$;

DROP INDEX "audit_logs_numbering_idx";

ALTER TABLE "audit_logs" ALTER COLUMN "sequence_number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_organization_id_sequence_number_key" ON "audit_logs"("organization_id", "sequence_number");
