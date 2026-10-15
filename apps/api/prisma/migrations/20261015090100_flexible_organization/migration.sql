-- Flexible organization model: configurable roles and permissions, per-member
-- project scope, effective-dated work rules, and a configurable limit of
-- Owners. Additive, except that the fixed "max 2 active Owners" trigger is
-- replaced by one that follows organization_settings.max_owners.
--
-- 1. roles: a name and a set of permissions. The three built-in roles are
--    created for every existing organization (system_key OWNER /
--    FIELD_MANAGER / WORKER; their permissions stay in the code, so the
--    permissions every existing member has are exactly what they were), and
--    every existing membership points at its built-in role.
--    organization_memberships.role keeps the "kind" (OWNER / FIELD_MANAGER /
--    WORKER, or CUSTOM for a role an Owner created); role_id is the role
--    record. A trigger fills role_id from `role` for the built-in kinds, so
--    code that still writes only `role` keeps working.
-- 2. member_scopes + organization_memberships.restricted_to_scope: a member
--    restricted to some projects / sites. Nobody is restricted by default.
-- 3. work_rule_versions: the numbers the calculations used to hard-code
--    (9-hour day, two free forgotten stamps, 10.00 penalty, -60 / +15
--    emergency minutes, the clock-in window) as effective-dated versions
--    that can never be updated or deleted. An organization without a row
--    uses the defaults, which are those old numbers.
-- 4. organization_settings.max_owners replaces the fixed limit of 2:
--    existing organizations keep 2 (their behavior does not change); new
--    ones have no limit until an Owner sets one.

-- AlterTable
ALTER TABLE "organization_settings" ADD COLUMN     "max_owners" INTEGER;

-- AlterTable
ALTER TABLE "organization_memberships" ADD COLUMN     "restricted_to_scope" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role_id" UUID;

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system_key" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_scopes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "project_id" UUID,
    "site_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_rule_versions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_from" TEXT NOT NULL,
    "standard_day_minutes" INTEGER NOT NULL,
    "overtime_threshold_minutes" INTEGER NOT NULL,
    "free_forgotten_stamps_per_month" INTEGER NOT NULL,
    "forgotten_stamp_penalty_agorot" INTEGER NOT NULL,
    "emergency_minutes_before" INTEGER NOT NULL,
    "emergency_minutes_after" INTEGER NOT NULL,
    "clock_in_early_window_minutes" INTEGER NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roles_organization_id_archived_at_idx" ON "roles"("organization_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_system_key_key" ON "roles"("organization_id", "system_key");

-- CreateIndex
CREATE INDEX "member_scopes_membership_id_idx" ON "member_scopes"("membership_id");

-- CreateIndex
CREATE INDEX "member_scopes_project_id_idx" ON "member_scopes"("project_id");

-- CreateIndex
CREATE INDEX "member_scopes_site_id_idx" ON "member_scopes"("site_id");

-- CreateIndex
CREATE INDEX "work_rule_versions_organization_id_effective_from_idx" ON "work_rule_versions"("organization_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "work_rule_versions_organization_id_version_key" ON "work_rule_versions"("organization_id", "version");

-- CreateIndex
CREATE INDEX "organization_memberships_role_id_idx" ON "organization_memberships"("role_id");

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_scopes" ADD CONSTRAINT "member_scopes_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_scopes" ADD CONSTRAINT "member_scopes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_scopes" ADD CONSTRAINT "member_scopes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_rule_versions" ADD CONSTRAINT "work_rule_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Built-in roles for the organizations that exist now ───────────────────
INSERT INTO "roles" ("id", "organization_id", "name", "system_key", "permissions", "updated_at")
SELECT gen_random_uuid(), o."id", v."name", v."key", ARRAY[]::TEXT[], CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES ('OWNER', 'المالك'), ('FIELD_MANAGER', 'مدير ميدان'), ('WORKER', 'عامل')) AS v("key", "name");

UPDATE "organization_memberships" m
SET "role_id" = r."id"
FROM "roles" r
WHERE r."organization_id" = m."organization_id" AND r."system_key" = m."role"::TEXT;

-- ── The limit of Owners: existing organizations keep today's 2 ────────────
INSERT INTO "organization_settings" ("id", "organization_id", "updated_at", "max_owners")
SELECT gen_random_uuid(), o."id", CURRENT_TIMESTAMP, 2
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "organization_settings" s WHERE s."organization_id" = o."id");

UPDATE "organization_settings" SET "max_owners" = 2;

-- ── roles ─────────────────────────────────────────────────────────────────
ALTER TABLE "roles" ADD CONSTRAINT "roles_system_key_check" CHECK ("system_key" IS NULL OR "system_key" IN ('OWNER', 'FIELD_MANAGER', 'WORKER'));
-- A custom role's name is unique among the organization's active roles (case-insensitive).
CREATE UNIQUE INDEX "roles_organization_id_name_active_key" ON "roles" ("organization_id", lower("name")) WHERE "archived_at" IS NULL;

-- ── role_id follows `role` for the built-in kinds ─────────────────────────
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_custom_role_check" CHECK ("role" <> 'CUSTOM' OR "role_id" IS NOT NULL);

CREATE OR REPLACE FUNCTION fill_membership_role_id() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role <> 'CUSTOM' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.role_id IS NULL THEN
        SELECT id INTO NEW.role_id FROM roles WHERE organization_id = NEW.organization_id AND system_key = NEW.role::TEXT;
      END IF;
    ELSIF NEW.role IS DISTINCT FROM OLD.role AND NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
      -- `role` was changed on its own: the role record follows it.
      SELECT id INTO NEW.role_id FROM roles WHERE organization_id = NEW.organization_id AND system_key = NEW.role::TEXT;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fill_membership_role_id ON "organization_memberships";
CREATE TRIGGER trg_fill_membership_role_id
  BEFORE INSERT OR UPDATE OF "role" ON "organization_memberships"
  FOR EACH ROW
  EXECUTE FUNCTION fill_membership_role_id();

-- ── The limit of Owners follows the setting (race-safe) ───────────────────
DROP TRIGGER IF EXISTS trg_enforce_max_two_owners ON "organization_memberships";
DROP FUNCTION IF EXISTS enforce_max_two_owners();

CREATE OR REPLACE FUNCTION enforce_max_owners() RETURNS TRIGGER AS $$
DECLARE
  max_allowed INT;
  owner_count INT;
BEGIN
  IF NEW.role = 'OWNER' AND NEW.status = 'ACTIVE' AND NEW.archived_at IS NULL THEN
    -- One change of an organization's Owners at a time: a second concurrent
    -- transaction waits here and then counts the first one's committed row.
    PERFORM pg_advisory_xact_lock(hashtextextended('owners:' || NEW.organization_id::TEXT, 0));
    SELECT max_owners INTO max_allowed FROM organization_settings WHERE organization_id = NEW.organization_id;
    IF max_allowed IS NOT NULL THEN
      SELECT COUNT(*) INTO owner_count
      FROM organization_memberships
      WHERE organization_id = NEW.organization_id
        AND role = 'OWNER'
        AND status = 'ACTIVE'
        AND archived_at IS NULL
        AND id <> NEW.id;
      IF owner_count >= max_allowed THEN
        RAISE EXCEPTION 'organization % already has the maximum of % active Owners', NEW.organization_id, max_allowed
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_max_owners
  BEFORE INSERT OR UPDATE ON "organization_memberships"
  FOR EACH ROW
  EXECUTE FUNCTION enforce_max_owners();

ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_max_owners_check" CHECK ("max_owners" IS NULL OR "max_owners" >= 1);

-- ── member_scopes: exactly one of project / site, no duplicates ───────────
ALTER TABLE "member_scopes" ADD CONSTRAINT "member_scopes_one_target_check" CHECK (("project_id" IS NULL) <> ("site_id" IS NULL));
CREATE UNIQUE INDEX "member_scopes_membership_project_key" ON "member_scopes" ("membership_id", "project_id") WHERE "project_id" IS NOT NULL;
CREATE UNIQUE INDEX "member_scopes_membership_site_key" ON "member_scopes" ("membership_id", "site_id") WHERE "site_id" IS NOT NULL;

-- ── work_rule_versions: sane values, and never updated or deleted ────────
ALTER TABLE "work_rule_versions" ADD CONSTRAINT "work_rule_versions_values_check" CHECK (
  "version" >= 1
  AND "effective_from" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND "standard_day_minutes" BETWEEN 60 AND 1440
  AND "overtime_threshold_minutes" BETWEEN 60 AND 1440
  AND "overtime_threshold_minutes" >= "standard_day_minutes"
  AND "free_forgotten_stamps_per_month" BETWEEN 0 AND 31
  AND "forgotten_stamp_penalty_agorot" BETWEEN 0 AND 1000000
  AND "emergency_minutes_before" BETWEEN 0 AND 720
  AND "emergency_minutes_after" BETWEEN 0 AND 720
  AND "clock_in_early_window_minutes" BETWEEN 0 AND 1440
);

CREATE OR REPLACE FUNCTION refuse_work_rule_version_change() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'work rule versions are never changed or deleted; add a new version instead'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_work_rule_versions_immutable
  BEFORE UPDATE OR DELETE ON "work_rule_versions"
  FOR EACH ROW
  EXECUTE FUNCTION refuse_work_rule_version_change();
