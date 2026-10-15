-- Scalability (flexible organization model): indexes for the organization
-- and project-scope filters of the lists, the operations page and payroll.

-- A month's entries of one status (payroll, the financial dashboard, the
-- approvals queue): organization, status, then the business-date range. It
-- serves every query the (organization, status) index served.
CREATE INDEX "time_entries_organization_id_status_business_date_idx" ON "time_entries"("organization_id", "status", "business_date");
DROP INDEX "time_entries_organization_id_status_idx";

-- The attendance list by business date (every status).
CREATE INDEX "time_entries_organization_id_business_date_idx" ON "time_entries"("organization_id", "business_date");

-- A shift's entries, and the entries of a member's projects (through their shifts).
CREATE INDEX "time_entries_shift_id_idx" ON "time_entries"("shift_id");

-- The shifts and sites of a member's projects or sites.
CREATE INDEX "shifts_project_id_idx" ON "shifts"("project_id");
CREATE INDEX "shifts_site_id_idx" ON "shifts"("site_id");
CREATE INDEX "sites_project_id_idx" ON "sites"("project_id");

-- The organization's forgotten stamps by month.
CREATE INDEX "forgotten_stamp_infractions_organization_id_business_month_idx" ON "forgotten_stamp_infractions"("organization_id", "business_month");
