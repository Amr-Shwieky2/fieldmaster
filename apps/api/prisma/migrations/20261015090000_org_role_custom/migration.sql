-- Flexible organization model, part 1: the member "kind" CUSTOM (a role an
-- Owner created). A new enum value cannot be used in the transaction that
-- adds it, so it is added here and used by 20261015090100_flexible_organization.

ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'CUSTOM';
