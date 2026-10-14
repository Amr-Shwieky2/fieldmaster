/**
 * Development seed data (spec section 36). Wipes and repopulates the
 * database with a realistic, fully-fictional FieldMaster deployment: one
 * organization, Owners/Field Managers/Workers, projects/sites/geofences,
 * a mix of shift types, attendance in every status, forgotten-stamp
 * infractions crossing the two-strike threshold, one emergency call-out,
 * a Temporary Supervisor assignment, one finalized payroll period, and
 * onboarding invitations in every state with one pending application.
 *
 * Run with: pnpm --filter @fieldmaster/api db:seed
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { v7 as uuidv7 } from "uuid";
import {
  AccountStatus,
  ApprovalAction,
  CheckInMethod,
  ClockEventType,
  CompensationType,
  CorrectionReason,
  EmergencyAuthorizationSource,
  EventOrigin,
  FileAssetPurpose,
  GovernmentIdType,
  LocationValidationStatus,
  NotificationType,
  OrgRole,
  PayrollAdjustmentSource,
  PayrollAdjustmentType,
  PayrollCalculationState,
  PayrollPeriodStatus,
  PRIVACY_NOTICE_VERSION,
  ShiftStatus,
  ShiftType,
  TaskCategory,
  TemporaryPointStatus,
  TimeEntryStatus,
  TuranStatus,
  TuranType,
} from "@fieldmaster/shared-types";
import {
  calculatePayrollMonth,
  calculateShiftCompensation,
  computeEmergencyCompensation,
  evaluateForgottenStampInfraction,
  toBusinessDate,
} from "@fieldmaster/shared-validation";

import type { PrismaService } from "../src/common/prisma/prisma.service";
import { FilesService } from "../src/common/files/files.service";
import { PayrollInputsService } from "../src/modules/payroll/payroll-inputs.service";
import { buildPayrollSnapshotResult, PAYROLL_SNAPSHOT_SCHEMA_VERSION } from "../src/modules/payroll/payroll-snapshot";

const prisma = new PrismaClient();
const id = () => uuidv7();

const AUDIT_GENESIS_HASH = "0".repeat(64);
const auditChainTip = new Map<string, string>();

async function recordAudit(organizationId: string, actorUserId: string, action: string, entityType: string, entityId: string, extra: Record<string, unknown> = {}) {
  const previousHash = auditChainTip.get(organizationId) ?? AUDIT_GENESIS_HASH;
  const correlationId = id();
  const canonicalPayload = JSON.stringify({
    organizationId,
    actorUserId,
    action,
    entityType,
    entityId,
    field: extra.field ?? null,
    oldValue: extra.oldValue ?? null,
    newValue: extra.newValue ?? null,
    reason: extra.reason ?? null,
    note: extra.note ?? null,
    correlationId,
  });
  const currentHash = createHash("sha256").update(previousHash + canonicalPayload).digest("hex");
  auditChainTip.set(organizationId, currentHash);

  await prisma.auditLog.create({
    data: {
      id: id(),
      organizationId,
      actorUserId,
      action,
      entityType,
      entityId,
      field: extra.field as string | undefined,
      oldValue: extra.oldValue as string | undefined,
      newValue: extra.newValue as string | undefined,
      reason: extra.reason as string | undefined,
      note: extra.note as string | undefined,
      correlationId,
      previousHash,
      currentHash,
    },
  });
}

const LOCAL_ENCRYPTION_KEY = Buffer.from("3flOAwkmbM8Wbu+jPivo+sMVLbSkA8+as2wLULpw16c=", "base64");
function encryptBankInfo(plaintext: string) {
  const { createCipheriv, randomBytes } = require("node:crypto");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", LOCAL_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), encryptionKeyId: "local:dev-key-v1" };
}

/** A plain drawing of an ID card (no real data, no metadata) as a PNG: the seeded applicant's identity document. */
function sampleIdCardPng(): Buffer {
  const width = 480;
  const height = 300;
  const stride = width * 3 + 1; // a filter byte (0) before each row of RGB pixels
  const pixels = Buffer.alloc(height * stride);
  const fill = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.set(rgb, y * stride + 1 + x * 3);
  };
  fill(0, 0, width, height, [219, 234, 254]);
  fill(0, 0, width, 52, [30, 58, 138]);
  fill(330, 82, 450, 232, [148, 163, 184]); // the photo, on the right of a right-to-left card
  for (let line = 0; line < 5; line++) fill(45 + line * 22, 92 + line * 30, 300, 102 + line * 30, [51, 65, 85]);

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, data: Buffer) => {
    const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
    let crc = 0xffffffff;
    for (const byte of typeAndData) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, typeAndData, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  console.log("Wiping existing data...");
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      idempotency_records, otp_challenges, generated_reports,
      payroll_calculation_snapshots, payroll_calculation_runs, payroll_adjustments, payroll_items, payroll_periods,
      forgotten_stamp_infractions, manual_time_corrections, attendance_approvals, daily_summaries,
      unpaid_breaks, rejected_clock_attempts, clock_events, emergency_callouts, time_entries,
      temporary_check_in_points, temporary_supervisor_assignments, shift_assignments, shifts,
      turan_assignments, geofences, sites, projects,
      notification_deliveries, notifications,
      onboarding_invitations, identity_documents, encrypted_bank_accounts, compensation_profiles, worker_profiles, file_assets,
      refresh_token_families, user_devices, organization_memberships, users,
      audit_logs, organization_settings, organizations
    RESTART IDENTITY CASCADE;
  `);

  console.log("Creating organization...");
  const org = await prisma.organization.create({ data: { id: id(), name: "شركة الميدان للمقاولات وأعمال الطرق" } });
  await prisma.organizationSettings.create({ data: { id: id(), organizationId: org.id } });

  // ── Users & memberships ──────────────────────────────────────────────
  async function createUser(phoneNumber: string, fullLegalName: string, preferredName?: string) {
    return prisma.user.create({
      data: { id: id(), phoneNumber, fullLegalName, preferredName, status: AccountStatus.ACTIVE },
    });
  }

  async function createMembership(userId: string, role: OrgRole, isTimeTrackable: boolean) {
    return prisma.organizationMembership.create({
      data: { id: id(), organizationId: org.id, userId, role, isTimeTrackable, status: AccountStatus.ACTIVE },
    });
  }

  console.log("Creating Owners and Field Managers...");
  const owner1User = await createUser("+972500000001", "سلمى منصور", "سلمى");
  const owner1Membership = await createMembership(owner1User.id, OrgRole.OWNER, false);
  const owner2User = await createUser("+972500000002", "إلياس رمضان", "إلياس");
  const owner2Membership = await createMembership(owner2User.id, OrgRole.OWNER, false);

  const fm1User = await createUser("+972500000011", "يوسف الخطيب", "يوسف");
  const fm1Membership = await createMembership(fm1User.id, OrgRole.FIELD_MANAGER, true);
  const fm1WorkerProfile = await prisma.workerProfile.create({ data: { id: id(), membershipId: fm1Membership.id, organizationId: org.id } });

  const fm2User = await createUser("+972500000012", "رنا عودة", "رنا");
  const fm2Membership = await createMembership(fm2User.id, OrgRole.FIELD_MANAGER, false);

  console.log("Creating 12 workers...");
  // Order matters: index-based logic below (workers[1], workers[7], workers[9], ...) relies on it.
  const workerNames = [
    "خالد ناصر", "محمود جبارين", "أنس دراوشة", "باسل عازر", "كريم حمدان",
    "وسيم عيسى", "فادي النجار", "مهند صالح", "زياد يونس", "نادر مصالحة",
    "رامي طه", "إياد سعدي",
  ];
  const workers: { user: any; membership: any; profile: any }[] = [];
  for (let i = 0; i < workerNames.length; i++) {
    const phone = `+97250001${String(i + 1).padStart(4, "0")}`;
    const user = await createUser(phone, workerNames[i]);
    const membership = await createMembership(user.id, OrgRole.WORKER, true);
    const profile = await prisma.workerProfile.create({
      data: {
        id: id(),
        membershipId: membership.id,
        organizationId: org.id,
        governmentIdType: "ISRAELI_ID",
        consentAcceptedAt: new Date("2026-01-01"),
        privacyNoticeVersion: "v1.0",
      },
    });
    const bank = encryptBankInfo(JSON.stringify({ bankName: "بنك هبوعليم", branchNumber: "123", accountNumber: `${1000000 + i}`, accountHolderName: workerNames[i] }));
    await prisma.encryptedBankAccount.create({
      data: { id: id(), workerProfileId: profile.id, ciphertext: bank.ciphertext, iv: bank.iv, authTag: bank.authTag, encryptionKeyId: bank.encryptionKeyId },
    });

    const compensationType = i % 3 === 0 ? CompensationType.HOURLY : CompensationType.DAILY;
    await prisma.compensationProfile.create({
      data: {
        id: id(),
        workerProfileId: profile.id,
        compensationType,
        dailyBaseRateAgorot: compensationType === CompensationType.DAILY ? 45000 : null,
        baseHourlyRateAgorot: compensationType === CompensationType.HOURLY ? 5500 : null,
        overtimeHourlyRateAgorot: 7000,
        effectiveStartDate: new Date("2026-01-01"),
        changeReason: "الأجر المعتمد عند الانضمام",
        createdBy: owner1User.id,
      },
    });

    workers.push({ user, membership, profile });
    await recordAudit(org.id, owner1User.id, "WORKER_APPROVED", "WorkerProfile", profile.id);
  }

  // ── Projects, sites, geofences ────────────────────────────────────────
  console.log("Creating projects, sites, geofences...");
  const projectDefs = [
    { name: "تنظيم حركة السير على شارع 6", client: "شركة الطرق الوطنية", code: "HWY6-2026" },
    { name: "تحديث الإشارات الضوئية في تل أبيب", client: "بلدية تل أبيب - يافا", code: "TLV-TL-2026" },
    { name: "لافتات مواقع البناء في هرتسليا", client: "بلدية هرتسليا", code: "HRZ-SGN-2026" },
  ];
  const projects = [];
  for (const p of projectDefs) {
    projects.push(
      await prisma.project.create({
        data: { id: id(), organizationId: org.id, name: p.name, client: p.client, projectCode: p.code, status: "ACTIVE", budgetAgorot: 500_000_00 },
      }),
    );
  }

  const siteCoords = [
    { lat: 32.0853, lng: 34.7818, name: "تقاطع تل أبيب المركزي" },
    { lat: 32.1093, lng: 34.8555, name: "جسر رمات غان العلوي" },
    { lat: 32.166, lng: 34.844, name: "موقع هرتسليا الشمالي" },
    { lat: 32.0679, lng: 34.7789, name: "مفترق يافا" },
    { lat: 32.0234, lng: 34.7503, name: "الطريق الساحلي في بات يام" },
    { lat: 32.1848, lng: 34.87, name: "موقع هرتسليا بيتوح" },
  ];
  const sites: { site: Awaited<ReturnType<typeof prisma.site.create>>; geofence: Awaited<ReturnType<typeof prisma.geofence.create>> }[] = [];
  for (let i = 0; i < siteCoords.length; i++) {
    const site = await prisma.site.create({
      data: {
        id: id(),
        organizationId: org.id,
        projectId: projects[Math.floor(i / 2)].id,
        name: siteCoords[i].name,
        latitude: siteCoords[i].lat,
        longitude: siteCoords[i].lng,
        defaultGeofenceRadiusMeters: 150,
        instructions: "يجب ارتداء السترة العاكسة ومراجعة مشرف الموقع فور الوصول.",
        emergencyContact: "+972500000099",
      },
    });
    const geofence = await prisma.geofence.create({
      data: {
        id: id(),
        organizationId: org.id,
        siteId: site.id,
        centerLatitude: siteCoords[i].lat,
        centerLongitude: siteCoords[i].lng,
        radiusMeters: 150,
        minAccuracyMeters: 50,
        version: 1,
        createdBy: owner1User.id,
      },
    });
    sites.push({ site, geofence });
  }

  // ── Shifts ────────────────────────────────────────────────────────────
  console.log("Creating shifts and assignments...");
  const today = new Date();
  function daysAgo(n: number) {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d;
  }

  // Arabic shift-type labels (same wording as the admin web) used to build readable shift titles.
  const shiftTypeLabel: Record<ShiftType, string> = {
    [ShiftType.STANDARD]: "وردية عادية",
    [ShiftType.DAY_TURAN]: "مناوبة نهارية",
    [ShiftType.NIGHT_TURAN]: "مناوبة ليلية",
    [ShiftType.EMERGENCY_CALLOUT]: "استدعاء طوارئ",
  };

  async function createShift(shiftType: ShiftType, siteIdx: number, start: Date, end: Date, managerId: string) {
    return prisma.shift.create({
      data: {
        id: id(),
        organizationId: org.id,
        projectId: sites[siteIdx].site.projectId,
        siteId: sites[siteIdx].site.id,
        geofenceId: sites[siteIdx].geofence.id,
        shiftType,
        title: `${shiftTypeLabel[shiftType]} — ${sites[siteIdx].site.name}`,
        scheduledStart: start,
        scheduledEnd: end,
        checkInMethod: CheckInMethod.GEOFENCED,
        businessDate: toBusinessDate(start),
        managerId,
        status: ShiftStatus.PUBLISHED,
        createdBy: managerId,
      },
    });
  }

  const standardShifts = [];
  for (let i = 0; i < 8; i++) {
    const start = daysAgo(10 - i);
    start.setHours(6, 0, 0, 0);
    const end = new Date(start);
    end.setHours(15, 0, 0, 0);
    const shift = await createShift(ShiftType.STANDARD, i % sites.length, start, end, fm1User.id);
    standardShifts.push(shift);
    const worker = workers[i % workers.length];
    await prisma.shiftAssignment.create({ data: { id: id(), shiftId: shift.id, workerProfileId: worker.profile.id, assignedBy: fm1User.id } });
  }

  const dayTuranStart = daysAgo(1);
  dayTuranStart.setHours(8, 0, 0, 0);
  const dayTuranEnd = daysAgo(1);
  dayTuranEnd.setHours(18, 0, 0, 0);
  const dayTuranShift = await createShift(ShiftType.DAY_TURAN, 0, dayTuranStart, dayTuranEnd, fm1User.id);
  await prisma.shiftAssignment.create({ data: { id: id(), shiftId: dayTuranShift.id, workerProfileId: workers[0].profile.id, assignedBy: fm1User.id } });

  const nightTuranStart = daysAgo(2);
  nightTuranStart.setHours(22, 0, 0, 0);
  const nightTuranEnd = daysAgo(1);
  nightTuranEnd.setHours(6, 0, 0, 0);
  const nightTuranShift = await createShift(ShiftType.NIGHT_TURAN, 1, nightTuranStart, nightTuranEnd, fm1User.id);
  await prisma.shiftAssignment.create({ data: { id: id(), shiftId: nightTuranShift.id, workerProfileId: workers[1].profile.id, assignedBy: fm1User.id } });

  await prisma.turanAssignment.create({
    data: {
      id: id(), organizationId: org.id, turanType: TuranType.DAY_TURAN, status: TuranStatus.COMPLETED,
      startAt: dayTuranShift.scheduledStart, endAt: dayTuranShift.scheduledEnd,
      assignedWorkerProfileId: workers[0].profile.id, createdBy: fm1User.id,
    },
  });
  const nightTuranAssignment = await prisma.turanAssignment.create({
    data: {
      id: id(), organizationId: org.id, turanType: TuranType.NIGHT_TURAN, status: TuranStatus.COMPLETED,
      startAt: nightTuranStart, endAt: nightTuranEnd,
      assignedWorkerProfileId: workers[1].profile.id, backupWorkerProfileId: workers[2].profile.id, createdBy: fm1User.id,
    },
  });

  // ── Temporary Supervisor + check-in point ───────────────────────────
  console.log("Creating temporary supervisor assignment...");
  await prisma.temporarySupervisorAssignment.create({
    data: {
      id: id(), shiftId: standardShifts[0].id, workerProfileId: workers[3].profile.id,
      activatedAt: standardShifts[0].scheduledStart, expiresAt: standardShifts[0].scheduledEnd, assignedBy: fm1User.id,
    },
  });
  await prisma.temporaryCheckInPoint.create({
    data: {
      id: id(), organizationId: org.id, shiftId: standardShifts[0].id, name: "نقطة تجمّع الطاقم المتنقّل",
      latitude: sites[0].site.latitude + 0.001, longitude: sites[0].site.longitude + 0.001, radiusMeters: 100,
      status: TemporaryPointStatus.EXPIRED, createdBy: workers[3].user.id, managerAuthorizedBy: fm1User.id,
      expiresAt: standardShifts[0].scheduledEnd,
    },
  });

  // ── Step 9: a working day TODAY for the mobile app ─────────────────
  // A shift at تقاطع تل أبيب المركزي (32.0853, 34.7818; 150 m geofence) that started an hour ago, so a
  // worker can clock in inside the geofence right after seeding; a temporary supervisor on it; and a
  // Night Turan covering now, so the emergency button shows. All relative to the time the seed runs.
  console.log("Creating today's shift, temporary supervisor and Night Turan for the mobile app...");
  const todayStart = new Date(Date.now() - 60 * 60_000);
  const todayEnd = new Date(Date.now() + 8 * 60 * 60_000);
  const todayShift = await createShift(ShiftType.STANDARD, 0, todayStart, todayEnd, fm1User.id);
  for (const worker of [workers[0], workers[3], workers[4]]) {
    await prisma.shiftAssignment.create({ data: { id: id(), shiftId: todayShift.id, workerProfileId: worker.profile.id, assignedBy: fm1User.id } });
  }
  await prisma.temporarySupervisorAssignment.create({
    data: {
      id: id(), shiftId: todayShift.id, workerProfileId: workers[3].profile.id,
      activatedAt: todayStart, expiresAt: todayEnd, assignedBy: fm1User.id, canOpenCheckInPoints: true,
    },
  });
  await prisma.turanAssignment.create({
    data: {
      id: id(), organizationId: org.id, turanType: TuranType.NIGHT_TURAN, status: TuranStatus.SCHEDULED,
      startAt: new Date(Date.now() - 2 * 60 * 60_000), endAt: new Date(Date.now() + 22 * 60 * 60_000),
      assignedWorkerProfileId: workers[1].profile.id, createdBy: fm1User.id,
    },
  });

  // ── Time entries: approved, pending, rejected ───────────────────────
  console.log("Creating attendance records...");
  async function approvedEntry(shift: any, worker: any, hoursWorked: number, fullDayCredit = false) {
    const clockIn = shift.scheduledStart;
    const clockOut = new Date(clockIn.getTime() + hoursWorked * 3_600_000);
    const raw = Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000);
    const entry = await prisma.timeEntry.create({
      data: {
        id: id(), organizationId: org.id, workerProfileId: worker.profile.id, shiftId: shift.id,
        status: TimeEntryStatus.APPROVED, businessDate: toBusinessDate(clockIn),
        clockInAt: clockIn, clockOutAt: clockOut, checkInMethod: CheckInMethod.GEOFENCED,
        rawDurationMinutes: raw, fullDayCredit,
        approvedRegularMinutes: Math.min(raw, 540), approvedOvertimeMinutes: Math.max(0, raw - 540),
        approvedBy: fm1User.id, approvedAt: clockOut,
      },
    });
    for (const [eventType, at] of [[ClockEventType.CLOCK_IN, clockIn], [ClockEventType.CLOCK_OUT, clockOut]] as const) {
      await prisma.clockEvent.create({
        data: {
          id: id(), timeEntryId: entry.id, eventType, origin: EventOrigin.ONLINE, idempotencyKey: id(),
          deviceId: `seed-device-${worker.profile.id}`, clientEventId: id(), deviceTimestamp: at, serverReceivedAt: at,
          deviceTimeDeviationSeconds: 1, latitude: shift.geofenceId ? sites[0].site.latitude : 32.08, longitude: 34.78,
          accuracyMeters: 15, locationValidationStatus: LocationValidationStatus.PASSED,
        },
      });
    }
    await prisma.dailySummary.create({
      data: { id: id(), timeEntryId: entry.id, text: "تم الانتهاء من تركيب معدّات تنظيم السير المقرّرة وفحصها.", taskCategory: TaskCategory.TRAFFIC_CONTROL },
    });
    await prisma.attendanceApproval.create({ data: { id: id(), timeEntryId: entry.id, action: ApprovalAction.APPROVE, actedBy: fm1User.id, notes: "تمت المراجعة ولا توجد ملاحظات." } });
    return entry;
  }

  for (let i = 0; i < 6; i++) {
    await approvedEntry(standardShifts[i], workers[i % workers.length], 9);
  }
  // A short day with manual full-day credit
  const shortDayEntry = await approvedEntry(standardShifts[6], workers[6], 6, true);
  await recordAudit(org.id, fm1User.id, "FULL_DAY_CREDIT_APPLIED", "TimeEntry", shortDayEntry.id, { field: "fullDayCredit", oldValue: "false", newValue: "true", reason: "توقّف العمل بسبب الطقس" });

  // Pending approval entry
  const pendingShift = standardShifts[7];
  const pendingClockIn = pendingShift.scheduledStart;
  const pendingClockOut = new Date(pendingClockIn.getTime() + 10.5 * 3_600_000);
  const pendingEntry = await prisma.timeEntry.create({
    data: {
      id: id(), organizationId: org.id, workerProfileId: workers[7].profile.id, shiftId: pendingShift.id,
      status: TimeEntryStatus.PENDING_APPROVAL, businessDate: toBusinessDate(pendingClockIn),
      clockInAt: pendingClockIn, clockOutAt: pendingClockOut, checkInMethod: CheckInMethod.GEOFENCED,
      rawDurationMinutes: Math.round((pendingClockOut.getTime() - pendingClockIn.getTime()) / 60_000),
    },
  });
  await prisma.dailySummary.create({ data: { id: id(), timeEntryId: pendingEntry.id, text: "عمل إضافي لاستبدال لافتات مرورية تالفة.", taskCategory: TaskCategory.TRAFFIC_SIGN } });

  // Clock-ins the server refused (evidence since Step 5; the site violations report since Step 8), with the values
  // the API records: the pending entry's worker tried from ~400 m outside the geofence, then with a weak GPS fix,
  // before clocking in; another worker's phone clock was 9 minutes behind the server.
  const pendingSite = sites[7 % sites.length];
  const deviationShift = standardShifts[2];
  await prisma.rejectedClockAttempt.createMany({
    data: [
      {
        id: id(), organizationId: org.id, workerProfileId: workers[7].profile.id, shiftId: pendingShift.id, timeEntryId: pendingEntry.id,
        eventType: ClockEventType.CLOCK_IN, origin: EventOrigin.ONLINE, code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
        deviceTimestamp: new Date(pendingClockIn.getTime() - 6 * 60_000), serverReceivedAt: new Date(pendingClockIn.getTime() - 6 * 60_000), deviationSeconds: 2,
        latitude: pendingSite.site.latitude + 0.0036, longitude: pendingSite.site.longitude, accuracyMeters: 12,
        distanceMeters: 401, allowedRadiusMeters: pendingSite.geofence.radiusMeters, requiredAccuracyMeters: pendingSite.geofence.minAccuracyMeters,
      },
      {
        id: id(), organizationId: org.id, workerProfileId: workers[7].profile.id, shiftId: pendingShift.id, timeEntryId: pendingEntry.id,
        eventType: ClockEventType.CLOCK_IN, origin: EventOrigin.ONLINE, code: "GPS_ACCURACY_TOO_LOW",
        deviceTimestamp: new Date(pendingClockIn.getTime() - 3 * 60_000), serverReceivedAt: new Date(pendingClockIn.getTime() - 3 * 60_000), deviationSeconds: 1,
        latitude: pendingSite.site.latitude + 0.0004, longitude: pendingSite.site.longitude, accuracyMeters: 120,
        distanceMeters: 45, allowedRadiusMeters: pendingSite.geofence.radiusMeters, requiredAccuracyMeters: pendingSite.geofence.minAccuracyMeters,
      },
      {
        id: id(), organizationId: org.id, workerProfileId: workers[2 % workers.length].profile.id, shiftId: deviationShift.id,
        eventType: ClockEventType.CLOCK_IN, origin: EventOrigin.ONLINE, code: "DEVICE_TIME_DEVIATION_EXCEEDED",
        deviceTimestamp: new Date(deviationShift.scheduledStart.getTime() - 13 * 60_000), serverReceivedAt: new Date(deviationShift.scheduledStart.getTime() - 4 * 60_000),
        deviationSeconds: 540, latitude: sites[2 % sites.length].site.latitude, longitude: sites[2 % sites.length].site.longitude, accuracyMeters: 10,
      },
    ],
  });

  // Rejected entry
  const rejectedShift = standardShifts[0];
  const rejectedClockIn = daysAgo(5);
  const rejectedClockOut = new Date(rejectedClockIn.getTime() + 30 * 60_000);
  const rejectedEntry = await prisma.timeEntry.create({
    data: {
      id: id(), organizationId: org.id, workerProfileId: workers[8].profile.id, shiftId: rejectedShift.id,
      status: TimeEntryStatus.REJECTED, businessDate: toBusinessDate(rejectedClockIn),
      clockInAt: rejectedClockIn, clockOutAt: rejectedClockOut, rawDurationMinutes: 30, checkInMethod: CheckInMethod.GEOFENCED,
      rejectedReason: "المدة أقصر من أن تكون منطقية؛ وأكّد العامل أنه سجّل بدء الدوام مرتين عن طريق الخطأ.",
    },
  });
  await prisma.attendanceApproval.create({ data: { id: id(), timeEntryId: rejectedEntry.id, action: ApprovalAction.REJECT, actedBy: fm1User.id, notes: "مرفوض: المدة غير منطقية." } });

  // ── Forgotten-stamp infractions for worker[9] (2 free + 1 deduction) ──
  console.log("Creating forgotten-stamp infractions...");
  const forgottenWorker = workers[9];
  for (let i = 0; i < 3; i++) {
    const entryDate = daysAgo(20 - i * 5);
    const entry = await prisma.timeEntry.create({
      data: {
        id: id(), organizationId: org.id, workerProfileId: forgottenWorker.profile.id, shiftId: standardShifts[0].id,
        status: TimeEntryStatus.APPROVED, businessDate: toBusinessDate(entryDate),
        clockInAt: entryDate, clockOutAt: new Date(entryDate.getTime() + 9 * 3_600_000),
        rawDurationMinutes: 540, approvedRegularMinutes: 540, approvedOvertimeMinutes: 0,
        checkInMethod: CheckInMethod.GEOFENCED, approvedBy: fm1User.id, approvedAt: entryDate,
      },
    });
    const correction = await prisma.manualTimeCorrection.create({
      data: {
        id: id(), timeEntryId: entry.id, field: "clockInAt", oldValue: null, newValue: entryDate.toISOString(),
        reason: CorrectionReason.FORGOTTEN_CLOCK_IN, editedBy: fm1User.id, correlationId: id(),
      },
    });
    const evaluation = evaluateForgottenStampInfraction(i + 1);
    const infraction = await prisma.forgottenStampInfraction.create({
      data: {
        id: id(), organizationId: org.id, workerProfileId: forgottenWorker.profile.id, timeEntryId: entry.id, correctionId: correction.id,
        businessMonth: toBusinessDate(entryDate).slice(0, 7), monthlySequenceNumber: i + 1, deductionAgorot: evaluation.deductionAgorot,
      },
    });
    if (evaluation.deductionAgorot > 0) {
      await prisma.payrollAdjustment.create({
        data: {
          id: id(), organizationId: org.id, workerProfileId: forgottenWorker.profile.id, businessMonth: toBusinessDate(entryDate).slice(0, 7),
          type: PayrollAdjustmentType.FORGOTTEN_STAMP_PENALTY, source: PayrollAdjustmentSource.SYSTEM,
          amountAgorot: -evaluation.deductionAgorot, relatedInfractionId: infraction.id, createdBy: fm1User.id,
        },
      });
    }
    await recordAudit(org.id, fm1User.id, "FORGOTTEN_STAMP_INFRACTION_RECORDED", "ForgottenStampInfraction", infraction.id);
  }

  // ── Emergency call-out ────────────────────────────────────────────────
  console.log("Creating emergency call-out...");
  const emergencyActualStart = new Date(nightTuranStart.getTime() + 2 * 3_600_000);
  const emergencyActualEnd = new Date(emergencyActualStart.getTime() + 3 * 3_600_000);
  const emergencyComp = computeEmergencyCompensation(emergencyActualStart, emergencyActualEnd);

  const emergencyShift = await prisma.shift.create({
    data: {
      id: id(), organizationId: org.id, shiftType: ShiftType.EMERGENCY_CALLOUT, title: shiftTypeLabel[ShiftType.EMERGENCY_CALLOUT],
      scheduledStart: emergencyComp.compensatedStart, scheduledEnd: new Date(emergencyActualEnd.getTime() + 8 * 3_600_000),
      checkInMethod: CheckInMethod.FLEXI_CHECK, businessDate: toBusinessDate(emergencyComp.compensatedStart),
      managerId: fm1User.id, status: ShiftStatus.CLOSED, createdBy: fm1User.id,
    },
  });
  await prisma.shiftAssignment.create({ data: { id: id(), shiftId: emergencyShift.id, workerProfileId: workers[1].profile.id, assignedBy: fm1User.id } });

  const emergencyEntry = await prisma.timeEntry.create({
    data: {
      id: id(), organizationId: org.id, workerProfileId: workers[1].profile.id, shiftId: emergencyShift.id,
      status: TimeEntryStatus.APPROVED, businessDate: toBusinessDate(emergencyComp.compensatedStart),
      clockInAt: emergencyComp.compensatedStart, clockOutAt: emergencyComp.compensatedEnd,
      rawDurationMinutes: emergencyComp.compensatedDurationMinutes,
      approvedRegularMinutes: Math.min(emergencyComp.compensatedDurationMinutes, 540),
      approvedOvertimeMinutes: Math.max(0, emergencyComp.compensatedDurationMinutes - 540),
      checkInMethod: CheckInMethod.FLEXI_CHECK, isEmergency: true, approvedBy: fm1User.id, approvedAt: emergencyComp.compensatedEnd,
    },
  });
  await prisma.dailySummary.create({
    data: { id: id(), timeEntryId: emergencyEntry.id, text: "إصلاح وحدة التحكم بالإشارة الضوئية بعد ارتفاع مفاجئ في التيار الكهربائي.", taskCategory: TaskCategory.EMERGENCY_REPAIR },
  });
  await prisma.emergencyCallout.create({
    data: {
      id: id(), organizationId: org.id, turanAssignmentId: nightTuranAssignment.id, workerProfileId: workers[1].profile.id,
      timeEntryId: emergencyEntry.id, authorizationSource: EmergencyAuthorizationSource.NIGHT_TURAN_ASSIGNMENT,
      actualStartClick: emergencyComp.actualStartClick, compensatedStart: emergencyComp.compensatedStart,
      actualEndClick: emergencyComp.actualEndClick, compensatedEnd: emergencyComp.compensatedEnd,
      actualWorkedMinutes: emergencyComp.actualWorkedMinutes, retroactiveMinutes: emergencyComp.retroactiveMinutes,
      returnBufferMinutes: emergencyComp.returnBufferMinutes, compensatedDurationMinutes: emergencyComp.compensatedDurationMinutes,
      startLatitude: sites[1].site.latitude, startLongitude: sites[1].site.longitude,
      endLatitude: sites[1].site.latitude, endLongitude: sites[1].site.longitude,
    },
  });

  // ── Payroll: last month calculated and finalized (version 1) ─────────
  // Through the API's own input loader, payroll engine and snapshot format
  // (Step 7), so the finalized version is exactly what an Owner's
  // calculation would have stored: inputs, per-worker and per-entry results,
  // totals, items, a finished calculation run.
  console.log("Calculating and finalizing a payroll period...");
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15);
  const yearMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;

  // Representative approved entries for that historical month (9 h 30 m, 9 h, and 6 h at another site).
  const historicalDays: [number, number, number, number][] = [
    [10, 2, 0, 9.5],
    [2, 2, 1, 9],
    [5, 1, 2, 6],
  ];
  for (const [workerIndex, siteIndex, dayOffset, hours] of historicalDays) {
    const start = new Date(lastMonth.getTime() + dayOffset * 24 * 3_600_000);
    const shift = await createShift(ShiftType.STANDARD, siteIndex, start, new Date(start.getTime() + hours * 3_600_000), fm1User.id);
    await prisma.shiftAssignment.create({ data: { id: id(), shiftId: shift.id, workerProfileId: workers[workerIndex].profile.id, assignedBy: fm1User.id } });
    await approvedEntry(shift, workers[workerIndex], hours);
  }

  const { inputs: payrollInputs, inputsHash } = await new PayrollInputsService(prisma as unknown as PrismaService).load(org.id, yearMonth);
  const payrollMonth = calculatePayrollMonth({ entries: payrollInputs.entries, profiles: payrollInputs.compensationProfiles, adjustments: payrollInputs.adjustments });
  const { result: payrollResult, totals: payrollTotals } = buildPayrollSnapshotResult(payrollInputs, payrollMonth.workers, payrollMonth.entries);
  const calculatedAt = new Date();
  const payrollPeriod = await prisma.payrollPeriod.create({
    data: { id: id(), organizationId: org.id, yearMonth, version: 1, status: PayrollPeriodStatus.OPEN, createdBy: owner1User.id },
  });
  const calculationRun = await prisma.payrollCalculationRun.create({
    data: {
      id: id(), organizationId: org.id, payrollPeriodId: payrollPeriod.id, state: PayrollCalculationState.SUCCEEDED, progress: 100,
      processedWorkers: payrollTotals.workers, totalWorkers: payrollTotals.workers, idempotencyKey: `seed-${yearMonth}`,
      requestedBy: owner1User.id, requestedAt: calculatedAt, startedAt: calculatedAt, finishedAt: calculatedAt,
    },
  });
  const snapshot = await prisma.payrollCalculationSnapshot.create({
    data: {
      id: id(), payrollPeriodId: payrollPeriod.id, version: 1, schemaVersion: PAYROLL_SNAPSHOT_SCHEMA_VERSION,
      inputsJson: payrollInputs as unknown as Prisma.InputJsonValue, resultJson: payrollResult as unknown as Prisma.InputJsonValue,
      totalsJson: payrollTotals as unknown as Prisma.InputJsonValue, inputsHash, calculatedBy: owner1User.id, calculatedAt, calculationRunId: calculationRun.id,
    },
  });
  for (const worker of payrollResult.workers) {
    await prisma.payrollItem.create({
      data: {
        id: id(), payrollPeriodId: payrollPeriod.id, workerProfileId: worker.workerProfileId,
        approvedShifts: worker.approvedShifts, standardDaysCredited: worker.standardDaysCredited,
        regularMinutes: worker.regularMinutes, overtimeMinutes: worker.overtimeMinutes,
        emergencyRetroactiveMinutes: worker.emergencyRetroactiveMinutes, emergencyReturnMinutes: worker.emergencyReturnMinutes,
        grossBaseAgorot: worker.grossBaseAgorot, overtimeAgorot: worker.overtimeAgorot,
        positiveAdjustmentsAgorot: worker.positiveAdjustmentsAgorot, forgottenStampPenaltiesAgorot: worker.forgottenStampPenaltiesAgorot,
        reversalsAgorot: worker.reversalsAgorot, otherDeductionsAgorot: worker.otherDeductionsAgorot,
        deductionsAgorot: worker.deductionsAgorot, netPayableAgorot: worker.netPayableAgorot,
      },
    });
  }

  await prisma.payrollPeriod.update({ where: { id: payrollPeriod.id }, data: { status: PayrollPeriodStatus.REVIEW, currentSnapshotId: snapshot.id } });
  await recordAudit(org.id, owner1User.id, "PAYROLL_CALCULATED", "PayrollPeriod", payrollPeriod.id);
  await prisma.payrollPeriod.update({ where: { id: payrollPeriod.id }, data: { status: PayrollPeriodStatus.FINALIZED, finalizedAt: new Date(), finalizedBy: owner1User.id } });
  await recordAudit(org.id, owner1User.id, "PAYROLL_FINALIZED", "PayrollPeriod", payrollPeriod.id);

  // ── Onboarding invitations (Step 8): one in every state ────────────────
  // Only the SHA-256 of a token is stored, so these links cannot be opened:
  // an Owner creates a fresh invitation in the admin web to get a working one.
  console.log("Creating onboarding invitations...");
  const seedTokenHash = () => createHash("sha256").update(randomBytes(32).toString("hex")).digest("hex");
  const hourMs = 3_600_000;
  await prisma.onboardingInvitation.createMany({
    data: [
      { id: id(), organizationId: org.id, tokenHash: seedTokenHash(), prefilledPhoneNumber: "+972500010020", expiresAt: new Date(Date.now() + 70 * hourMs), createdBy: owner1User.id },
      {
        id: id(), organizationId: org.id, tokenHash: seedTokenHash(), expiresAt: new Date(Date.now() + 40 * hourMs), createdBy: owner1User.id,
        usedAt: new Date(Date.now() - 20 * hourMs), redeemedWorkerProfileId: workers[11].profile.id,
      },
      { id: id(), organizationId: org.id, tokenHash: seedTokenHash(), expiresAt: new Date(Date.now() - 5 * hourMs), createdBy: fm1User.id },
      {
        id: id(), organizationId: org.id, tokenHash: seedTokenHash(), prefilledPhoneNumber: "+972500010021", expiresAt: new Date(Date.now() + 60 * hourMs), createdBy: owner1User.id,
        revokedAt: new Date(Date.now() - 2 * hourMs), revokedBy: owner1User.id,
      },
    ],
  });

  // A pending application, as the public join page leaves it: the Owner's review page
  // (/workers/<id>/review) shows the decrypted Palestinian ID number, bank details and ID image.
  console.log("Creating a pending onboarding application...");
  const applicantName = "ليث منصور";
  const applicantUser = await prisma.user.create({
    data: { id: id(), phoneNumber: "+972599123456", fullLegalName: applicantName, preferredName: "ليث", preferredLanguage: "ar", status: AccountStatus.PENDING_APPROVAL },
  });
  const applicantMembership = await prisma.organizationMembership.create({
    data: { id: id(), organizationId: org.id, userId: applicantUser.id, role: OrgRole.WORKER, isTimeTrackable: true, status: AccountStatus.PENDING_APPROVAL },
  });
  const appliedAt = new Date(Date.now() - 3 * hourMs);
  const applicantProfile = await prisma.workerProfile.create({
    data: {
      id: id(),
      membershipId: applicantMembership.id,
      organizationId: org.id,
      governmentIdType: GovernmentIdType.PALESTINIAN_ID,
      consentAcceptedAt: appliedAt,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    },
  });
  const applicantInvitationId = id();
  await prisma.onboardingInvitation.create({
    data: {
      id: applicantInvitationId, organizationId: org.id, tokenHash: seedTokenHash(), prefilledPhoneNumber: applicantUser.phoneNumber,
      expiresAt: new Date(Date.now() + 60 * hourMs), createdBy: owner1User.id, usedAt: appliedAt, redeemedWorkerProfileId: applicantProfile.id,
    },
  });
  // The ID image goes to the local MinIO (docker compose); without it the application is still seeded, without an image.
  let identityFileAssetId: string | null = null;
  try {
    const files = new FilesService();
    await files.onModuleInit();
    const image = sampleIdCardPng();
    const fileAssetId = id();
    const storageKey = `onboarding/${org.id}/${applicantInvitationId}/${fileAssetId}`;
    await files.putObject(storageKey, image, "image/png");
    await prisma.fileAsset.create({
      data: {
        id: fileAssetId, organizationId: org.id, purpose: FileAssetPurpose.IDENTITY_DOCUMENT, storageKey, contentType: "image/png",
        sizeBytes: image.length, sha256: createHash("sha256").update(image).digest("hex"), scanResult: "NOT_SCANNED",
        invitationId: applicantInvitationId, workerProfileId: applicantProfile.id,
      },
    });
    identityFileAssetId = fileAssetId;
  } catch (error) {
    console.warn(`Object storage unreachable (${(error as Error).message}): the pending application is seeded without its ID image.`);
  }
  // Encrypted with the same local key and format as EncryptionService (and the bank details above).
  const applicantIdNumber = encryptBankInfo("412345678");
  await prisma.identityDocument.create({
    data: {
      id: id(), workerProfileId: applicantProfile.id, documentType: GovernmentIdType.PALESTINIAN_ID, fileAssetId: identityFileAssetId,
      ciphertext: applicantIdNumber.ciphertext, iv: applicantIdNumber.iv, authTag: applicantIdNumber.authTag, encryptionKeyId: applicantIdNumber.encryptionKeyId,
    },
  });
  const applicantBank = encryptBankInfo(JSON.stringify({ bankName: "بنك فلسطين", branchNumber: "455", accountNumber: "300123456", accountHolderName: applicantName }));
  await prisma.encryptedBankAccount.create({
    data: { id: id(), workerProfileId: applicantProfile.id, ciphertext: applicantBank.ciphertext, iv: applicantBank.iv, authTag: applicantBank.authTag, encryptionKeyId: applicantBank.encryptionKeyId },
  });
  await recordAudit(org.id, applicantUser.id, "ONBOARDING_SUBMITTED", "WorkerProfile", applicantProfile.id);

  // ── Notifications ─────────────────────────────────────────────────────
  // Same shape as the API writes them: English title/body (still read as-is
  // by the mobile app) plus data_json with the raw values the admin web
  // renders in Arabic. Money (estimatedCostAgorot) is only ever in
  // an Owner's data -- never a Field Manager's.
  console.log("Creating notifications...");
  const formatHm = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  async function estimatedCostAgorot(workerProfileId: string, minutes: number) {
    const profile = await prisma.compensationProfile.findFirstOrThrow({ where: { workerProfileId } });
    return calculateShiftCompensation({
      compensationType: profile.compensationType,
      approvedMinutes: minutes,
      fullDayCredit: false,
      dailyBaseRateAgorot: profile.dailyBaseRateAgorot ?? undefined,
      baseHourlyRateAgorot: profile.baseHourlyRateAgorot ?? undefined,
      overtimeHourlyRateAgorot: profile.overtimeHourlyRateAgorot,
    }).totalCompensationAgorot;
  }
  async function seedNotification(
    recipientUserId: string,
    type: NotificationType,
    title: string,
    body: string,
    data: Record<string, string | number | boolean | null>,
    options: { createdAt?: Date; readAt?: Date } = {},
  ) {
    await prisma.notification.create({
      data: { id: id(), organizationId: org.id, recipientUserId, type, title, body, dataJson: data, ...options },
    });
  }

  // The pending application: Owners are told (names only, never an ID number or bank detail).
  for (const owner of [owner1User, owner2User]) {
    await seedNotification(
      owner.id,
      "ONBOARDING_SUBMITTED",
      "New worker application",
      `${applicantName} submitted an onboarding application awaiting your review.`,
      { workerProfileId: applicantProfile.id, workerName: applicantName },
      { createdAt: appliedAt },
    );
  }

  // Emergency call-out ended: Owners see the estimated cost, Field Managers do not.
  const emergencyWorker = workers[1];
  const emergencyMinutes = emergencyComp.compensatedDurationMinutes;
  const emergencyData = {
    timeEntryId: emergencyEntry.id,
    workerProfileId: emergencyWorker.profile.id,
    workerName: emergencyWorker.user.fullLegalName,
    endedAt: emergencyComp.actualEndClick.toISOString(),
    compensatedDurationMinutes: emergencyMinutes,
  };
  const emergencyCost = await estimatedCostAgorot(emergencyWorker.profile.id, emergencyMinutes);
  const emergencyManagerBody = `Emergency call-out ended. Compensated duration: ${formatHm(emergencyMinutes)}. Approval is required.`;
  const emergencyOwnerBody = `Emergency call-out ended. Compensated duration: ${formatHm(emergencyMinutes)}. Estimated cost: ₪${(emergencyCost / 100).toFixed(2)}`;
  const emergencyRead = { createdAt: emergencyComp.actualEndClick, readAt: emergencyComp.compensatedEnd };
  for (const owner of [owner1User, owner2User]) {
    await seedNotification(owner.id, "EMERGENCY_SHIFT_ENDED", "Emergency call-out ended", emergencyOwnerBody, { ...emergencyData, estimatedCostAgorot: emergencyCost }, emergencyRead);
  }
  for (const manager of [fm1User, fm2User]) {
    await seedNotification(manager.id, "EMERGENCY_SHIFT_ENDED", "Emergency call-out ended", emergencyManagerBody, emergencyData, emergencyRead);
  }

  // The pending-approval entry's clock-out: the shift's manager gets no cost, Owners do.
  const pendingWorker = workers[7];
  const pendingMinutes = pendingEntry.rawDurationMinutes ?? 0;
  const pendingSplit = `Total: ${formatHm(pendingMinutes)}\nRegular: ${formatHm(Math.min(pendingMinutes, 540))}\nOvertime: ${formatHm(Math.max(0, pendingMinutes - 540))}`;
  const clockOutData = {
    timeEntryId: pendingEntry.id,
    shiftId: pendingShift.id,
    shiftTitle: pendingShift.title,
    workerProfileId: pendingWorker.profile.id,
    workerName: pendingWorker.user.fullLegalName,
    clockOutAt: pendingClockOut.toISOString(),
    durationMinutes: pendingMinutes,
    regularMinutes: Math.min(pendingMinutes, 540),
    overtimeMinutes: Math.max(0, pendingMinutes - 540),
  };
  const clockOutCost = await estimatedCostAgorot(pendingWorker.profile.id, pendingMinutes);
  await seedNotification(fm1User.id, "WORKER_CLOCKED_OUT", "Worker clocked out", `Worker clocked out of "${pendingShift.title}".\n${pendingSplit}\nApproval is required.`, clockOutData, {
    createdAt: pendingClockOut,
  });
  for (const owner of [owner1User, owner2User]) {
    await seedNotification(
      owner.id,
      "WORKER_CLOCKED_OUT",
      "Worker clocked out",
      `Worker clocked out of "${pendingShift.title}".\n${pendingSplit}\nEstimated cost: ₪${(clockOutCost / 100).toFixed(2)}`,
      { ...clockOutData, estimatedCostAgorot: clockOutCost },
      { createdAt: pendingClockOut },
    );
  }

  await seedNotification(owner1User.id, "PAYROLL_FINALIZED", "Payroll finalized", `Payroll for ${yearMonth} has been finalized.`, { yearMonth });
  await seedNotification(fm1User.id, "SHIFT_AWAITING_APPROVAL", "Attendance awaiting approval", "A worker clocked out and needs approval.", {
    timeEntryId: pendingEntry.id,
    shiftId: pendingShift.id,
    shiftTitle: pendingShift.title,
    workerProfileId: pendingWorker.profile.id,
    workerName: pendingWorker.user.fullLegalName,
    clockOutAt: pendingClockOut.toISOString(),
    durationMinutes: pendingMinutes,
  });

  console.log("\nSeed complete.\n");
  console.log("Development login phone numbers (full list: docs/seed-accounts.md).");
  console.log("With DEV_LOGIN_ENABLED=true every number accepts code 123456 and the login screens offer one-click quick login;");
  console.log("otherwise the OTP is printed to the API console.");
  console.log(`  Owner 1:         ${owner1User.phoneNumber} (${owner1User.fullLegalName})`);
  console.log(`  Owner 2:         ${owner2User.phoneNumber} (${owner2User.fullLegalName})`);
  console.log(`  Field Manager 1: ${fm1User.phoneNumber} (${fm1User.fullLegalName})`);
  console.log(`  Field Manager 2: ${fm2User.phoneNumber} (${fm2User.fullLegalName})`);
  console.log(`  Worker (example): ${workers[0].user.phoneNumber} (${workers[0].user.fullLegalName})`);
  console.log(`  Worker with forgotten-stamp deduction: ${forgottenWorker.user.phoneNumber} (${forgottenWorker.user.fullLegalName})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
