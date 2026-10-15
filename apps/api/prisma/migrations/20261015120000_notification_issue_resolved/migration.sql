-- Mobile manager mode: the temporary supervisor is told their report was
-- resolved. Its own migration: a new enum value is not usable in the
-- transaction that adds it.
ALTER TYPE "NotificationType" ADD VALUE 'TEMPORARY_SUPERVISOR_ISSUE_RESOLVED';
