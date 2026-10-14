import { createHash } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import {
  CheckInMethod,
  ClockEventType,
  CorrectionReason,
  EmergencyAuthorizationSource,
  EventOrigin,
  LocationValidationStatus,
  ReportType,
  ShiftStatus,
  ShiftType,
  TemporaryPointStatus,
  TimeEntryStatus,
  TuranStatus,
  TuranType,
} from "@fieldmaster/shared-types";
import { computeEmergencyCompensation, toBusinessDate, toBusinessYearMonth } from "@fieldmaster/shared-validation";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";
import { calculatePayroll } from "./payroll-helpers";
import { AMOUNT, ARABIC_INDIC_DIGIT, extractPdfText, pdfHasArabic, waitForReport } from "./reports-helpers";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { FilesService } from "../src/common/files/files.service";
import { ReportDataService } from "../src/modules/reports/report-data.service";

/**
 * Step 8: the seven report types as background jobs (Arabic PDF + CSV), who
 * may generate and see them, their files, downloads and verification.
 *
 * One organization is seeded through the real endpoints wherever they exist
 * (refused clock attempts, clock-in/out, corrections that record forgotten
 * stamps, approvals, a reversal, the payroll calculation and finalization);
 * earlier days, an emergency call-out, a Flexi-Check entry and a temporary
 * check-in point are stored the way those flows leave them. Known amounts:
 * the worker's entry today lasts 10 h 30 m at ₪450/day + ₪70/h overtime ->
 * 450.00 + 105.00 = 555.00; the Night Turan call-out (02:00-03:00) is paid
 * 135 minutes at ₪50/h -> 112.50; the third and fourth forgotten stamps of
 * the month deduct 10.00 each (the fourth is reversed).
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";
const OTHER_WORKER_PHONE = "+972500010002";

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center: inside the 100 m geofence.
const NEARBY_LAT = 32.0858;
// ~1.1 km north: outside it.
const FAR_LAT = 32.095;

const DAILY = { type: "DAILY" as const, dailyRateAgorot: 45_000, overtimeRateAgorot: 7_000 };
const HOURLY = { type: "HOURLY" as const, hourlyRateAgorot: 5_000, overtimeRateAgorot: 7_000 };

const minutes = (n: number) => n * 60_000;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

jest.setTimeout(240_000);

describe("Reports: Arabic PDF + CSV as background jobs (e2e, Step 8)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let files: FilesService;
  let ctx: Awaited<ReturnType<typeof seed>>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    files = app.get(FilesService);
    await resetDatabase(app);
    ctx = await seed();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const http = () => app.getHttpServer();
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  const post = (token: string, path: string, body: Record<string, unknown> = {}, idempotencyKey: string = uuidv7()) =>
    request(http()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", idempotencyKey).send(body);

  /** A day `daysAgo` before today at 05:00 UTC (07:00 or 08:00 in Jerusalem, the same business date). */
  function morningOf(daysAgo: number): Date {
    const day = new Date(Date.now() - daysAgo * 86_400_000);
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 5, 0, 0));
  }

  async function seed() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "دانا المالكة");
    const organizationId = owner.org.id;
    await prisma.organization.update({ where: { id: organizationId }, data: { name: "شركة الطرق الوطنية" } });
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "يوسف المدير");
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "خالد ناصر", DAILY);
    const otherWorker = await addWorker(prisma, organizationId, OTHER_WORKER_PHONE, "باسل عازر", HOURLY);
    const project = await prisma.project.update({ where: { id: (await createProject(prisma, organizationId)).id }, data: { name: "مشروع الشارع الرئيسي" } });
    const place = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const site = await prisma.site.update({ where: { id: place.site.id }, data: { name: "تقاطع الجامعة" } });
    const tokens = {
      owner: (await loginAs(app, OWNER_PHONE)).accessToken,
      manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
      worker: (await loginAs(app, WORKER_PHONE)).accessToken,
      otherWorker: (await loginAs(app, OTHER_WORKER_PHONE)).accessToken,
    };

    const shiftFor = async (
      workerProfileId: string,
      start: Date,
      durationMinutes: number,
      title: string,
      checkInMethod: CheckInMethod = CheckInMethod.GEOFENCED,
    ) => {
      const shift = await createStandardShift(
        prisma,
        organizationId,
        project.id,
        site.id,
        place.geofence.id,
        manager.user.id,
        start,
        new Date(start.getTime() + minutes(durationMinutes)),
        checkInMethod,
      );
      await assignWorkerToShift(prisma, shift.id, workerProfileId, manager.user.id);
      return prisma.shift.update({ where: { id: shift.id }, data: { title } });
    };
    const clockEvent = (timeEntryId: string, eventType: ClockEventType, at: Date, extra: Record<string, unknown> = {}) =>
      prisma.clockEvent.create({
        data: {
          id: uuidv7(),
          timeEntryId,
          eventType,
          origin: EventOrigin.ONLINE,
          idempotencyKey: uuidv7(),
          deviceId: "reports-seed-device",
          clientEventId: uuidv7(),
          deviceTimestamp: at,
          serverReceivedAt: new Date(at.getTime() + 2_000),
          deviceTimeDeviationSeconds: 2,
          latitude: NEARBY_LAT,
          longitude: SITE_LNG,
          accuracyMeters: 9,
          distanceFromSiteMeters: 55.6,
          locationValidationStatus: LocationValidationStatus.PASSED,
          ...extra,
        },
      });

    // ── Today, through the real endpoints: refused attempts, clock-in and clock-out. ──
    const todayShift = await shiftFor(worker.workerProfile.id, new Date(Date.now() - minutes(60)), 9 * 60, "إغلاق مسار في شارع يافا");
    const clock = (kind: "clock-in" | "clock-out", body: Record<string, unknown>) =>
      post(tokens.worker, `/clock-events/${kind}`, {
        deviceId: "reports-device",
        clientEventId: uuidv7(),
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
        ...body,
      });
    await clock("clock-in", { shiftId: todayShift.id, latitude: FAR_LAT }).expect(400);
    await clock("clock-in", { shiftId: todayShift.id, accuracyMeters: 80 }).expect(400);
    await clock("clock-in", { shiftId: todayShift.id, deviceTimestamp: new Date(Date.now() - minutes(10)).toISOString() }).expect(400);
    const clockIn = await clock("clock-in", { shiftId: todayShift.id }).expect(201);
    const todayEntryId: string = clockIn.body.timeEntry.id;
    await clock("clock-out", { mockLocationSuspected: true, summaryText: "x", taskCategory: "OTHER" }).expect(403);
    await clock("clock-out", { summaryText: "أغلقنا المسار ووجّهنا حركة المرور.", taskCategory: "TRAFFIC_CONTROL" }).expect(201);

    // The manager: the worker started on time but forgot to clock in -> 10 h 30 m, forgotten stamp no. 1.
    const closed = await prisma.timeEntry.findUniqueOrThrow({ where: { id: todayEntryId } });
    await post(tokens.manager, "/manual-corrections", {
      timeEntryId: todayEntryId,
      field: "CLOCK_IN",
      newValue: new Date(closed.clockOutAt!.getTime() - minutes(630)).toISOString(),
      reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
      note: "بدأ في الموعد وكان الهاتف في السيارة",
    }).expect(201);

    // ── Earlier days of the worker, stored the way a clock-out leaves them. ──
    const earlier: { id: string; start: Date }[] = [];
    for (let daysAgo = 1; daysAgo <= 6; daysAgo += 1) {
      const start = morningOf(daysAgo);
      const forgotClockOut = daysAgo <= 2;
      const shift = await shiftFor(worker.workerProfile.id, start, 540, `صيانة إشارات المرور — اليوم ${daysAgo}`);
      const entry = await prisma.timeEntry.create({
        data: {
          id: uuidv7(),
          organizationId,
          workerProfileId: worker.workerProfile.id,
          shiftId: shift.id,
          status: forgotClockOut ? TimeEntryStatus.ACTIVE : TimeEntryStatus.PENDING_APPROVAL,
          businessDate: toBusinessDate(start),
          clockInAt: start,
          clockOutAt: forgotClockOut ? null : new Date(start.getTime() + minutes(540)),
          rawDurationMinutes: forgotClockOut ? null : 540,
          checkInMethod: CheckInMethod.GEOFENCED,
        },
      });
      let point: { id: string } | null = null;
      if (daysAgo === 3) {
        point = await prisma.temporaryCheckInPoint.create({
          data: {
            id: uuidv7(),
            organizationId,
            shiftId: shift.id,
            name: "البوابة الشمالية",
            latitude: NEARBY_LAT,
            longitude: SITE_LNG,
            radiusMeters: 100,
            status: TemporaryPointStatus.EXPIRED,
            createdBy: manager.user.id,
            managerAuthorizedBy: manager.user.id,
            expiresAt: new Date(start.getTime() + minutes(600)),
          },
        });
      }
      await clockEvent(entry.id, ClockEventType.CLOCK_IN, start, point ? { temporaryCheckInPointId: point.id, distanceFromSiteMeters: 12.3 } : {});
      if (!forgotClockOut) {
        const offline = daysAgo === 4;
        await clockEvent(
          entry.id,
          ClockEventType.CLOCK_OUT,
          new Date(start.getTime() + minutes(540)),
          offline ? { origin: EventOrigin.OFFLINE, deviceTimeDeviationSeconds: 900, locationValidationStatus: LocationValidationStatus.FLAGGED } : {},
        );
      }
      if (forgotClockOut) {
        // Forgotten clock-out: the manager closes the entry (forgotten stamps no. 2 and 3; the third deducts).
        await post(tokens.manager, "/manual-corrections", {
          timeEntryId: entry.id,
          field: "CLOCK_OUT",
          newValue: new Date(start.getTime() + minutes(540)).toISOString(),
          reason: CorrectionReason.FORGOTTEN_CLOCK_OUT,
        }).expect(201);
      }
      earlier.push({ id: entry.id, start });
    }
    // Forgotten stamp no. 4 (deducts), on day 3: the clock-in was forgotten.
    await post(tokens.manager, "/manual-corrections", {
      timeEntryId: earlier[2].id,
      field: "CLOCK_IN",
      newValue: earlier[2].start.toISOString(),
      reason: CorrectionReason.FORGOTTEN_CLOCK_IN,
    }).expect(201);

    for (const id of [todayEntryId, ...earlier.map((entry) => entry.id)]) await post(tokens.manager, `/time-entries/${id}/approve`).expect(201);

    // The Owner reverses the fourth stamp's deduction.
    const fourth = await prisma.forgottenStampInfraction.findFirstOrThrow({ where: { workerProfileId: worker.workerProfile.id, monthlySequenceNumber: 4 } });
    await post(tokens.owner, `/forgotten-stamp-infractions/${fourth.id}/reverse`, { reason: "الهاتف كان معطلاً" }).expect(201);

    // ── The other worker: a Night Turan emergency (02:00-03:00) and a Flexi-Check day. ──
    const emergencyDay = morningOf(3);
    const actualStartClick = new Date(Date.UTC(emergencyDay.getUTCFullYear(), emergencyDay.getUTCMonth(), emergencyDay.getUTCDate(), 0, 0, 0));
    const compensation = computeEmergencyCompensation(actualStartClick, new Date(actualStartClick.getTime() + minutes(60)));
    const turan = await prisma.turanAssignment.create({
      data: {
        id: uuidv7(),
        organizationId,
        turanType: TuranType.NIGHT_TURAN,
        status: TuranStatus.COMPLETED,
        startAt: new Date(actualStartClick.getTime() - minutes(180)),
        endAt: new Date(actualStartClick.getTime() + minutes(240)),
        assignedWorkerProfileId: otherWorker.workerProfile.id,
        createdBy: owner.user.id,
      },
    });
    const emergencyShift = await prisma.shift.create({
      data: {
        id: uuidv7(),
        organizationId,
        shiftType: ShiftType.EMERGENCY_CALLOUT,
        title: "Emergency Call-out",
        scheduledStart: compensation.compensatedStart,
        scheduledEnd: compensation.compensatedEnd,
        checkInMethod: CheckInMethod.FLEXI_CHECK,
        businessDate: toBusinessDate(compensation.compensatedStart),
        managerId: manager.user.id,
        status: ShiftStatus.ACTIVE,
        createdBy: otherWorker.user.id,
      },
    });
    const emergencyEntry = await prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        organizationId,
        workerProfileId: otherWorker.workerProfile.id,
        shiftId: emergencyShift.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        businessDate: toBusinessDate(compensation.compensatedStart),
        clockInAt: compensation.compensatedStart,
        clockOutAt: compensation.compensatedEnd,
        rawDurationMinutes: compensation.compensatedDurationMinutes,
        checkInMethod: CheckInMethod.FLEXI_CHECK,
        isEmergency: true,
      },
    });
    await prisma.emergencyCallout.create({
      data: {
        id: uuidv7(),
        organizationId,
        turanAssignmentId: turan.id,
        workerProfileId: otherWorker.workerProfile.id,
        timeEntryId: emergencyEntry.id,
        authorizationSource: EmergencyAuthorizationSource.NIGHT_TURAN_ASSIGNMENT,
        actualStartClick: compensation.actualStartClick,
        compensatedStart: compensation.compensatedStart,
        actualEndClick: compensation.actualEndClick,
        compensatedEnd: compensation.compensatedEnd,
        actualWorkedMinutes: compensation.actualWorkedMinutes,
        retroactiveMinutes: compensation.retroactiveMinutes,
        returnBufferMinutes: compensation.returnBufferMinutes,
        compensatedDurationMinutes: compensation.compensatedDurationMinutes,
        startLatitude: NEARBY_LAT,
        startLongitude: SITE_LNG,
        endLatitude: NEARBY_LAT,
        endLongitude: SITE_LNG,
      },
    });
    await prisma.dailySummary.create({
      data: { id: uuidv7(), timeEntryId: emergencyEntry.id, text: "أصلحنا إشارة المرور المعطلة.", taskCategory: "TRAFFIC_LIGHT_REPAIR" },
    });
    await post(tokens.manager, `/time-entries/${emergencyEntry.id}/approve`).expect(201);

    const flexiStart = morningOf(2);
    const flexiShift = await shiftFor(otherWorker.workerProfile.id, flexiStart, 480, "تركيب لافتات في النفق", CheckInMethod.FLEXI_CHECK);
    const flexiEntry = await prisma.timeEntry.create({
      data: {
        id: uuidv7(),
        organizationId,
        workerProfileId: otherWorker.workerProfile.id,
        shiftId: flexiShift.id,
        status: TimeEntryStatus.PENDING_APPROVAL,
        businessDate: toBusinessDate(flexiStart),
        clockInAt: flexiStart,
        clockOutAt: new Date(flexiStart.getTime() + minutes(480)),
        rawDurationMinutes: 480,
        checkInMethod: CheckInMethod.FLEXI_CHECK,
        flexiCheckEnabledBy: manager.user.id,
        flexiCheckReason: "لا توجد تغطية GPS في النفق",
      },
    });
    await clockEvent(flexiEntry.id, ClockEventType.CLOCK_IN, flexiStart, { distanceFromSiteMeters: 412.4, accuracyMeters: 30 });

    // ── This month's payroll: calculated and finalized (version 1). ──
    const yearMonth = toBusinessYearMonth(new Date());
    await calculatePayroll(app, tokens.owner, yearMonth);
    await post(tokens.owner, `/payroll-periods/${yearMonth}/finalize`).expect(201);

    const period = { fromDate: toBusinessDate(new Date(Date.now() - 10 * 86_400_000)), toDate: toBusinessDate(new Date()) };
    return { organizationId, owner, manager, worker, otherWorker, project, site, tokens, todayEntryId, yearMonth, period };
  }

  /** POST /reports (202) and wait for the job; answers the finished report. */
  async function generate(token: string, reportType: ReportType, filters: Record<string, unknown>) {
    const created = await post(token, "/reports", { reportType, filters }).expect(202);
    expect(created.body).toMatchObject({ id: expect.any(String), reportType, filters: expect.any(Object) });
    expect(["QUEUED", "RUNNING", "READY"]).toContain(created.body.status);
    return waitForReport(app, token, created.body.id);
  }

  /** The signed download URL of a format, then the file itself through it. */
  async function download(token: string, reportId: string, format: "pdf" | "csv") {
    const response = await get(token, `/reports/${reportId}/download?format=${format}`).expect(200);
    const file = await fetch(response.body.downloadUrl);
    expect(file.status).toBe(200);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(sha256(bytes)).toBe(response.body.sha256);
    return {
      ...(response.body as { downloadUrl: string; expiresInSeconds: number; fileName: string; sha256: string }),
      bytes,
      disposition: file.headers.get("content-disposition"),
    };
  }

  async function pdfOf(token: string, reportId: string) {
    const file = await download(token, reportId, "pdf");
    expect(file.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = await extractPdfText(file.bytes);
    return { ...file, pages: text.pages, total: text.total, text: text.pages.join("\n") };
  }

  async function csvOf(token: string, reportId: string) {
    const file = await download(token, reportId, "csv");
    expect([...file.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = file.bytes.toString("utf8").slice(1);
    const lines = text.split("\r\n");
    expect(lines.at(-1)).toBe("");
    expect(lines[0]).toMatch(/[\u0621-\u064A]/);
    expect(lines[0].replace(/GPS/g, "")).not.toMatch(/[A-Za-z]/);
    expect(text).not.toMatch(ARABIC_INDIC_DIGIT);
    return { ...file, text, lines: lines.slice(0, -1) };
  }

  function expectArabic(text: string, ...phrases: string[]) {
    for (const phrase of phrases) expect({ phrase, found: pdfHasArabic(text, phrase) }).toEqual({ phrase, found: true });
  }

  function expectNoMoney(text: string) {
    expect(text).not.toContain("₪");
    expect(text).not.toMatch(AMOUNT);
  }

  it("the worker attendance ledger: the Owner's and the worker's own are financial, the Field Manager's operational; the footer of every page has the report id and data hash", async () => {
    const filters = { ...ctx.period, workerProfileId: ctx.worker.workerProfile.id };
    const ownerReport = await generate(ctx.tokens.owner, ReportType.WORKER_ATTENDANCE_LEDGER, filters);
    expect(ownerReport).toMatchObject({
      status: "READY",
      progress: 100,
      reportType: "WORKER_ATTENDANCE_LEDGER",
      includesFinancials: true,
      templateVersion: "worker-attendance-ledger-ar-v1",
      filters,
      requestedByUserId: ctx.owner.user.id,
      requestedByName: "دانا المالكة",
      subjectWorkerProfileId: ctx.worker.workerProfile.id,
      subjectWorkerName: "خالد ناصر",
      errorCode: null,
    });
    expect(ownerReport.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerReport.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerReport.csvSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerReport.finishedAt).not.toBeNull();

    const pdf = await pdfOf(ctx.tokens.owner, ownerReport.id);
    expect(pdf.fileName).toMatch(/^سجل-حضور-العامل-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(pdf.disposition).toContain(`filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`);
    expect(pdf.expiresInSeconds).toBe(300);
    // Seven days of evidence: several pages, each with the footer.
    expect(ownerReport.pageCount).toBeGreaterThanOrEqual(2);
    expect(pdf.total).toBe(ownerReport.pageCount);
    for (const page of pdf.pages) {
      expect(page).toContain(ownerReport.id);
      expect(page).toContain(ownerReport.sha256Hash);
      expectArabic(page, "صفحة", "معرّف التقرير", "بصمة البيانات");
    }
    expectArabic(pdf.text, "سجل حضور العامل", "نسخة مالية", "شركة الطرق الوطنية", "خالد ناصر", "محاولات رفضها الخادم", "التصحيحات", "يوسف المدير");
    expectArabic(pdf.text, "أنت خارج نطاق الموقع", "تم رفض الطلب لأن الجهاز يستخدم موقعا وهميا", "البوابة الشمالية", "أغلقنا المسار");
    // Today's entry: 450.00 + 105.00 overtime = 555.00.
    expect(pdf.text).toContain("555.00");
    expect(pdf.text).toContain("105.00");
    expect(pdf.text).toContain("₪");
    expect(pdf.text).not.toMatch(ARABIC_INDIC_DIGIT);

    const csv = await csvOf(ctx.tokens.owner, ownerReport.id);
    expect(csv.fileName).toMatch(/^سجل-حضور-العامل-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.lines[0]).toContain("إجمالي الأجر (₪)");
    expect(csv.text).toContain(",450.00,105.00,555.00,");
    expect(csv.lines).toHaveLength(1 + 7 + 1); // header, 7 entries, totals

    // The Field Manager: the operational template, no money anywhere.
    const managerReport = await generate(ctx.tokens.manager, ReportType.WORKER_ATTENDANCE_LEDGER, filters);
    expect(managerReport).toMatchObject({ status: "READY", includesFinancials: false, subjectWorkerName: "خالد ناصر" });
    const managerPdf = await pdfOf(ctx.tokens.manager, managerReport.id);
    expectArabic(managerPdf.text, "سجل حضور العامل", "نسخة تشغيلية", "بدون مبالغ", "خالد ناصر", "المخالفة رقم");
    expectNoMoney(managerPdf.text);
    for (const page of managerPdf.pages) expect(page).toContain(managerReport.sha256Hash);
    const managerCsv = await csvOf(ctx.tokens.manager, managerReport.id);
    expectNoMoney(managerCsv.text);
    expect(managerCsv.lines[0]).not.toContain("الأجر");

    // The worker's own ledger is financial too.
    const ownReport = await generate(ctx.tokens.worker, ReportType.WORKER_ATTENDANCE_LEDGER, filters);
    expect(ownReport).toMatchObject({ status: "READY", includesFinancials: true, requestedByName: "خالد ناصر" });
    const ownPdf = await pdfOf(ctx.tokens.worker, ownReport.id);
    expect(ownPdf.text).toContain("555.00");

    // Same data, different requests: different reports, so different data hashes.
    expect(new Set([ownerReport.sha256Hash, managerReport.sha256Hash, ownReport.sha256Hash]).size).toBe(3);
  });

  it("operational attendance: the same money-free report for the Owner and the Field Manager", async () => {
    for (const token of [ctx.tokens.owner, ctx.tokens.manager]) {
      const report = await generate(token, ReportType.OPERATIONAL_ATTENDANCE, ctx.period);
      expect(report).toMatchObject({
        status: "READY",
        includesFinancials: false,
        templateVersion: "operational-attendance-ar-v1",
        subjectWorkerProfileId: null,
      });
      const pdf = await pdfOf(token, report.id);
      expectArabic(pdf.text, "تقرير الحضور التشغيلي", "نسخة تشغيلية", "خالد ناصر", "باسل عازر", "تقاطع الجامعة", "تمت الموافقة", "تسجيل مرن", "استدعاء طوارئ");
      expectNoMoney(pdf.text);
      for (const page of pdf.pages) expect(page).toContain(report.id);
      const csv = await csvOf(token, report.id);
      expectNoMoney(csv.text);
      // 7 entries of the first worker, the emergency and the Flexi-Check day of the second.
      expect(csv.lines).toHaveLength(1 + 9);
    }

    // Narrowed to one project and one worker.
    const narrowed = await generate(ctx.tokens.manager, ReportType.OPERATIONAL_ATTENDANCE, {
      ...ctx.period,
      projectId: ctx.project.id,
      workerProfileId: ctx.otherWorker.workerProfile.id,
    });
    const csv = await csvOf(ctx.tokens.manager, narrowed.id);
    expect(csv.lines).toHaveLength(1 + 1);
    expect(csv.text).toContain("باسل عازر");
    expect(csv.text).not.toContain("خالد ناصر");
  });

  it("overtime: the Owner's version adds the overtime pay, the Field Manager's has minutes only", async () => {
    const ownerReport = await generate(ctx.tokens.owner, ReportType.OVERTIME, ctx.period);
    expect(ownerReport).toMatchObject({ status: "READY", includesFinancials: true });
    const ownerPdf = await pdfOf(ctx.tokens.owner, ownerReport.id);
    expectArabic(ownerPdf.text, "تقرير الساعات الإضافية", "نسخة مالية", "خالد ناصر", "الساعات الإضافية حسب العامل");
    // Today's 90 overtime minutes at ₪70/h.
    expect(ownerPdf.text).toContain("105.00");
    const ownerCsv = await csvOf(ctx.tokens.owner, ownerReport.id);
    expect(ownerCsv.text).toContain(",90,");
    expect(ownerCsv.text).toContain("105.00");

    const managerReport = await generate(ctx.tokens.manager, ReportType.OVERTIME, ctx.period);
    expect(managerReport).toMatchObject({ status: "READY", includesFinancials: false });
    const managerPdf = await pdfOf(ctx.tokens.manager, managerReport.id);
    expectArabic(managerPdf.text, "تقرير الساعات الإضافية", "نسخة تشغيلية", "خالد ناصر");
    expectNoMoney(managerPdf.text);
    const managerCsv = await csvOf(ctx.tokens.manager, managerReport.id);
    expectNoMoney(managerCsv.text);
    expect(managerCsv.text).toContain(",90");
  });

  it("emergency call-outs: actual and compensated times, -60 / +15; the cost in the Owner's version only", async () => {
    const ownerReport = await generate(ctx.tokens.owner, ReportType.EMERGENCY_CALLOUTS, ctx.period);
    const ownerPdf = await pdfOf(ctx.tokens.owner, ownerReport.id);
    expectArabic(ownerPdf.text, "تقرير استدعاءات الطوارئ", "باسل عازر", "تكليف بمناوبة ليلية", "البداية المحتسبة", "أصلحنا إشارة المرور المعطلة");
    // 135 compensated minutes at ₪50/h.
    expect(ownerPdf.text).toContain("112.50");
    const ownerCsv = await csvOf(ctx.tokens.owner, ownerReport.id);
    expect(ownerCsv.text).toContain(",60,60,15,135,");
    expect(ownerCsv.text).toContain("112.50");

    const managerReport = await generate(ctx.tokens.manager, ReportType.EMERGENCY_CALLOUTS, {
      ...ctx.period,
      workerProfileId: ctx.otherWorker.workerProfile.id,
    });
    expect(managerReport).toMatchObject({ includesFinancials: false, subjectWorkerName: "باسل عازر" });
    const managerPdf = await pdfOf(ctx.tokens.manager, managerReport.id);
    expectArabic(managerPdf.text, "تقرير استدعاءات الطوارئ", "باسل عازر", "المدة المحتسبة");
    expectNoMoney(managerPdf.text);
    expectNoMoney((await csvOf(ctx.tokens.manager, managerReport.id)).text);
  });

  it("site violations: refused attempts with their reason and numbers, suspicious locations, Flexi-Check and temporary points; no money", async () => {
    for (const token of [ctx.tokens.owner, ctx.tokens.manager]) {
      const report = await generate(token, ReportType.SITE_VIOLATIONS, ctx.period);
      expect(report).toMatchObject({ status: "READY", includesFinancials: false });
      const pdf = await pdfOf(token, report.id);
      expectArabic(
        pdf.text,
        "تقرير مخالفات الموقع",
        "محاولات تسجيل رفضها الخادم",
        "خارج نطاق الموقع",
        "دقة تحديد الموقع ضعيفة",
        "ساعة الجهاز تختلف عن الوقت الصحيح",
      );
      expectArabic(pdf.text, "مواقع مشبوهة أو وهمية", "رفض: موقع وهمي", "لا توجد تغطية", "البوابة الشمالية");
      expectNoMoney(pdf.text);
      const csv = await csvOf(token, report.id);
      expectNoMoney(csv.text);
      // 4 refused attempts, 1 flagged clock-out, 1 Flexi-Check entry, 1 temporary point clock-in.
      expect(csv.lines).toHaveLength(1 + 4 + 1 + 1 + 1);
    }
  });

  it("forgotten stamps: infractions per worker; the Owner's version adds deductions, reversals and the net", async () => {
    const ownerReport = await generate(ctx.tokens.owner, ReportType.FORGOTTEN_STAMPS, { yearMonth: ctx.yearMonth });
    expect(ownerReport).toMatchObject({ status: "READY", includesFinancials: true, filters: { yearMonth: ctx.yearMonth } });
    const ownerPdf = await pdfOf(ctx.tokens.owner, ownerReport.id);
    expectArabic(ownerPdf.text, "تقرير نسيان التسجيل", "خالد ناصر", "المخالفة رقم", "أُلغي الخصم", "الهاتف كان معطلا");
    expect(ownerPdf.text).toContain("10.00");
    const ownerCsv = await csvOf(ctx.tokens.owner, ownerReport.id);
    expect(ownerCsv.lines).toHaveLength(1 + 4 + 1);
    expect(ownerCsv.lines.at(-1)).toContain(",-20.00,10.00");

    const managerReport = await generate(ctx.tokens.manager, ReportType.FORGOTTEN_STAMPS, { ...ctx.period, workerProfileId: ctx.worker.workerProfile.id });
    const managerPdf = await pdfOf(ctx.tokens.manager, managerReport.id);
    expectArabic(managerPdf.text, "تقرير نسيان التسجيل", "نسخة تشغيلية", "خالد ناصر", "المخالفة رقم");
    expectNoMoney(managerPdf.text);
    const managerCsv = await csvOf(ctx.tokens.manager, managerReport.id);
    expectNoMoney(managerCsv.text);
    expect(managerCsv.lines).toHaveLength(1 + 4);
  });

  it("payroll: the Owner's report of a stored version (never recalculated); anyone else 403", async () => {
    const version = (await get(ctx.tokens.owner, `/payroll-periods/${ctx.yearMonth}/versions/1`).expect(200)).body;
    expect(version.status).toBe("FINALIZED");
    const report = await generate(ctx.tokens.owner, ReportType.PAYROLL, { yearMonth: ctx.yearMonth });
    // The version is resolved and stored with the report.
    expect(report).toMatchObject({
      status: "READY",
      includesFinancials: true,
      filters: { yearMonth: ctx.yearMonth, version: 1 },
      subjectWorkerProfileId: null,
    });
    const pdf = await pdfOf(ctx.tokens.owner, report.id);
    expectArabic(pdf.text, "تقرير الرواتب", "معتمدة نهائيا", "رواتب العمال", "خصم نسيان تسجيل");
    const net = (agorot: number) => `${Math.floor(agorot / 100).toLocaleString("en-US")}.${String(agorot % 100).padStart(2, "0")}`;
    expect(pdf.text).toContain(net(version.totals.netPayableAgorot));
    // Every worker of the version with their net (early in a month the second worker's days may belong to the previous one).
    expect(version.workers.map((line: { fullLegalName: string }) => line.fullLegalName)).toContain("خالد ناصر");
    for (const line of version.workers) {
      expectArabic(pdf.text, line.fullLegalName);
      expect(pdf.text).toContain(net(line.netPayableAgorot));
    }
    const csv = await csvOf(ctx.tokens.owner, report.id);
    expect(csv.lines).toHaveLength(1 + version.workers.length + 1);
    expect(csv.lines.at(-1)).toContain(
      `${Math.floor(version.totals.netPayableAgorot / 100)}.${String(version.totals.netPayableAgorot % 100).padStart(2, "0")}`,
    );

    await post(ctx.tokens.manager, "/reports", { reportType: ReportType.PAYROLL, filters: { yearMonth: ctx.yearMonth } }).expect(403);
    await post(ctx.tokens.worker, "/reports", { reportType: ReportType.PAYROLL, filters: { yearMonth: ctx.yearMonth } }).expect(403);
    // A month or version that does not exist.
    await post(ctx.tokens.owner, "/reports", { reportType: ReportType.PAYROLL, filters: { yearMonth: "2020-01" } }).expect(404);
    await post(ctx.tokens.owner, "/reports", { reportType: ReportType.PAYROLL, filters: { yearMonth: ctx.yearMonth, version: 9 } }).expect(404);
  });

  it("who may generate and who may see: a Worker only their own ledger; the list and details follow the same rules", async () => {
    const workerFilters = { ...ctx.period, workerProfileId: ctx.worker.workerProfile.id };
    for (const type of [ReportType.OPERATIONAL_ATTENDANCE, ReportType.OVERTIME, ReportType.EMERGENCY_CALLOUTS, ReportType.SITE_VIOLATIONS]) {
      const response = await post(ctx.tokens.worker, "/reports", { reportType: type, filters: ctx.period }).expect(403);
      expect(response.body.code).toBe("FORBIDDEN");
    }
    await post(ctx.tokens.worker, "/reports", { reportType: ReportType.FORGOTTEN_STAMPS, filters: { yearMonth: ctx.yearMonth } }).expect(403);
    await post(ctx.tokens.otherWorker, "/reports", { reportType: ReportType.WORKER_ATTENDANCE_LEDGER, filters: workerFilters }).expect(403);

    const ownerFinancial = await generate(ctx.tokens.owner, ReportType.OVERTIME, ctx.period);
    const managerReport = await generate(ctx.tokens.manager, ReportType.SITE_VIOLATIONS, ctx.period);
    const aboutWorker = await generate(ctx.tokens.manager, ReportType.OPERATIONAL_ATTENDANCE, workerFilters);

    const ids = (body: { id: string }[]) => body.map((report) => report.id);
    const ownerList = ids((await get(ctx.tokens.owner, "/reports").expect(200)).body);
    expect(ownerList).toEqual(expect.arrayContaining([ownerFinancial.id, managerReport.id, aboutWorker.id]));
    const managerList = ids((await get(ctx.tokens.manager, "/reports").expect(200)).body);
    expect(managerList).toEqual(expect.arrayContaining([managerReport.id, aboutWorker.id]));
    expect(managerList).not.toContain(ownerFinancial.id);
    const workerList = ids((await get(ctx.tokens.worker, "/reports").expect(200)).body);
    expect(workerList).toContain(aboutWorker.id);
    expect(workerList).not.toContain(managerReport.id);
    expect(workerList).not.toContain(ownerFinancial.id);
    // Newest first, with names from the users table.
    const listed = (await get(ctx.tokens.owner, "/reports").expect(200)).body;
    expect(listed[0].generatedAt >= listed[listed.length - 1].generatedAt).toBe(true);
    expect(listed.find((report: { id: string }) => report.id === aboutWorker.id)).toMatchObject({
      requestedByName: "يوسف المدير",
      subjectWorkerName: "خالد ناصر",
    });

    // Not visible: 404 on the details and the files alike (nothing tells it exists); another organization never finds it.
    await get(ctx.tokens.manager, `/reports/${ownerFinancial.id}`).expect(404);
    await get(ctx.tokens.manager, `/reports/${ownerFinancial.id}/download`).expect(404);
    await get(ctx.tokens.manager, `/reports/${ownerFinancial.id}/verify`).expect(404);
    await get(ctx.tokens.otherWorker, `/reports/${aboutWorker.id}`).expect(404);
    await get(ctx.tokens.worker, `/reports/${aboutWorker.id}`).expect(200);
    await get(ctx.tokens.owner, "/reports/not-a-uuid").expect(404);
    await get(ctx.tokens.owner, `/reports/${uuidv7()}`).expect(404);
    await get(ctx.tokens.owner, `/reports/${uuidv7()}/download`).expect(404);
  });

  it("the same Idempotency-Key answers the same report; the same key with another request is a conflict", async () => {
    const key = uuidv7();
    const body = { reportType: ReportType.SITE_VIOLATIONS, filters: ctx.period };
    const first = await post(ctx.tokens.manager, "/reports", body, key).expect(202);
    const second = await post(ctx.tokens.manager, "/reports", body, key).expect(202);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.generatedReport.count({ where: { idempotencyKey: key } })).toBe(1);
    const conflict = await post(ctx.tokens.manager, "/reports", { ...body, filters: { ...ctx.period, siteId: ctx.site.id } }, key).expect(409);
    expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    // Someone else reusing the key never gets this report.
    expect((await post(ctx.tokens.owner, "/reports", body, key).expect(409)).body.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    // Without a key: refused.
    const missing = await request(http()).post("/api/v1/reports").set("Authorization", `Bearer ${ctx.tokens.manager}`).send(body).expect(400);
    expect(missing.body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    await waitForReport(app, ctx.tokens.manager, first.body.id);
  });

  it("a report is QUEUED then RUNNING with progress; downloading or verifying it before READY is 409 REPORT_NOT_READY", async () => {
    const data = app.get(ReportDataService);
    const original = data.load.bind(data);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    jest.spyOn(data, "load").mockImplementationOnce(async (...args) => {
      await gate;
      return original(...args);
    });

    const created = await post(ctx.tokens.owner, "/reports", { reportType: ReportType.OVERTIME, filters: ctx.period }).expect(202);
    expect(created.body).toMatchObject({
      status: expect.stringMatching(/QUEUED|RUNNING/),
      sha256Hash: null,
      pdfSha256: null,
      pageCount: null,
      finishedAt: null,
    });
    let running = created.body;
    for (let attempt = 0; attempt < 200 && running.status !== "RUNNING"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      running = (await get(ctx.tokens.owner, `/reports/${created.body.id}`).expect(200)).body;
    }
    expect(running).toMatchObject({ status: "RUNNING", progress: 5 });

    for (const path of ["download", "download?format=csv", "verify"]) {
      const refused = await get(ctx.tokens.owner, `/reports/${created.body.id}/${path}`).expect(409);
      expect(refused.body.code).toBe("REPORT_NOT_READY");
    }

    release();
    const ready = await waitForReport(app, ctx.tokens.owner, created.body.id);
    expect(ready).toMatchObject({ status: "READY", progress: 100 });
    await get(ctx.tokens.owner, `/reports/${created.body.id}/download`).expect(200);
  });

  it("verify: the stored files match their recorded SHA-256 until one is changed; generation, downloads and checks are audited", async () => {
    const report = await generate(ctx.tokens.owner, ReportType.EMERGENCY_CALLOUTS, ctx.period);
    const valid = (await get(ctx.tokens.owner, `/reports/${report.id}/verify`).expect(200)).body;
    expect(valid).toEqual({
      reportId: report.id,
      valid: true,
      checkedAt: expect.any(String),
      dataSha256: report.sha256Hash,
      files: [
        { format: "PDF", expectedSha256: report.pdfSha256, actualSha256: report.pdfSha256, matches: true },
        { format: "CSV", expectedSha256: report.csvSha256, actualSha256: report.csvSha256, matches: true },
      ],
    });
    await download(ctx.tokens.owner, report.id, "pdf");
    await download(ctx.tokens.owner, report.id, "csv");

    // Someone replaces the stored PDF.
    const row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.storageKey).toBe(`reports/${ctx.organizationId}/${report.id}.pdf`);
    expect(row.csvStorageKey).toBe(`reports/${ctx.organizationId}/${report.id}.csv`);
    const tampered = Buffer.from("%PDF-1.7\n% not the generated report\n");
    await files.putObject(row.storageKey!, tampered, "application/pdf");
    const invalid = (await get(ctx.tokens.owner, `/reports/${report.id}/verify`).expect(200)).body;
    expect(invalid).toMatchObject({
      valid: false,
      files: [
        { format: "PDF", expectedSha256: report.pdfSha256, actualSha256: sha256(tampered), matches: false },
        { format: "CSV", matches: true },
      ],
    });

    const audit = await prisma.auditLog.findMany({ where: { entityType: "GeneratedReport", entityId: report.id }, orderBy: { sequenceNumber: "asc" } });
    expect(audit.map((event) => [event.action, event.field, event.newValue])).toEqual([
      ["REPORT_REQUESTED", null, null],
      ["REPORT_GENERATED", null, report.sha256Hash],
      ["REPORT_VERIFIED", null, "valid"],
      ["REPORT_DOWNLOADED", "format", "pdf"],
      ["REPORT_DOWNLOADED", "format", "csv"],
      ["REPORT_VERIFIED", null, "invalid"],
    ]);
    expect(audit.every((event) => event.organizationId === ctx.organizationId)).toBe(true);
    // The hash chain still holds.
    expect((await get(ctx.tokens.owner, "/audit-logs/verify").expect(200)).body).toEqual({ valid: true });
  });

  it("a failing job ends FAILED with an error code, references no file and is audited", async () => {
    const data = app.get(ReportDataService);
    jest.spyOn(data, "load").mockRejectedValueOnce(new Error("Simulated failure while reading the report data"));

    const created = await post(ctx.tokens.owner, "/reports", { reportType: ReportType.SITE_VIOLATIONS, filters: ctx.period }).expect(202);
    const failed = await waitForReport(app, ctx.tokens.owner, created.body.id);
    expect(failed).toMatchObject({ status: "FAILED", errorCode: "INTERNAL_ERROR", sha256Hash: null, pdfSha256: null, csvSha256: null, pageCount: null });
    expect(failed.finishedAt).not.toBeNull();
    const row = await prisma.generatedReport.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row).toMatchObject({ storageKey: null, csvStorageKey: null, errorMessage: "Simulated failure while reading the report data" });
    expect(await files.getObject(`reports/${ctx.organizationId}/${created.body.id}.pdf`)).toBeNull();
    expect((await get(ctx.tokens.owner, `/reports/${created.body.id}/download`).expect(409)).body.code).toBe("REPORT_NOT_READY");
    const audit = await prisma.auditLog.findMany({ where: { entityType: "GeneratedReport", entityId: created.body.id }, orderBy: { sequenceNumber: "asc" } });
    expect(audit.map((event) => event.action)).toEqual(["REPORT_REQUESTED", "REPORT_GENERATION_FAILED"]);

    // The next report is unaffected.
    const next = await generate(ctx.tokens.owner, ReportType.SITE_VIOLATIONS, ctx.period);
    expect(next.status).toBe("READY");
  });

  it("filters are checked per type (400) and must exist in the organization (404)", async () => {
    const create = (filters: Record<string, unknown>, reportType: string = ReportType.OVERTIME) => post(ctx.tokens.owner, "/reports", { reportType, filters });
    const invalid = async (response: ReturnType<typeof post>) => expect((await response.expect(400)).body.code).toBe("VALIDATION_FAILED");
    await invalid(create(ctx.period, "SALARY_SLIPS"));
    await invalid(create({}));
    await invalid(create({ fromDate: "2026-10-31", toDate: "2026-10-01" }));
    await invalid(create({ fromDate: "2025-01-01", toDate: "2026-06-30" }));
    await invalid(create({ fromDate: "2026-02-30", toDate: "2026-03-02" }));
    await invalid(create({ ...ctx.period, workerProfileId: "someone" }));
    await invalid(create({ ...ctx.period, unknownFilter: 1 }));
    await invalid(create(ctx.period, ReportType.WORKER_ATTENDANCE_LEDGER));
    await invalid(create({ ...ctx.period, projectId: ctx.project.id }, ReportType.EMERGENCY_CALLOUTS));
    await invalid(create({ ...ctx.period, yearMonth: ctx.yearMonth }, ReportType.FORGOTTEN_STAMPS));
    await invalid(create({ yearMonth: "2026-13" }, ReportType.PAYROLL));
    await invalid(post(ctx.tokens.owner, "/reports", { reportType: ReportType.OVERTIME }));

    expect((await create({ ...ctx.period, workerProfileId: uuidv7() }).expect(404)).body.code).toBe("NOT_FOUND");
    await create({ ...ctx.period, projectId: uuidv7() }).expect(404);
    await create({ ...ctx.period, siteId: uuidv7() }).expect(404);
    expect(await prisma.generatedReport.count({ where: { organizationId: ctx.organizationId, status: "QUEUED" } })).toBe(0);
  });

  it("a report from before Step 8 (no CSV, no file hash, its object gone) still answers: details, PDF link, verify invalid -- never a 500", async () => {
    const legacy = await prisma.generatedReport.create({
      data: {
        id: uuidv7(),
        organizationId: ctx.organizationId,
        reportType: ReportType.WORKER_ATTENDANCE_LEDGER,
        requestedByUserId: ctx.manager.user.id,
        subjectWorkerProfileId: ctx.worker.workerProfile.id,
        filtersJson: ctx.period,
        includesFinancials: false,
        templateVersion: "worker-attendance-ledger-v1",
        sha256Hash: "0".repeat(64),
        storageKey: `reports/${ctx.organizationId}/missing-${uuidv7()}.pdf`,
      },
    });
    const details = (await get(ctx.tokens.manager, `/reports/${legacy.id}`).expect(200)).body;
    expect(details).toMatchObject({ status: "READY", progress: 100, pdfSha256: null, csvSha256: null, pageCount: null, subjectWorkerName: "خالد ناصر" });
    await get(ctx.tokens.manager, `/reports/${legacy.id}/download?format=csv`).expect(404);
    await get(ctx.tokens.manager, `/reports/${legacy.id}/download?format=xlsx`).expect(400);
    const verified = (await get(ctx.tokens.manager, `/reports/${legacy.id}/verify`).expect(200)).body;
    expect(verified).toMatchObject({
      valid: false,
      dataSha256: "0".repeat(64),
      files: [{ format: "PDF", expectedSha256: null, actualSha256: null, matches: false }],
    });

    // Every GET /reports* route, per role, for a report a Field Manager requested about a worker (the leak scanner's row):
    // the Owner, the requester and the worker it is about read it; anyone else gets 404 on the details and the files.
    const statuses = async (token: string) => {
      const list = await get(token, "/reports");
      return [
        list.status,
        (list.body as { id: string }[]).some((report) => report.id === legacy.id),
        (await get(token, `/reports/${legacy.id}`)).status,
        (await get(token, `/reports/${legacy.id}/download`)).status,
        (await get(token, `/reports/${legacy.id}/verify`)).status,
      ];
    };
    expect(await statuses(ctx.tokens.owner)).toEqual([200, true, 200, 200, 200]);
    expect(await statuses(ctx.tokens.manager)).toEqual([200, true, 200, 200, 200]);
    expect(await statuses(ctx.tokens.worker)).toEqual([200, true, 200, 200, 200]);
    expect(await statuses(ctx.tokens.otherWorker)).toEqual([200, false, 404, 404, 404]);

    // Storage unreachable (or refusing the credentials): verify is still an answer, never a 500.
    jest.spyOn(files, "getObject").mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9000"), { name: "TimeoutError" }));
    const unreachable = (await get(ctx.tokens.owner, `/reports/${legacy.id}/verify`).expect(200)).body;
    expect(unreachable).toMatchObject({ valid: false, files: [{ format: "PDF", actualSha256: null, matches: false }] });
    const ready = await generate(ctx.tokens.owner, ReportType.SITE_VIOLATIONS, ctx.period);
    expect((await get(ctx.tokens.owner, `/reports/${ready.id}/verify`).expect(200)).body).toMatchObject({
      valid: false,
      files: [
        { format: "PDF", expectedSha256: ready.pdfSha256, actualSha256: null, matches: false },
        { format: "CSV", expectedSha256: ready.csvSha256, actualSha256: null, matches: false },
      ],
    });
  });

  it("the synchronous English ledger route is gone", async () => {
    await post(ctx.tokens.owner, "/reports/worker-attendance-ledger", { workerProfileId: ctx.worker.workerProfile.id, ...ctx.period }).expect(404);
  });
});
