/**
 * Load-test data (docs/scalability.md): one organization with 500 workers,
 * 50 sites in 10 projects and 6 months of attendance, written straight into
 * an empty, migrated database with a few bulk statements.
 *
 *   createdb fieldmaster_load && DATABASE_URL=<...fieldmaster_load...> pnpm --filter @fieldmaster/api db:migrate
 *   DATABASE_URL=<...fieldmaster_load...> pnpm --filter @fieldmaster/api load:generate
 *
 * It REFUSES to run unless the database name contains "load", and wipes that
 * database first. Sizes: LOAD_WORKERS (500), LOAD_SITES (50), LOAD_MONTHS (6).
 */
import { PrismaClient } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import type { PrismaService } from "../../src/common/prisma/prisma.service";
import { ensureSystemRoles } from "../../src/modules/roles/system-roles";

const WORKERS = Number(process.env.LOAD_WORKERS ?? 500);
const SITES = Number(process.env.LOAD_SITES ?? 50);
const MONTHS = Number(process.env.LOAD_MONTHS ?? 6);
const PROJECTS = Math.max(1, Math.round(SITES / 5));

const prisma = new PrismaClient();
const id = () => uuidv7();

async function sql(label: string, statement: string, ...values: unknown[]) {
  const started = Date.now();
  const count = await prisma.$executeRawUnsafe(statement, ...values);
  console.log(`  ${label}: ${count} rows (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

async function main() {
  const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/y").pathname.slice(1);
  if (!dbName.includes("load")) throw new Error(`Refusing to wipe "${dbName}": the load-test database must have "load" in its name.`);
  console.log(`Wiping and filling "${dbName}": ${WORKERS} workers, ${SITES} sites in ${PROJECTS} projects, ${MONTHS} months of attendance.`);
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      idempotency_records, otp_challenges, generated_reports,
      payroll_calculation_snapshots, payroll_calculation_runs, payroll_adjustments, payroll_items, payroll_periods,
      forgotten_stamp_infractions, manual_time_corrections, attendance_approvals, daily_summaries,
      unpaid_breaks, rejected_clock_attempts, clock_events, emergency_callouts, time_entries,
      temporary_check_in_points, temporary_supervisor_assignments, shift_assignments, shifts,
      turan_assignments, geofences, sites, projects, notification_deliveries, notifications,
      offline_sync_events, offline_sync_batches, device_public_keys,
      onboarding_invitations, identity_documents, encrypted_bank_accounts, compensation_profiles, worker_profiles, file_assets,
      refresh_token_families, user_devices, member_scopes, organization_memberships, roles, work_rule_versions, users,
      audit_logs, organization_settings, organizations
    RESTART IDENTITY CASCADE`);

  const orgId = id();
  await prisma.$executeRawUnsafe(`INSERT INTO organizations (id, name, updated_at) VALUES ($1::uuid, 'مؤسسة اختبار الحمل', now())`, orgId);
  await prisma.$executeRawUnsafe(`INSERT INTO organization_settings (id, organization_id, updated_at) VALUES ($1::uuid, $2::uuid, now())`, id(), orgId);
  await ensureSystemRoles(prisma as unknown as PrismaService as never, orgId);

  // Members who run the place.
  const staff = [
    { phone: "+972500000001", name: "المالك", role: "OWNER" },
    { phone: "+972500000011", name: "مدير الميدان الأول", role: "FIELD_MANAGER" },
    { phone: "+972500000012", name: "مدير الميدان الثاني", role: "FIELD_MANAGER" },
  ];
  const staffIds: { userId: string; membershipId: string; role: string }[] = [];
  for (const member of staff) {
    const userId = id();
    const membershipId = id();
    await prisma.$executeRawUnsafe(`INSERT INTO users (id, phone_number, full_legal_name, updated_at) VALUES ($1::uuid, $2, $3, now())`, userId, member.phone, member.name);
    await prisma.$executeRawUnsafe(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"OrgRole", now())`,
      membershipId,
      orgId,
      userId,
      member.role,
    );
    staffIds.push({ userId, membershipId, role: member.role });
  }
  const ownerUserId = staffIds[0].userId;
  const managerUserId = staffIds[1].userId;

  console.log("Workers, projects, sites:");
  await sql(
    "users",
    `INSERT INTO users (id, phone_number, full_legal_name, updated_at)
     SELECT gen_random_uuid(), '+9725010' || lpad(g::text, 5, '0'), 'عامل ' || lpad(g::text, 4, '0'), now() FROM generate_series(1, $1::int) g`,
    WORKERS,
  );
  await sql(
    "memberships",
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, is_time_trackable, updated_at)
     SELECT gen_random_uuid(), $1::uuid, u.id, 'WORKER', true, now() FROM users u WHERE u.phone_number LIKE '+9725010%'`,
    orgId,
  );
  await sql(
    "worker profiles",
    `INSERT INTO worker_profiles (id, membership_id, organization_id, updated_at)
     SELECT gen_random_uuid(), m.id, m.organization_id, now() FROM organization_memberships m WHERE m.role = 'WORKER' AND m.organization_id = $1::uuid`,
    orgId,
  );
  await sql(
    "compensation profiles",
    `INSERT INTO compensation_profiles (id, worker_profile_id, compensation_type, daily_base_rate_agorot, base_hourly_rate_agorot, overtime_hourly_rate_agorot, effective_start_date, change_reason, created_by, updated_at)
     SELECT gen_random_uuid(), w.id,
            CASE WHEN w.rn % 3 = 0 THEN 'HOURLY'::"CompensationType" ELSE 'DAILY'::"CompensationType" END,
            CASE WHEN w.rn % 3 = 0 THEN NULL ELSE 45000 END,
            CASE WHEN w.rn % 3 = 0 THEN 5500 ELSE NULL END,
            7000, DATE '2020-01-01', 'اختبار الحمل', $2::uuid, now()
     FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM worker_profiles WHERE organization_id = $1::uuid) w`,
    orgId,
    ownerUserId,
  );
  await sql(
    "projects",
    `INSERT INTO projects (id, organization_id, name, project_code, status, budget_agorot, updated_at)
     SELECT gen_random_uuid(), $1::uuid, 'مشروع ' || g, 'LOAD-' || lpad(g::text, 3, '0'), 'ACTIVE', 50000000, now() FROM generate_series(1, $2::int) g`,
    orgId,
    PROJECTS,
  );
  await sql(
    "sites",
    `INSERT INTO sites (id, organization_id, project_id, name, latitude, longitude, default_geofence_radius_meters, updated_at)
     SELECT gen_random_uuid(), $1::uuid, p.id, 'موقع ' || s.n, 32.0 + s.n * 0.002, 34.7 + s.n * 0.002, 150, now()
     FROM (SELECT g AS n FROM generate_series(1, $2::int) g) s
     JOIN (SELECT id, row_number() OVER (ORDER BY project_code) AS rn FROM projects WHERE organization_id = $1::uuid) p ON p.rn = ((s.n - 1) % $3::int) + 1`,
    orgId,
    SITES,
    PROJECTS,
  );
  await sql(
    "geofences",
    `INSERT INTO geofences (id, organization_id, site_id, center_latitude, center_longitude, radius_meters, min_accuracy_meters, created_by, updated_at)
     SELECT gen_random_uuid(), organization_id, id, latitude, longitude, 150, 50, $2::uuid, now() FROM sites WHERE organization_id = $1::uuid`,
    orgId,
    ownerUserId,
  );

  // The days: Sunday to Thursday, from MONTHS months ago to yesterday, in Jerusalem; plus today's shifts (clock-in test).
  console.log("Shifts, assignments and attendance:");
  const days = `(SELECT d::date AS day FROM generate_series(((now() AT TIME ZONE 'Asia/Jerusalem')::date - ($1::int * 31)), ((now() AT TIME ZONE 'Asia/Jerusalem')::date - 1), interval '1 day') d WHERE extract(dow FROM d) BETWEEN 0 AND 4)`;
  await sql(
    "shifts (past)",
    `INSERT INTO shifts (id, organization_id, project_id, site_id, geofence_id, shift_type, title, scheduled_start, scheduled_end, business_date, manager_id, status, created_by, closed_at, updated_at)
     SELECT gen_random_uuid(), $2::uuid, s.project_id, s.id, g.id, 'STANDARD', 'وردية ' || s.name,
            (((d.day + time '05:00') AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'UTC'),
            (((d.day + time '15:00') AT TIME ZONE 'Asia/Jerusalem') AT TIME ZONE 'UTC'),
            to_char(d.day, 'YYYY-MM-DD'), $3::uuid, 'CLOSED', $3::uuid, now(), now()
     FROM sites s JOIN geofences g ON g.site_id = s.id CROSS JOIN ${days} d WHERE s.organization_id = $2::uuid`,
    MONTHS,
    orgId,
    managerUserId,
  );
  // Today's shifts: started an hour ago, nobody has clocked in yet.
  await sql(
    "shifts (today)",
    `INSERT INTO shifts (id, organization_id, project_id, site_id, geofence_id, shift_type, title, scheduled_start, scheduled_end, business_date, manager_id, status, created_by, updated_at)
     SELECT gen_random_uuid(), $1::uuid, s.project_id, s.id, g.id, 'STANDARD', 'وردية اليوم ' || s.name,
            (now() AT TIME ZONE 'UTC') - interval '1 hour', (now() AT TIME ZONE 'UTC') + interval '9 hours',
            to_char((now() AT TIME ZONE 'Asia/Jerusalem')::date, 'YYYY-MM-DD'), $2::uuid, 'PUBLISHED', $2::uuid, now()
     FROM sites s JOIN geofences g ON g.site_id = s.id WHERE s.organization_id = $1::uuid`,
    orgId,
    managerUserId,
  );
  // Worker i works at site (i mod SITES) every day.
  await sql(
    "assignments",
    `INSERT INTO shift_assignments (id, shift_id, worker_profile_id, assigned_by)
     SELECT gen_random_uuid(), sh.id, w.id, $2::uuid
     FROM (SELECT id, (row_number() OVER (ORDER BY id) - 1) % $3::int AS site_slot FROM worker_profiles WHERE organization_id = $1::uuid) w
     JOIN (SELECT id, site_id, (row_number() OVER (PARTITION BY business_date ORDER BY site_id) - 1) AS site_slot FROM shifts WHERE organization_id = $1::uuid) sh ON sh.site_slot = w.site_slot`,
    orgId,
    managerUserId,
    SITES,
  );
  await sql(
    "time entries (past days)",
    `INSERT INTO time_entries (id, organization_id, worker_profile_id, shift_id, status, business_date, clock_in_at, clock_out_at, check_in_method,
                               raw_duration_minutes, approved_regular_minutes, approved_overtime_minutes, approved_by, approved_at, updated_at)
     SELECT gen_random_uuid(), sh.organization_id, a.worker_profile_id, sh.id,
            CASE WHEN sh.business_date < to_char((now() AT TIME ZONE 'Asia/Jerusalem')::date - 7, 'YYYY-MM-DD') THEN 'APPROVED'::"TimeEntryStatus" ELSE 'PENDING_APPROVAL'::"TimeEntryStatus" END,
            sh.business_date, t.clock_in, t.clock_in + make_interval(mins => t.minutes), 'GEOFENCED', t.minutes,
            CASE WHEN sh.business_date < to_char((now() AT TIME ZONE 'Asia/Jerusalem')::date - 7, 'YYYY-MM-DD') THEN least(t.minutes, 540) END,
            CASE WHEN sh.business_date < to_char((now() AT TIME ZONE 'Asia/Jerusalem')::date - 7, 'YYYY-MM-DD') THEN greatest(0, t.minutes - 540) END,
            CASE WHEN sh.business_date < to_char((now() AT TIME ZONE 'Asia/Jerusalem')::date - 7, 'YYYY-MM-DD') THEN $2::uuid END,
            CASE WHEN sh.business_date < to_char((now() AT TIME ZONE 'Asia/Jerusalem')::date - 7, 'YYYY-MM-DD') THEN now() END,
            now()
     FROM shift_assignments a
     JOIN shifts sh ON sh.id = a.shift_id AND sh.status = 'CLOSED'
     CROSS JOIN LATERAL (SELECT sh.scheduled_start + make_interval(mins => (random() * 10)::int) AS clock_in, 480 + (random() * 90)::int AS minutes) t
     WHERE sh.organization_id = $1::uuid`,
    orgId,
    ownerUserId,
  );
  await sql(
    "clock events",
    `INSERT INTO clock_events (id, time_entry_id, event_type, origin, idempotency_key, device_id, client_event_id, device_timestamp, server_received_at,
                              device_time_deviation_seconds, latitude, longitude, accuracy_meters, location_validation_status, distance_from_site_meters)
     SELECT gen_random_uuid(), te.id, e.kind::"ClockEventType", 'ONLINE', gen_random_uuid()::text, 'load-device', gen_random_uuid()::text,
            CASE WHEN e.kind = 'CLOCK_IN' THEN te.clock_in_at ELSE te.clock_out_at END,
            CASE WHEN e.kind = 'CLOCK_IN' THEN te.clock_in_at ELSE te.clock_out_at END,
            0, s.latitude, s.longitude, 12, 'PASSED', 20
     FROM time_entries te JOIN shifts sh ON sh.id = te.shift_id JOIN sites s ON s.id = sh.site_id
     CROSS JOIN (VALUES ('CLOCK_IN'), ('CLOCK_OUT')) e(kind) WHERE te.organization_id = $1::uuid`,
    orgId,
  );
  await sql(
    "daily summaries",
    `INSERT INTO daily_summaries (id, time_entry_id, text, task_category, updated_at)
     SELECT gen_random_uuid(), id, 'عمل يومي', 'TRAFFIC_CONTROL', now() FROM time_entries WHERE organization_id = $1::uuid`,
    orgId,
  );
  await sql(
    "approvals",
    `INSERT INTO attendance_approvals (id, time_entry_id, action, acted_by)
     SELECT gen_random_uuid(), id, 'APPROVE', $2::uuid FROM time_entries WHERE organization_id = $1::uuid AND status = 'APPROVED'`,
    orgId,
    ownerUserId,
  );
  await sql(
    "notifications",
    `INSERT INTO notifications (id, organization_id, recipient_user_id, type, title, body, data_json)
     SELECT gen_random_uuid(), $1::uuid, $2::uuid, 'WORKER_CLOCKED_IN', 'Worker clocked in', 'A worker clocked in.', jsonb_build_object('timeEntryId', te.id, 'shiftId', te.shift_id)
     FROM time_entries te WHERE te.organization_id = $1::uuid ORDER BY te.business_date DESC LIMIT 300`,
    orgId,
    ownerUserId,
  );
  await prisma.$executeRawUnsafe("ANALYZE");

  const counts = await prisma.$queryRawUnsafe<{ table: string; rows: bigint }[]>(
    `SELECT 'workers' AS "table", count(*) AS rows FROM worker_profiles UNION ALL SELECT 'sites', count(*) FROM sites UNION ALL SELECT 'shifts', count(*) FROM shifts
     UNION ALL SELECT 'time entries', count(*) FROM time_entries UNION ALL SELECT 'clock events', count(*) FROM clock_events`,
  );
  console.log("Done:", counts.map((row) => `${row.table} ${row.rows}`).join(", "));
  console.log("Sign in as the Owner: +972500000001 (dev login). Start the API against this database with RATE_LIMIT_PER_MINUTE=1000000, then run `pnpm --filter @fieldmaster/api load:run`.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
