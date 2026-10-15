import { createHash } from "node:crypto";
import { get as httpGet, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA, SSE_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { io, type Socket } from "socket.io-client";
import { v7 as uuidv7 } from "uuid";
import { ALL_PERMISSIONS, CorrectionReason, FileAssetPurpose, isFinancialPermission, GovernmentIdType, NotificationType, PRIVACY_NOTICE_VERSION, TuranType } from "@fieldmaster/shared-types";
import { createTestApp, resetDatabase, request } from "./test-app";
import { useEnv } from "./use-env";
import {
  addFieldManager,
  addWorker,
  assignWorkerToShift,
  createOrgWithOwner,
  createProject,
  createSiteWithGeofence,
  createStandardShift,
} from "./fixtures";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { EncryptionService } from "../src/common/encryption/encryption.service";
import { NotificationsService } from "../src/modules/notifications/notifications.service";
import { calculatePayroll } from "./payroll-helpers";

/**
 * Financial leak scanner (spec sections 6.2 / 23.5).
 *
 * Signs in (dev login) as a Field Manager, a Worker and a Temporary
 * Supervisor (a worker with an active assignment, Step 6), calls every GET
 * route the app exposes -- discovered from Nest's route metadata, so a new
 * route is scanned without anyone adding it here -- and fails with the route
 * and JSON path of every money, bank or identity-document key in any
 * response. Since Step 8 it also searches every response for the actual
 * values of the seeded ID numbers, bank details and invitation tokens (in any
 * string, under any key) and reports where they are -- the paths only, never
 * the values. The notification WebSocket and SSE payloads a Field Manager
 * receives are scanned the same way.
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";
const OTHER_WORKER_PHONE = "+972500010002";
const SUPERVISOR_PHONE = "+972500010003";
// Flexible organization model: custom roles with and without the financial permissions, and one restricted to another project.
const CUSTOM_NO_MONEY_PHONE = "+972500020101";
const CUSTOM_MONEY_PHONE = "+972500020102";
const CUSTOM_SCOPED_PHONE = "+972500020103";

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center: inside the 100 m geofence.
const NEARBY_LAT = 32.0858;

const PROJECT_BUDGET_AGOROT = 50_000_000;

/** Step 8: the Worker's identity document and bank account (an Owner-only review shows them decrypted). */
const WORKER_ID_NUMBER = "203398789";
const WORKER_BANK = { bankName: "Bank Hapoalim", branch: "612", account: "4512345901", holder: "Nadia Worker-Holder" };
/** Step 8: a pending applicant who applied on the public onboarding page with a Palestinian ID. */
const APPLICANT_PHONE = "+972599876500";
const APPLICANT_ID_NUMBER = "412345678";
const APPLICANT_BANK = { bankName: "Bank of Palestine", branch: "155", account: "5528301146", holder: "Huda Applicant-Holder" };
/** The prefilled phone of the invitation nobody has used yet (the public page's GET route reads it). */
const OPEN_INVITATION_PHONE = "+972599000111";

/**
 * A key is forbidden if it ends in "Agorot" or "rate" (rate, hourlyRate,
 * dailyRate, overtimeRate, ...) or contains one of these words, case-insensitively
 * (Step 8: also identity-document numbers and account holders).
 */
const FORBIDDEN_KEY_PARTS = ["budget", "bank", "accountnumber", "branch", "netpay", "grosspay", "estimatedcost", "amount", "idnumber", "accountholder"];

function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.endsWith("agorot") || lower.endsWith("rate") || FORBIDDEN_KEY_PARTS.some((part) => lower.includes(part));
}

/** JSON paths (e.g. `$[0].project.budgetAgorot`) of every forbidden key in `value`, at any depth. */
function findForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(isForbiddenKey(key) ? [`${path}.${key}`] : []),
    ...findForbiddenKeys(nested, `${path}.${key}`),
  ]);
}

/**
 * JSON paths of every string in `value` that contains one of `sensitiveValues`
 * (an ID number, an account number, a token...), whatever its key: a value
 * copied into a free-text field (a notification body, an audit summary) is
 * found too. Only the paths are returned, so a failure never prints the values.
 */
function findSensitiveValues(value: unknown, sensitiveValues: readonly string[], path = "$"): string[] {
  if (typeof value === "string") return sensitiveValues.some((sensitive) => value.includes(sensitive)) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findSensitiveValues(item, sensitiveValues, `${path}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => findSensitiveValues(nested, sensitiveValues, `${path}.${key}`));
}

/** An account number as it may be written with its branch. */
function bankAccountForms(bank: { branch: string; account: string }): string[] {
  return [bank.account, ...["", "-", "/", " "].map((separator) => `${bank.branch}${separator}${bank.account}`)];
}

/**
 * The only routes where a Worker legitimately receives money: their OWN. They
 * are skipped by the key scan (still searched for ID numbers and bank details)
 * and checked separately below to contain only the caller's own data.
 */
const WORKER_OWN_MONEY_ROUTES = new Set([
  // The Worker's own rate history; any other worker's id is 403.
  "GET /api/v1/workers/:id/compensation-profiles",
  // The Worker's own payslip; the route takes no worker id at all.
  "GET /api/v1/payroll-periods/:yearMonth/my-payslip",
  // Step 7: the Worker's own salary statements (finalized versions + a labeled estimate); no worker id either.
  "GET /api/v1/payroll-statements/me",
  // Step 9 (mobile app): the open month's labeled estimate (no worker id), and the pay of one of the caller's own
  // approved entries (anyone else's entry is 404).
  "GET /api/v1/payroll-statements/me/current",
  "GET /api/v1/time-entries/:id/my-pay",
]);

/**
 * Routes allowed to answer something other than 200 or 403 for a role. Any
 * other status means the scan did not really read the route (a wrong seeded
 * id, a crash), so the test fails instead of passing on an error body.
 */
const EXPECTED_NOT_FOUND = {
  // A Field Manager who is not time-trackable has no worker profile, so no payslip.
  // A temporary supervisor assignment exists only for its own supervisor: everyone else gets 404.
  // The same for their own salary statements (Step 7).
  manager: new Set([
    "GET /api/v1/payroll-periods/:yearMonth/my-payslip",
    "GET /api/v1/payroll-statements/me",
    "GET /api/v1/temporary-supervisors/:assignmentId/shift",
    // Step 9: the Worker-own pay routes (no worker profile; the seeded entry is the Worker's, not theirs).
    "GET /api/v1/payroll-statements/me/current",
    "GET /api/v1/time-entries/:id/my-pay",
  ]),
  // Mobile manager mode: a notification subject exists only for members who may open its screen.
  worker: new Set(["GET /api/v1/temporary-supervisors/:assignmentId/shift", "GET /api/v1/notification-subjects/:id"]),
  // A custom role is a member without a worker profile, like the Field Manager: the same routes answer 404.
  custom: new Set([
    "GET /api/v1/payroll-periods/:yearMonth/my-payslip",
    "GET /api/v1/payroll-statements/me",
    "GET /api/v1/temporary-supervisors/:assignmentId/shift",
    "GET /api/v1/payroll-statements/me/current",
    "GET /api/v1/time-entries/:id/my-pay",
    // A report is seen by whoever may generate the financial reports, the worker it is about and its requester
    // (the manager): for a custom role that is none of those it does not exist.
    "GET /api/v1/reports/:id",
    "GET /api/v1/reports/:id/download",
    "GET /api/v1/reports/:id/verify",
  ]),
  // Step 8: a report is seen by an Owner, its requester and the worker it is about (the Worker above); for anyone
  // else it does not exist, so nothing tells it exists.
  supervisor: new Set([
    "GET /api/v1/reports/:id",
    "GET /api/v1/reports/:id/download",
    "GET /api/v1/reports/:id/verify",
    // Step 9: another worker's time entry does not exist for them (it was 403).
    "GET /api/v1/time-entries/:id",
    "GET /api/v1/notification-subjects/:id",
  ]),
};

/** Routes that answer only with query parameters, and what the scan sends them. */
const ROUTE_QUERIES: Record<string, () => string> = {
  // Mobile manager mode: the workers a new shift could have (one starting in two hours).
  "GET /api/v1/shifts/assignable-workers": () =>
    `?start=${encodeURIComponent(new Date(Date.now() + 2 * 3_600_000).toISOString())}&end=${encodeURIComponent(new Date(Date.now() + 10 * 3_600_000).toISOString())}`,
};

interface GetRoute {
  /** e.g. "GET /api/v1/shifts/:id" */
  route: string;
  /** The template with real seeded ids filled in. */
  path: string;
}

/** Every GET route (SSE excluded: it is scanned as a stream below), with path params filled from `idsByResource`. */
function discoverGetRoutes(app: INestApplication, idsByResource: Record<string, string>): GetRoute[] {
  const routes: GetRoute[] = [];
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
      if (!controller) continue;
      const basePath = String(Reflect.getMetadata(PATH_METADATA, controller) ?? "");
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") continue;
        const handler = controller.prototype[name];
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler);
        if (methodPath === undefined) continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) continue;
        if (Reflect.getMetadata(SSE_METADATA, handler)) continue;
        const segments = [basePath, String(methodPath)].flatMap((part) => part.split("/")).filter(Boolean);
        const template = `/api/v1/${segments.join("/")}`;
        // A path param is filled with the seeded id of the resource named by the segment before it
        // (`shifts/:id` -> a shift id); `:yearMonth` with the seeded payroll month.
        const filled = segments.map((segment, index) => {
          if (!segment.startsWith(":")) return segment;
          const resource = segment === ":yearMonth" ? ":yearMonth" : segments[index - 1];
          const id = idsByResource[resource];
          if (!id) throw new Error(`No seeded id for ${segment} in GET ${template}: add one for "${resource}" to the scanner's seed.`);
          return id;
        });
        routes.push({ route: `GET ${template}`, path: `/api/v1/${filled.join("/")}${ROUTE_QUERIES[`GET ${template}`]?.() ?? ""}` });
      }
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

describe("Financial leak scanner (dev login, every GET route)", () => {
  useEnv({
    APP_ENV: "development",
    DEV_LOGIN_ENABLED: "true",
    OTP_PROVIDER: undefined,
    // Download links are presigned locally; dummy credentials keep the SDK from looking for real ones.
    S3_ACCESS_KEY_ID: "scanner-test",
    S3_SECRET_ACCESS_KEY: "scanner-test",
  });

  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let seed: Awaited<ReturnType<typeof seedOrganization>>;

  async function devLogin(membershipId: string): Promise<string> {
    const response = await request(app.getHttpServer()).post("/api/v1/auth/dev/login").send({ membershipId }).expect(201);
    return response.body.accessToken;
  }

  function clockEvent(accessToken: string, kind: "clock-in" | "clock-out", body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/api/v1/clock-events/${kind}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", uuidv7())
      .send({ clientEventId: uuidv7(), deviceTimestamp: new Date().toISOString(), latitude: NEARBY_LAT, longitude: SITE_LNG, accuracyMeters: 10, ...body });
  }

  /**
   * Money in every place the API stores it: a project budget, compensation
   * profiles, forgotten-stamp deductions, a calculated payroll with a penalty
   * adjustment, and clock-out notifications whose Owner copy has a cost.
   */
  async function seedOrganization() {
    await resetDatabase(app);
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker", {
      type: "DAILY",
      dailyRateAgorot: 40_000,
      overtimeRateAgorot: 6_000,
    });
    const otherWorker = await addWorker(prisma, organizationId, OTHER_WORKER_PHONE, "Rami Worker", {
      type: "HOURLY",
      hourlyRateAgorot: 5_000,
      overtimeRateAgorot: 7_500,
    });
    const supervisor = await addWorker(prisma, organizationId, SUPERVISOR_PHONE, "Sami Supervisor", {
      type: "HOURLY",
      hourlyRateAgorot: 6_000,
      overtimeRateAgorot: 9_000,
    });

    const project = await createProject(prisma, organizationId);
    await prisma.project.update({ where: { id: project.id }, data: { budgetAgorot: PROJECT_BUDGET_AGOROT } });
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const shiftStart = new Date(Date.now() - 60 * 60_000);
    const shiftEnd = new Date(Date.now() + 8 * 60 * 60_000);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, shiftStart, shiftEnd);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shift.id, otherWorker.workerProfile.id, manager.user.id);
    await assignWorkerToShift(prisma, shift.id, supervisor.workerProfile.id, manager.user.id);

    const ownerToken = await devLogin(owner.membership.id);
    const managerToken = await devLogin(manager.membership.id);

    // Flexible organization model: three custom roles, made the way an Owner makes them (the API), and a member of each.
    const nonFinancialPermissions = ALL_PERMISSIONS.filter((permission) => !isFinancialPermission(permission));
    const createRole = async (name: string, permissions: string[]) =>
      (await request(app.getHttpServer()).post("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`).send({ name, permissions }).expect(201)).body.id as string;
    const noMoneyRoleId = await createRole("Everything but money", nonFinancialPermissions);
    const moneyRoleId = await createRole("Accountant", [...ALL_PERMISSIONS.filter((permission) => isFinancialPermission(permission)), "VIEW_ATTENDANCE", "VIEW_SHIFTS", "VIEW_ORG_SETTINGS", "GENERATE_OPERATIONAL_REPORTS"]);
    const scopedRoleId = await createRole("Project manager", nonFinancialPermissions.filter((permission) => permission !== "MANAGE_ROLES"));
    const addCustomMember = async (phoneNumber: string, fullLegalName: string, roleId: string) =>
      (await request(app.getHttpServer()).post("/api/v1/memberships").set("Authorization", `Bearer ${ownerToken}`).send({ phoneNumber, fullLegalName, roleId }).expect(201)).body.id as string;
    const customNoMoneyMembershipId = await addCustomMember(CUSTOM_NO_MONEY_PHONE, "Noa NoMoney", noMoneyRoleId);
    const customMoneyMembershipId = await addCustomMember(CUSTOM_MONEY_PHONE, "Maya Money", moneyRoleId);
    const customScopedMembershipId = await addCustomMember(CUSTOM_SCOPED_PHONE, "Sara Scoped", scopedRoleId);
    // The scoped member works with ANOTHER project than the one all the seeded data is in.
    const otherProject = await createProject(prisma, organizationId, "PRJ-OTHER");
    await request(app.getHttpServer())
      .patch(`/api/v1/memberships/${customScopedMembershipId}/scope`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ restricted: true, projectIds: [otherProject.id], reason: "Runs the other project" })
      .expect(200);
    const customNoMoneyToken = await devLogin(customNoMoneyMembershipId);
    const customMoneyToken = await devLogin(customMoneyMembershipId);
    const customScopedToken = await devLogin(customScopedMembershipId);
    const workerToken = await devLogin(worker.membership.id);
    const otherWorkerToken = await devLogin(otherWorker.membership.id);
    const supervisorToken = await devLogin(supervisor.membership.id);
    const http = app.getHttpServer();

    // Step 6: a temporary supervisor of the shift (assigned by the manager), who opens a temporary point.
    const supervision = await request(http)
      .post(`/api/v1/shifts/${shift.id}/temporary-supervisors`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ workerProfileId: supervisor.workerProfile.id, canOpenCheckInPoints: true })
      .expect(201);
    await request(http)
      .post("/api/v1/shifts/temporary-check-in-points")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ shiftId: shift.id, name: "North gate", latitude: NEARBY_LAT, longitude: SITE_LNG })
      .expect(201);

    // The Worker's day, through the real endpoints: clock in, clock out (notifies the manager and the Owner).
    await clockEvent(workerToken, "clock-in", { shiftId: shift.id, deviceId: "scanner-worker-device" }).expect(201);
    const clockOut = await clockEvent(workerToken, "clock-out", {
      deviceId: "scanner-worker-device",
      summaryText: "Set up the lane closure and directed traffic.",
      taskCategory: "TRAFFIC_CONTROL",
    }).expect(201);
    const timeEntryId: string = clockOut.body.id;

    // Three forgotten clock-ins this month: the third one deducts money.
    const nineHoursBeforeClockOut = new Date(new Date(clockOut.body.clockOutAt).getTime() - 9 * 60 * 60_000).toISOString();
    for (let i = 0; i < 3; i++) {
      await request(http)
        .post("/api/v1/manual-corrections")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ timeEntryId, field: "CLOCK_IN", newValue: nineHoursBeforeClockOut, reason: CorrectionReason.FORGOTTEN_CLOCK_IN })
        .expect(201);
    }
    await request(http).post(`/api/v1/time-entries/${timeEntryId}/approve`).set("Authorization", `Bearer ${managerToken}`).send({}).expect(201);

    const yearMonth: string = clockOut.body.businessDate.slice(0, 7);
    // Step 7: the calculation is a background job; the month is then finalized, so the Worker's own pay
    // (payslip, salary statements) exists -- they only ever come from finalized versions.
    await calculatePayroll(app, ownerToken, yearMonth);
    await request(http).post(`/api/v1/payroll-periods/${yearMonth}/finalize`).set("Authorization", `Bearer ${ownerToken}`).expect(201);

    await request(http)
      .post("/api/v1/turan-assignments")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        turanType: TuranType.NIGHT_TURAN,
        startAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
        endAt: new Date(Date.now() + 36 * 60 * 60_000).toISOString(),
        assignedWorkerProfileId: worker.workerProfile.id,
      })
      .expect(201);

    // An emergency call-out (manager-authorized, then ended by the worker): its Owner DTO carries a cost estimate.
    const calloutStart = await request(http)
      .post("/api/v1/emergency-callouts/start")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", uuidv7())
      .send({
        workerProfileId: worker.workerProfile.id,
        deviceId: "scanner-manager-device",
        clientEventId: uuidv7(),
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
      })
      .expect(201);
    await request(http)
      .post("/api/v1/emergency-callouts/end")
      .set("Authorization", `Bearer ${workerToken}`)
      .set("Idempotency-Key", uuidv7())
      .send({
        deviceId: "scanner-worker-device",
        clientEventId: uuidv7(),
        deviceTimestamp: new Date().toISOString(),
        latitude: NEARBY_LAT,
        longitude: SITE_LNG,
        accuracyMeters: 10,
        summaryText: "Restored the failed traffic light.",
        taskCategory: "EMERGENCY_REPAIR",
      })
      .expect(201);
    const calloutId: string = calloutStart.body.calloutId;

    // Mobile manager mode: the supervisor's report (resolved from the phone) and a photo of the entry (opened one at a time).
    await request(http)
      .post(`/api/v1/temporary-supervisors/${supervision.body.id}/report-issue`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ text: "The arrow board battery is flat." })
      .expect(201);
    const issue = await prisma.supervisorIssueReport.findFirstOrThrow({ where: { organizationId } });
    const subject = await prisma.notificationSubject.findFirstOrThrow({ where: { organizationId, kind: "ATTENDANCE", refId: timeEntryId } });
    const entryPhoto = await prisma.fileAsset.create({
      data: {
        id: uuidv7(),
        organizationId,
        purpose: FileAssetPurpose.ATTENDANCE_PHOTO,
        storageKey: `attendance/${organizationId}/scanner/${uuidv7()}`,
        contentType: "image/jpeg",
        sizeBytes: 1024,
        sha256: "0".repeat(64),
        scanResult: "CLEAN",
        timeEntryId,
        workerProfileId: worker.workerProfile.id,
      },
    });

    const batch = await prisma.offlineSyncBatch.create({
      data: { id: uuidv7(), organizationId, workerProfileId: worker.workerProfile.id, deviceId: "scanner-worker-device", eventCount: 0 },
    });
    const report = await prisma.generatedReport.create({
      data: {
        id: uuidv7(),
        organizationId,
        reportType: "WORKER_ATTENDANCE_LEDGER",
        requestedByUserId: manager.user.id,
        subjectWorkerProfileId: worker.workerProfile.id,
        filtersJson: { fromDate: `${yearMonth}-01`, toDate: `${yearMonth}-28` },
        includesFinancials: false,
        templateVersion: "worker-attendance-ledger-v1",
        sha256Hash: "0".repeat(64),
        storageKey: `reports/${organizationId}/scanner.pdf`,
      },
    });

    // Step 8: identity documents and bank details, encrypted the way onboarding stores them.
    // The Worker's: the Owner's review (`/workers/:id/onboarding-review`) shows them decrypted.
    const encryption = app.get(EncryptionService);
    // Object storage is not reached (dummy credentials), so the file rows are created directly; no route reads the bytes.
    const fileAssetRow = (purpose: FileAssetPurpose, links: { workerProfileId?: string; invitationId?: string }) =>
      prisma.fileAsset.create({
        data: {
          id: uuidv7(),
          organizationId,
          purpose,
          storageKey: `onboarding/${organizationId}/scanner/${uuidv7()}`,
          contentType: "image/jpeg",
          sizeBytes: 1024,
          sha256: "0".repeat(64),
          scanResult: "NOT_SCANNED",
          ...links,
        },
      });
    const workerIdDocument = await fileAssetRow(FileAssetPurpose.IDENTITY_DOCUMENT, { workerProfileId: worker.workerProfile.id });
    await prisma.identityDocument.create({
      data: {
        id: uuidv7(),
        workerProfileId: worker.workerProfile.id,
        documentType: GovernmentIdType.ISRAELI_ID,
        ...(await encryption.encrypt(WORKER_ID_NUMBER)),
        fileAssetId: workerIdDocument.id,
      },
    });
    await prisma.encryptedBankAccount.create({
      data: {
        id: uuidv7(),
        workerProfileId: worker.workerProfile.id,
        ...(await encryption.encrypt(
          JSON.stringify({ bankName: WORKER_BANK.bankName, branchNumber: WORKER_BANK.branch, accountNumber: WORKER_BANK.account, accountHolderName: WORKER_BANK.holder }),
        )),
      },
    });

    // A pending applicant, through the real public application route. Field Managers get application notifications too,
    // so theirs are scanned with one in them.
    await request(http)
      .patch("/api/v1/organizations/me/settings/notifications")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ preferences: [{ type: NotificationType.ONBOARDING_SUBMITTED, owners: true, fieldManagers: true }] })
      .expect(200);
    const usedInvitation = await request(http).post("/api/v1/onboarding-invitations").set("Authorization", `Bearer ${ownerToken}`).send({}).expect(201);
    const applicantDocument = await fileAssetRow(FileAssetPurpose.IDENTITY_DOCUMENT, { invitationId: usedInvitation.body.invitationId });
    await request(http)
      .post(`/api/v1/onboarding/invitations/${usedInvitation.body.token}/redeem`)
      .send({
        phoneNumber: APPLICANT_PHONE,
        fullLegalName: "Lina Applicant",
        governmentIdType: GovernmentIdType.PALESTINIAN_ID,
        governmentIdNumber: APPLICANT_ID_NUMBER,
        identityDocumentAssetId: applicantDocument.id,
        bankName: APPLICANT_BANK.bankName,
        branchNumber: APPLICANT_BANK.branch,
        accountNumber: APPLICANT_BANK.account,
        accountHolderName: APPLICANT_BANK.holder,
        consentAccepted: true,
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      })
      .expect(201);
    const applicant = await prisma.workerProfile.findFirstOrThrow({ where: { organizationId, membership: { user: { phoneNumber: APPLICANT_PHONE } } } });
    // An invitation nobody has used yet: the public page's GET route reads it.
    const openInvitation = await request(http)
      .post("/api/v1/onboarding-invitations")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ prefilledPhoneNumber: OPEN_INVITATION_PHONE })
      .expect(201);
    const invitationTokens: string[] = [usedInvitation.body.token, openInvitation.body.token];

    return {
      owner,
      manager,
      worker,
      otherWorker,
      shift,
      yearMonth,
      timeEntryId,
      calloutId,
      applicantWorkerProfileId: applicant.id,
      supervisorWorkerProfileId: supervisor.workerProfile.id,
      supervisionId: supervision.body.id as string,
      tokens: {
        owner: ownerToken,
        manager: managerToken,
        worker: workerToken,
        otherWorker: otherWorkerToken,
        supervisor: supervisorToken,
        customNoMoney: customNoMoneyToken,
        customMoney: customMoneyToken,
        customScoped: customScopedToken,
      },
      /** What only the Owner's review may show: ID numbers, account numbers and holders, invitation tokens and their hashes. */
      sensitiveValues: [
        WORKER_ID_NUMBER,
        ...bankAccountForms(WORKER_BANK),
        WORKER_BANK.holder,
        APPLICANT_ID_NUMBER,
        ...bankAccountForms(APPLICANT_BANK),
        APPLICANT_BANK.holder,
        ...invitationTokens,
        ...invitationTokens.map((token) => createHash("sha256").update(token).digest("hex")),
      ],
      idsByResource: {
        shifts: shift.id,
        "time-entries": timeEntryId,
        projects: project.id,
        sites: site.id,
        batches: batch.id,
        workers: worker.workerProfile.id,
        reports: report.id,
        "emergency-callouts": calloutId,
        memberships: worker.membership.id,
        roles: noMoneyRoleId,
        "temporary-supervisors": supervision.body.id as string,
        // Step 7: `/payroll-periods/:yearMonth/versions/:version` (and its `workers/:workerProfileId`, filled with the Worker above).
        versions: "1",
        ":yearMonth": yearMonth,
        // Step 8: the public page reads `/onboarding/invitations/:token`; the Owner views the Worker's ID document.
        invitations: openInvitation.body.token as string,
        "file-assets": workerIdDocument.id,
        // Mobile manager mode.
        "notification-subjects": subject.id,
        "supervisor-issues": issue.id,
        "work-locations": site.id,
        photos: entryPhoto.id,
      },
    };
  }

  /**
   * Calls every GET route as `accessToken`; returns each leaked key as "GET /route -> $.json.path", and each place a
   * sensitive value (ID number, bank detail, invitation token) was found the same way. `moneyExceptions` (a Worker's
   * own pay) are only searched for the sensitive values: the money in them is the caller's own.
   */
  async function scanGetRoutes(accessToken: string, role: "manager" | "worker" | "supervisor" | "custom", moneyExceptions: Set<string>, anyNotFound = false) {
    const leaks: string[] = [];
    const sensitiveValues: string[] = [];
    const unexpectedStatuses: string[] = [];
    const bodies = new Map<string, unknown>();
    for (const { route, path } of discoverGetRoutes(app, seed.idsByResource)) {
      const response = await request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${accessToken}`);
      for (const jsonPath of findSensitiveValues(response.body, seed.sensitiveValues)) sensitiveValues.push(`${route} -> ${jsonPath}`);
      if (moneyExceptions.has(route)) continue;
      const allowed = response.status === 200 || response.status === 403 || (response.status === 404 && (anyNotFound || EXPECTED_NOT_FOUND[role].has(route)));
      if (!allowed) unexpectedStatuses.push(`${route} -> ${response.status} ${JSON.stringify(response.body)}`);
      if (response.status === 200) bodies.set(route, response.body);
      for (const jsonPath of findForbiddenKeys(response.body)) leaks.push(`${route} -> ${jsonPath}`);
    }
    return { leaks, sensitiveValues, unexpectedStatuses, bodies };
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    seed = await seedOrganization();
  });

  afterAll(async () => {
    await app.close();
  });

  it("finds money where it is stored (so an empty result below means no leak, not no data)", async () => {
    const { leaks, sensitiveValues } = await scanGetRoutes(seed.tokens.owner, "manager", new Set());
    const ownerLeaks = leaks.join("\n");
    // Step 8: the Owner's review of an application, decrypted -- found by key and by value...
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/workers\/:id\/onboarding-review -> \$\.governmentIdNumber$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/workers\/:id\/onboarding-review -> \$\.bankAccount\.accountHolderName$/m);
    expect(sensitiveValues).toEqual(
      expect.arrayContaining([
        "GET /api/v1/workers/:id/onboarding-review -> $.governmentIdNumber",
        "GET /api/v1/workers/:id/onboarding-review -> $.bankAccount.accountNumber",
        "GET /api/v1/workers/:id/onboarding-review -> $.bankAccount.accountHolderName",
      ]),
    );
    // ... and nowhere else, not even in the Owner's other responses.
    expect(sensitiveValues.filter((found) => !found.startsWith("GET /api/v1/workers/:id/onboarding-review -> "))).toEqual([]);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/projects -> \$\[0\]\.budgetAgorot$/m);
    // Any index: the seeded emergency call-out's own shift (no project) now sorts first.
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/shifts -> \$\[\d+\]\.project\.budgetAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/workers -> \$\[\d+\]\.compensation\.dailyBaseRateAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/forgotten-stamp-infractions -> \$\[\d+\]\.deductionAgorot$/m);
    // Step 7: payroll versions, the worker drill-down and the dashboard (the version's workers replaced `items`).
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/payroll-periods -> \$\[0\]\.netPayableAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/payroll-periods\/:yearMonth -> \$\.workers\[\d+\]\.netPayableAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/payroll-periods\/:yearMonth\/versions -> \$\[0\]\.netPayableAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/payroll-periods\/:yearMonth\/versions\/:version -> \$\.totals\.netPayableAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/payroll-periods\/:yearMonth\/versions\/:version\/workers\/:workerProfileId -> \$\.entries\[0\]\.totalAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/payroll-periods\/:yearMonth\/dashboard -> \$\.costByWorker\[0\]\.netPayableAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/notifications -> \$\[\d+\]\.dataJson\.estimatedCostAgorot$/m);
    // Step 5: the Owner-only cost responses and the Owner's emergency call-out DTO.
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/time-entries\/:id\/estimated-cost -> \$\.estimatedCostAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/workers\/:id\/estimated-earnings -> \$\.totalEstimatedAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/emergency-callouts -> \$\.items\[0\]\.estimatedCostAgorot$/m);
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/emergency-callouts\/:id -> \$\.estimatedCostAgorot$/m);
    // Step 6: the settings' fixed rules carry the forgotten-stamp penalty amount for an Owner only.
    expect(ownerLeaks).toMatch(/^GET \/api\/v1\/organizations\/me\/settings -> \$\.fixedRules\.forgottenStampPenaltyAgorot$/m);
  });

  /** The routes were really read as this role, with rows in them (an empty list would scan clean). */
  function expectRows(bodies: Map<string, unknown>, routes: string[]) {
    for (const route of routes) {
      const body = bodies.get(route);
      expect({ route, rows: Array.isArray(body) ? body.length > 0 : body }).toEqual({ route, rows: true });
    }
  }

  it("a Field Manager gets no money, bank or ID-document field or value from any GET route", async () => {
    const { leaks, sensitiveValues, unexpectedStatuses, bodies } = await scanGetRoutes(seed.tokens.manager, "manager", new Set());
    expect({ leaks, sensitiveValues, unexpectedStatuses }).toEqual({ leaks: [], sensitiveValues: [], unexpectedStatuses: [] });

    expectRows(bodies, ["GET /api/v1/shifts", "GET /api/v1/forgotten-stamp-infractions", "GET /api/v1/projects", "GET /api/v1/workers", "GET /api/v1/notifications"]);
    // Step 8: the onboarding routes were read with the applicant in them (so the value search had something to look at).
    expectRows(bodies, ["GET /api/v1/onboarding-invitations", "GET /api/v1/workers/pending-approval"]);
    expect(bodies.get("GET /api/v1/workers/pending-approval")).toContainEqual(expect.objectContaining({ workerProfileId: seed.applicantWorkerProfileId }));
    expect(bodies.get("GET /api/v1/notifications")).toContainEqual(
      expect.objectContaining({ type: NotificationType.ONBOARDING_SUBMITTED, dataJson: expect.objectContaining({ workerProfileId: seed.applicantWorkerProfileId }) }),
    );
    expect(bodies.get("GET /api/v1/onboarding/invitations/:token")).toMatchObject({ prefilledPhoneNumber: OPEN_INVITATION_PHONE });
    expect(bodies.get("GET /api/v1/shifts/:id")).toMatchObject({ id: seed.shift.id, project: { name: "Test Project" } });
    // Step 5 routes were read with real rows (the evidence has corrections with forgotten-stamp infractions).
    expect(bodies.get("GET /api/v1/time-entries/:id/evidence")).toMatchObject({ id: seed.timeEntryId, history: { corrections: [{ infraction: { monthlySequenceNumber: 1 } }, {}, {}] } });
    expect(bodies.get("GET /api/v1/emergency-callouts")).toMatchObject({ items: [{ id: seed.calloutId }] });
    expect(bodies.get("GET /api/v1/emergency-callouts/:id")).toMatchObject({ id: seed.calloutId });
    expect((bodies.get("GET /api/v1/attendance/entries") as { items: unknown[] }).items.length).toBeGreaterThan(0);
    // Step 6 routes were read too: the live operations page and the settings (without the penalty amount).
    expect(bodies.get("GET /api/v1/operations/live")).toMatchObject({ temporaryPoints: [{ name: "North gate" }] });
    expect(bodies.get("GET /api/v1/organizations/me/settings")).toMatchObject({ canEdit: false, fixedRules: { standardDayMinutes: 540 } });
  });

  it("a Worker gets no money, bank or ID-document field or value from any GET route except their own pay (explicit exceptions)", async () => {
    const { leaks, sensitiveValues, unexpectedStatuses, bodies } = await scanGetRoutes(seed.tokens.worker, "worker", WORKER_OWN_MONEY_ROUTES);
    // Not even the Worker's own ID number or bank details: only the Owner's review shows them.
    expect({ leaks, sensitiveValues, unexpectedStatuses }).toEqual({ leaks: [], sensitiveValues: [], unexpectedStatuses: [] });

    expectRows(bodies, ["GET /api/v1/shifts", "GET /api/v1/time-entries", "GET /api/v1/notifications"]);
    expect(bodies.get("GET /api/v1/shifts/:id")).toMatchObject({ id: seed.shift.id, project: { name: "Test Project" } });

    // Step 9: the shift (list and detail) carries the Worker's own assignment only -- no co-worker's profile id, phone or name.
    expect(bodies.get("GET /api/v1/shifts/:id")).toMatchObject({ assignments: [{ workerProfileId: seed.worker.workerProfile.id }] });
    for (const route of ["GET /api/v1/shifts", "GET /api/v1/shifts/:id"]) {
      const json = JSON.stringify(bodies.get(route));
      for (const other of [seed.otherWorker.workerProfile.id, seed.supervisorWorkerProfileId, OTHER_WORKER_PHONE, SUPERVISOR_PHONE, "Rami Worker", "Sami Supervisor"]) {
        expect({ route, found: json.includes(other) ? other : null }).toEqual({ route, found: null });
      }
    }
  });

  it("a Temporary Supervisor gets no money, bank or ID-document field or value from any GET route, including the supervised shift", async () => {
    // Their own pay is the Worker's exception above, so it is skipped the same way.
    const { leaks, sensitiveValues, unexpectedStatuses, bodies } = await scanGetRoutes(seed.tokens.supervisor, "supervisor", WORKER_OWN_MONEY_ROUTES);
    expect({ leaks, sensitiveValues, unexpectedStatuses }).toEqual({ leaks: [], sensitiveValues: [], unexpectedStatuses: [] });

    // The supervisor routes were really read, with rows: the shift's three workers and the opened point.
    expectRows(bodies, ["GET /api/v1/temporary-supervisors/me"]);
    const view = bodies.get("GET /api/v1/temporary-supervisors/:assignmentId/shift") as { workers: unknown[]; temporaryCheckInPoints: unknown[] };
    expect(view.workers).toHaveLength(3);
    expect(view.temporaryCheckInPoints).toHaveLength(1);
  });

  it("a custom role holding every permission except the financial ones gets no money, bank or ID-document field or value from any GET route", async () => {
    const { leaks, sensitiveValues, unexpectedStatuses, bodies } = await scanGetRoutes(seed.tokens.customNoMoney, "custom", new Set());
    expect({ leaks, sensitiveValues, unexpectedStatuses }).toEqual({ leaks: [], sensitiveValues: [], unexpectedStatuses: [] });

    // The routes were really read as this role, with the same rows the Owner gets (so an empty scan means no leak, not no data).
    expectRows(bodies, ["GET /api/v1/shifts", "GET /api/v1/forgotten-stamp-infractions", "GET /api/v1/projects", "GET /api/v1/workers", "GET /api/v1/roles"]);
    expect(bodies.get("GET /api/v1/organizations/me/settings")).toMatchObject({ canEdit: true, fixedRules: { standardDayMinutes: 540 } });
    expect(JSON.stringify(bodies.get("GET /api/v1/organizations/me/settings"))).not.toMatch(/penalty/i);
    // The audit log has the money rows (a forgotten-stamp deduction), their amounts left out.
    const audit = bodies.get("GET /api/v1/audit-logs") as { items: { action: string; newValue: string | null; redacted?: boolean }[] };
    const deduction = audit.items.find((row) => row.action === "FORGOTTEN_STAMP_INFRACTION_RECORDED" && row.redacted);
    expect(deduction).toMatchObject({ newValue: null, redacted: true });
    // The money routes are refused outright.
    for (const route of ["/payroll-periods", `/payroll-periods/${seed.yearMonth}/dashboard`, `/time-entries/${seed.timeEntryId}/estimated-cost`, `/workers/${seed.worker.workerProfile.id}/onboarding-review`]) {
      await request(app.getHttpServer()).get(`/api/v1${route}`).set("Authorization", `Bearer ${seed.tokens.customNoMoney}`).expect(403);
    }
    // Nor may it add a financial permission to its own role or change what a rule's penalty is.
    const penalty = await request(app.getHttpServer())
      .post("/api/v1/organizations/me/work-rules")
      .set("Authorization", `Bearer ${seed.tokens.customNoMoney}`)
      .send({ effectiveFrom: "2099-01-01", reason: "Try", forgottenStampPenaltyAgorot: 5_000 })
      .expect(403);
    expect(penalty.body.code).toBe("FORBIDDEN");
    const rules = await request(app.getHttpServer()).get("/api/v1/organizations/me/work-rules").set("Authorization", `Bearer ${seed.tokens.customNoMoney}`).expect(200);
    expect(JSON.stringify(rules.body)).not.toMatch(/penalty/i);
  });

  it("a custom role WITH the financial permissions sees money (so the scans above mean something), and one restricted to another project sees none of this project's data", async () => {
    const { leaks, unexpectedStatuses } = await scanGetRoutes(seed.tokens.customMoney, "custom", new Set());
    expect(unexpectedStatuses).toEqual([]);
    const found = leaks.join("\n");
    expect(found).toMatch(/^GET \/api\/v1\/payroll-periods -> \$\[0\]\.netPayableAgorot$/m);
    expect(found).toMatch(/^GET \/api\/v1\/payroll-periods\/:yearMonth\/dashboard -> /m);
    expect(found).toMatch(/^GET \/api\/v1\/shifts -> \$\[\d+\]\.project\.budgetAgorot$/m);
    expect(found).toMatch(/^GET \/api\/v1\/organizations\/me\/settings -> \$\.fixedRules\.forgottenStampPenaltyAgorot$/m);

    // The restricted member (no money permission either): nothing of this project, and no money anywhere.
    const scoped = await scanGetRoutes(seed.tokens.customScoped, "custom", new Set(), true);
    expect({ leaks: scoped.leaks, sensitiveValues: scoped.sensitiveValues }).toEqual({ leaks: [], sensitiveValues: [] });
    expect(scoped.unexpectedStatuses).toEqual([]);
    for (const route of ["GET /api/v1/shifts", "GET /api/v1/workers", "GET /api/v1/attendance/entries", "GET /api/v1/emergency-callouts"]) {
      const body = scoped.bodies.get(route) as unknown[] | { items: unknown[] };
      expect({ route, rows: Array.isArray(body) ? body.length : body.items.length }).toEqual({ route, rows: 0 });
    }
  });

  it("the Worker's own-money exceptions only ever contain the Worker's own data", async () => {
    const http = app.getHttpServer();
    const workerProfileId = seed.worker.workerProfile.id;
    const auth = `Bearer ${seed.tokens.worker}`;

    const ownProfiles = await request(http).get(`/api/v1/workers/${workerProfileId}/compensation-profiles`).set("Authorization", auth).expect(200);
    expect(ownProfiles.body.length).toBeGreaterThan(0);
    for (const profile of ownProfiles.body) expect(profile.workerProfileId).toBe(workerProfileId);
    await request(http).get(`/api/v1/workers/${seed.otherWorker.workerProfile.id}/compensation-profiles`).set("Authorization", auth).expect(403);

    const payslip = await request(http).get(`/api/v1/payroll-periods/${seed.yearMonth}/my-payslip`).set("Authorization", auth).expect(200);
    expect(payslip.body.workerProfileId).toBe(workerProfileId);
    expect(payslip.body.periodStatus).toBe("FINALIZED");
    expect(payslip.body.adjustments.length).toBeGreaterThan(0);
    for (const adjustment of payslip.body.adjustments) expect(adjustment.workerProfileId).toBe(workerProfileId);
    // Every row the payslip came from belongs to the Worker.
    const itemIds = new Set((await prisma.payrollItem.findMany({ where: { workerProfileId } })).map((item) => item.id));
    expect(itemIds.has(payslip.body.id)).toBe(true);

    // Step 7: salary statements -- the Worker's item of the finalized month, and nothing of anyone else.
    const own = await request(http).get("/api/v1/payroll-statements/me").set("Authorization", auth).expect(200);
    const ownItem = await prisma.payrollItem.findUniqueOrThrow({ where: { id: payslip.body.id } });
    expect(own.body.statements).toEqual([expect.objectContaining({ yearMonth: seed.yearMonth, status: "FINALIZED", isEstimate: false, netPayableAgorot: ownItem.netPayableAgorot })]);
    for (const estimate of own.body.estimates) expect(estimate).toMatchObject({ status: "DRAFT", isEstimate: true, version: null });
    const others = await prisma.workerProfile.findMany({ where: { organizationId: seed.owner.org.id, id: { not: workerProfileId } }, select: { id: true } });
    const ownJson = JSON.stringify(own.body);
    for (const other of others) expect(ownJson).not.toContain(other.id);
    // The same month as the other Worker (no pay in it): no statement at all, so the route never falls back to someone else's item.
    const otherStatements = await request(http).get("/api/v1/payroll-statements/me").set("Authorization", `Bearer ${seed.tokens.otherWorker}`).expect(200);
    expect(otherStatements.body.statements).toEqual([]);
    expect(JSON.stringify(otherStatements.body)).not.toContain(workerProfileId);

    // Step 9: the pay of one entry -- the Worker's own entry only; for the other Worker it does not exist.
    const ownPay = await request(http).get(`/api/v1/time-entries/${seed.timeEntryId}/my-pay`).set("Authorization", auth).expect(200);
    expect(ownPay.body).toMatchObject({ timeEntryId: seed.timeEntryId, approved: true });
    expect(ownPay.body.totalAgorot).toEqual(expect.any(Number));
    await request(http).get(`/api/v1/time-entries/${seed.timeEntryId}/my-pay`).set("Authorization", `Bearer ${seed.tokens.otherWorker}`).expect(404);
    // The open month's estimate takes no worker id: the scanner's month is finalized, so both Workers get the same 409
    // (the finalized figures are in /payroll-statements/me), never someone else's figures.
    for (const token of [seed.tokens.worker, seed.tokens.otherWorker]) {
      const current = await request(http).get("/api/v1/payroll-statements/me/current").set("Authorization", `Bearer ${token}`).expect(409);
      expect(current.body.code).toBe("PAYROLL_PERIOD_FINALIZED");
    }
  });

  it("a Field Manager's WebSocket and SSE notification payloads carry no money", async () => {
    const managerSocket = await connectNotificationsSocket(seed.tokens.manager);
    const ownerSocket = await connectNotificationsSocket(seed.tokens.owner);
    const managerSse = openSse(`/api/v1/notifications/stream?token=${encodeURIComponent(seed.tokens.manager)}`);
    try {
      await managerSse.ready;

      // A real flow whose Owner copy carries a cost: the other worker clocks in and out of the manager's shift.
      await clockEvent(seed.tokens.otherWorker, "clock-in", { shiftId: seed.shift.id, deviceId: "scanner-other-device" }).expect(201);
      await clockEvent(seed.tokens.otherWorker, "clock-out", {
        deviceId: "scanner-other-device",
        summaryText: "Replaced the damaged road signs.",
        taskCategory: "TRAFFIC_CONTROL",
      }).expect(201);
      // A call site that wrongly puts money in a Field Manager's data: the safety net must strip it on the wire too.
      await app.get(NotificationsService).notify({
        organizationId: seed.owner.org.id,
        recipientUserId: seed.manager.user.id,
        type: NotificationType.WORKER_CLOCKED_OUT,
        title: "Call-site mistake",
        body: "Carries money it must not.",
        data: { estimatedCostAgorot: 12_345, shiftId: seed.shift.id },
      });

      const isClockOut = (n: { type: string }) => n.type === NotificationType.WORKER_CLOCKED_OUT;
      await waitFor(() => managerSocket.received.filter(isClockOut).length >= 2 && managerSse.received.filter(isClockOut).length >= 2);
      await waitFor(() => ownerSocket.received.some(isClockOut));

      const leaks = [
        ...managerSocket.received.flatMap((payload, i) => findForbiddenKeys(payload, `ws[${i}]`)),
        ...managerSse.received.flatMap((payload, i) => findForbiddenKeys(payload, `sse[${i}]`)),
      ];
      expect(leaks).toEqual([]);
      // The same event does carry money for the Owner, so the scan above had something to catch.
      expect(findForbiddenKeys(ownerSocket.received.filter(isClockOut))).toContain("$[0].dataJson.estimatedCostAgorot");
    } finally {
      managerSocket.socket.disconnect();
      ownerSocket.socket.disconnect();
      managerSse.close();
    }
  });

  async function connectNotificationsSocket(accessToken: string) {
    const received: Array<{ type: string }> = [];
    const socket: Socket = io(`${baseUrl}/notifications`, { auth: { token: accessToken }, transports: ["websocket"], reconnection: false });
    socket.on("notification", (payload) => received.push(payload));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return { socket, received };
  }

  function openSse(path: string) {
    const received: Array<{ type: string }> = [];
    let response: IncomingMessage | undefined;
    let buffer = "";
    const req = httpGet(`${baseUrl}${path}`, { headers: { Accept: "text/event-stream" } });
    const ready = new Promise<void>((resolve, reject) => {
      req.on("response", (res) => {
        response = res;
        if (res.statusCode !== 200) return reject(new Error(`SSE answered ${res.statusCode}`));
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const data = event
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (data) received.push(JSON.parse(data));
          }
        });
        resolve();
      });
      req.on("error", reject);
    });
    return {
      ready,
      received,
      close: () => {
        response?.destroy();
        req.destroy();
      },
    };
  }

  async function waitFor(condition: () => boolean, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for notification payloads.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
});
