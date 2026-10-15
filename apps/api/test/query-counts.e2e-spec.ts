import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { CheckInMethod, CorrectionReason, PayrollCalculationState, ReportStatus, TimeEntryStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { createTestApp, resetDatabase, request, loginAs } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { PayrollCalculationService } from "../src/modules/payroll/payroll-calculation.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";

/**
 * "No query per row" (scalability): the heaviest pages and jobs cost the same
 * number of SQL statements for a handful of workers as for dozens -- a query
 * inside a loop over rows would make the second count grow with the data.
 * The counts are logged so the cost of each page is on record.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const SCOPED_PHONE = "+972500020001";
const SITE = { lat: 32.0853, lng: 34.7818 };

describe("Query counts do not grow with the data", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** Polls jobs without being counted. */
  let poller: PrismaClient;
  const http = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set(auth(token));

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    poller = new PrismaClient();
  });
  afterAll(async () => {
    await poller.$disconnect();
    await app.close();
  });
  beforeEach(async () => {
    await resetDatabase(app);
  });

  /** An organization with `workers` workers, each with two worked days (one waiting for approval, one approved) and a forgotten stamp. */
  async function grow(state: { organizationId: string; managerUserId: string; shiftId: string; ownerUserId: string }, from: number, to: number) {
    const today = toBusinessDate(new Date());
    for (let i = from; i < to; i++) {
      const worker = await addWorker(prisma, state.organizationId, `+97250099${String(i).padStart(4, "0")}`, `Worker ${i}`, { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
      await assignWorkerToShift(prisma, state.shiftId, worker.workerProfile.id, state.managerUserId);
      for (const [dayOffset, status] of [
        [0, TimeEntryStatus.PENDING_APPROVAL],
        [1, TimeEntryStatus.APPROVED],
      ] as const) {
        const day = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - dayOffset));
        const businessDate = day.toISOString().slice(0, 10);
        const clockInAt = new Date(`${businessDate}T05:00:00.000Z`);
        const entry = await prisma.timeEntry.create({
          data: {
            id: uuidv7(),
            organizationId: state.organizationId,
            workerProfileId: worker.workerProfile.id,
            shiftId: state.shiftId,
            status,
            businessDate,
            clockInAt,
            clockOutAt: new Date(clockInAt.getTime() + 9 * 3_600_000),
            rawDurationMinutes: 540,
            approvedRegularMinutes: status === TimeEntryStatus.APPROVED ? 540 : null,
            approvedOvertimeMinutes: status === TimeEntryStatus.APPROVED ? 0 : null,
            approvedBy: status === TimeEntryStatus.APPROVED ? state.ownerUserId : null,
            approvedAt: status === TimeEntryStatus.APPROVED ? new Date() : null,
            checkInMethod: CheckInMethod.GEOFENCED,
          },
        });
        await prisma.clockEvent.createMany({
          data: (["CLOCK_IN", "CLOCK_OUT"] as const).map((eventType) => ({
            id: uuidv7(),
            timeEntryId: entry.id,
            eventType,
            origin: "ONLINE" as const,
            idempotencyKey: uuidv7(),
            deviceId: "d",
            clientEventId: uuidv7(),
            deviceTimestamp: new Date(),
            deviceTimeDeviationSeconds: 0,
            latitude: SITE.lat,
            longitude: SITE.lng,
            accuracyMeters: 10,
            locationValidationStatus: "PASSED" as const,
          })),
        });
        await prisma.dailySummary.create({ data: { id: uuidv7(), timeEntryId: entry.id, text: "Work", taskCategory: "TRAFFIC_CONTROL" } });
        if (dayOffset === 0 && i % 2 === 0) {
          await prisma.manualTimeCorrection.create({
            data: { id: uuidv7(), timeEntryId: entry.id, field: "clockInAt", oldValue: null, newValue: clockInAt.toISOString(), reason: CorrectionReason.FORGOTTEN_CLOCK_IN, editedBy: state.ownerUserId },
          });
        }
      }
    }
  }

  it("lists, the live page, and the payroll and report jobs send a constant number of SQL statements", async () => {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const project = await createProject(prisma, organizationId);
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE.lat, SITE.lng, 100);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, new Date(Date.now() - 3_600_000), new Date(Date.now() + 8 * 3_600_000));
    const state = { organizationId, managerUserId: manager.user.id, shiftId: shift.id, ownerUserId: owner.user.id };
    const ownerToken = (await loginAs(app, OWNER_PHONE)).accessToken;

    // A member restricted to the project: the scope adds a constant, not a query per row.
    const role = await request(http()).post("/api/v1/roles").set(auth(ownerToken)).send({
      name: "Project manager",
      permissions: ["VIEW_ATTENDANCE", "VIEW_OPERATIONS", "VIEW_SHIFTS", "MANAGE_WORKERS", "MANAGE_SITES", "APPROVE_ATTENDANCE", "GENERATE_OPERATIONAL_REPORTS"],
    }).expect(201);
    const scoped = await request(http()).post("/api/v1/memberships").set(auth(ownerToken)).send({ phoneNumber: SCOPED_PHONE, fullLegalName: "Sara Scoped", roleId: role.body.id }).expect(201);
    await request(http()).patch(`/api/v1/memberships/${scoped.body.id}/scope`).set(auth(ownerToken)).send({ restricted: true, projectIds: [project.id], reason: "Their project" }).expect(200);
    const scopedToken = (await loginAs(app, SCOPED_PHONE)).accessToken;

    const today = toBusinessDate(new Date());
    const yearMonth = today.slice(0, 7);
    const pages: [string, string, string][] = [
      ["attendance list", ownerToken, "/attendance/entries?tab=ALL&pageSize=100"],
      ["attendance list (restricted member)", scopedToken, "/attendance/entries?tab=ALL&pageSize=100"],
      ["pending approvals", ownerToken, "/attendance-approvals/pending"],
      ["operations snapshot", ownerToken, "/operations/live"],
      ["operations snapshot (restricted member)", scopedToken, "/operations/live"],
      ["workers", ownerToken, "/workers"],
      ["workers (restricted member)", scopedToken, "/workers"],
      ["shifts", ownerToken, "/shifts"],
      ["time entries", ownerToken, "/time-entries"],
      ["forgotten stamps", ownerToken, "/forgotten-stamp-infractions"],
      ["members", ownerToken, "/memberships"],
      ["member access", ownerToken, "/memberships/access"],
      ["roles", ownerToken, "/roles"],
      ["emergency call-outs", ownerToken, "/emergency-callouts"],
      ["payroll dashboard", ownerToken, `/payroll-periods/${yearMonth}/dashboard`],
      ["notifications", ownerToken, "/notifications"],
    ];

    const measure = async () => {
      const counts: Record<string, number> = {};
      for (const [name, token, path] of pages) {
        const { queries, result } = await prisma.countQueries(() => get(token, path));
        expect({ name, status: result.status }).toEqual({ name, status: 200 });
        counts[name] = queries;
      }
      // The jobs: payroll calculation of the month, and an operational attendance report.
      const calculation = await prisma.countQueries(async () => {
        const runId = await app.get(PayrollCalculationService).requestCalculation(organizationId, yearMonth, { sub: owner.user.id } as never, uuidv7(), uuidv7());
        for (;;) {
          const run = await poller.payrollCalculationRun.findUniqueOrThrow({ where: { id: runId } });
          if (run.state === PayrollCalculationState.SUCCEEDED || run.state === PayrollCalculationState.FAILED) return run.state;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
      expect(calculation.result).toBe(PayrollCalculationState.SUCCEEDED);
      counts["payroll calculation (job)"] = calculation.queries;
      const report = await prisma.countQueries(async () => {
        const created = await request(http()).post("/api/v1/reports").set(auth(ownerToken)).set("Idempotency-Key", uuidv7()).send({ reportType: "OPERATIONAL_ATTENDANCE", filters: { fromDate: `${yearMonth}-01`, toDate: today } });
        expect(created.status).toBe(202);
        for (;;) {
          const row = await poller.generatedReport.findUniqueOrThrow({ where: { id: created.body.id } });
          if (row.status === ReportStatus.READY || row.status === ReportStatus.FAILED) return row.status;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      });
      expect(report.result).toBe(ReportStatus.READY);
      counts["operational report (job)"] = report.queries;
      return counts;
    };

    await grow(state, 0, 4);
    const small = await measure();
    await grow(state, 4, 40);
    const large = await measure();

    // eslint-disable-next-line no-console
    console.log(`SQL statements per page/job (4 workers -> 40 workers):\n${Object.keys(small).map((name) => `  ${name}: ${small[name]} -> ${large[name]}`).join("\n")}`);
    for (const name of Object.keys(small)) {
      // A fixed set of queries: at most a couple more when a list has rows to look up (a user lookup, a group-by), never one per row.
      expect({ name, grew: large[name] - small[name] <= 2 }).toEqual({ name, grew: true });
    }
  });
});
