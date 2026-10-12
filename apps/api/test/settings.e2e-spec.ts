import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { NotificationType, ShiftType } from "@fieldmaster/shared-types";
import { canonicalizeOfflineEvent, generateOfflineSigningKeyPair, signOfflineEvent, type OfflineEventSignablePayload } from "@fieldmaster/shared-validation";
import { createTestApp, loginAs, request, resetDatabase } from "./test-app";
import { useEnv } from "./use-env";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";

/**
 * Step 6: organization settings. Owners and Field Managers read them (a Field
 * Manager's copy has no money and no edit rights); only an Owner changes them,
 * one section at a time, validated and audited old -> new per changed field.
 * Each setting is then what the API applies: read from the database on every
 * use, not a code constant or an environment variable.
 */

const SITE_LAT = 32.0853;
const SITE_LNG = 34.7818;
// ~55 m north of the site center: inside the 100 m geofence.
const NEARBY_LAT = 32.0858;

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const WORKER_PHONE = "+972500010001";

const SETTINGS = "/organizations/me/settings";
const OFFLINE_DEVICE = "settings-offline-device";

/** Every money key the financial leak scanner looks for, at any depth. */
const MONEY_KEY = /agorot|rate"|budget|bank|amount|estimatedcost|netpay|grosspay/i;

/** The workday defaults: the values the API hard-coded before Step 6. */
const DEFAULT_WORKDAY = {
  defaultGraceMinutes: 10,
  defaultGeofenceRadiusMeters: 100,
  defaultMinGpsAccuracyMeters: 50,
  deviceTimeDeviationSeconds: 120,
  temporaryPointRadiusMeters: 100,
  temporaryPointMinAccuracyMeters: 75,
  autoDeductUnpaidBreaks: false,
  timezone: "Asia/Jerusalem",
};

/** A configurable notification at its default: Owners always, Field Managers as they received it before the setting existed. */
const byDefault = (type: string, fieldManagerAudience: string, fieldManagers: boolean) => ({
  type,
  fieldManagerAudience,
  owners: true,
  fieldManagers,
  defaults: { owners: true, fieldManagers },
});

const DEFAULT_NOTIFICATIONS = [
  byDefault(NotificationType.WORKER_CLOCKED_IN, "SHIFT_MANAGER", true),
  byDefault(NotificationType.WORKER_CLOCKED_OUT, "SHIFT_MANAGER", true),
  byDefault(NotificationType.OVERTIME_THRESHOLD_CROSSED, "SHIFT_MANAGER", true),
  byDefault(NotificationType.TEMPORARY_SUPERVISOR_ISSUE_REPORTED, "SHIFT_MANAGER", true),
  byDefault(NotificationType.EMERGENCY_SHIFT_STARTED, "ALL_FIELD_MANAGERS", true),
  byDefault(NotificationType.EMERGENCY_SHIFT_ENDED, "ALL_FIELD_MANAGERS", true),
  byDefault(NotificationType.ONBOARDING_SUBMITTED, "ALL_FIELD_MANAGERS", false),
  byDefault(NotificationType.OFFLINE_EVENT_REJECTED, "ALL_FIELD_MANAGERS", false),
  byDefault(NotificationType.SUSPICIOUS_LOCATION_DETECTED, "ALL_FIELD_MANAGERS", false),
];

const testRandomBytes = (n: number) => new Uint8Array(randomBytes(n));
const secondsFromNow = (seconds: number) => new Date(Date.now() + seconds * 1_000).toISOString();

describe("Organization settings (Step 6)", () => {
  // A staging deployment with dev login off, so the read-only test-mode status shows the environment, not a constant.
  useEnv({ APP_ENV: "staging", DEV_LOGIN_ENABLED: "false" });

  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  const http = () => app.getHttpServer();
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    request(http()).post(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("Idempotency-Key", uuidv7()).send(body);
  const patch = (token: string, path: string, body: Record<string, unknown>) =>
    request(http()).patch(`/api/v1${path}`).set("Authorization", `Bearer ${token}`).send(body);

  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const worker = await addWorker(prisma, organizationId, WORKER_PHONE, "Eli Worker");
    const project = await createProject(prisma, organizationId);
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE_LAT, SITE_LNG, 100);
    const start = new Date(Date.now() - 60 * 60_000);
    const end = new Date(Date.now() + 8 * 60 * 60_000);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, start, end);
    await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);

    const tokens = {
      owner: (await loginAs(app, OWNER_PHONE)).accessToken,
      manager: (await loginAs(app, MANAGER_PHONE)).accessToken,
      worker: (await loginAs(app, WORKER_PHONE)).accessToken,
    };
    return { organizationId, owner, manager, worker, project, site, geofence, shift, start, end, tokens };
  }

  const editWorkday = (token: string, body: Record<string, unknown>) => patch(token, `${SETTINGS}/workday`, body);

  function clock(token: string, kind: "clock-in" | "clock-out", body: Record<string, unknown>) {
    return post(token, `/clock-events/${kind}`, {
      deviceId: "device-1",
      clientEventId: uuidv7(),
      deviceTimestamp: new Date().toISOString(),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
      ...body,
    });
  }

  const clockOutBody = { summaryText: "Closed the lane and directed traffic.", taskCategory: "TRAFFIC_CONTROL" };

  /** The audit rows one request wrote (matched by its correlation id), by field. */
  async function auditOf(response: Response) {
    const rows = await prisma.auditLog.findMany({ where: { correlationId: response.headers["x-correlation-id"] } });
    return rows.sort((a, b) => (a.field ?? "").localeCompare(b.field ?? ""));
  }

  it("an Owner reads the defaults with edit rights and the fixed rules; a Field Manager the same without money or edit rights; a Worker is refused", async () => {
    const ctx = await setup();

    const asOwner = await get(ctx.tokens.owner, SETTINGS).expect(200);
    expect(asOwner.body).toEqual({
      canEdit: true,
      workday: DEFAULT_WORKDAY,
      onboarding: { invitationTtlHours: 72 },
      notifications: DEFAULT_NOTIFICATIONS,
      // The deployment's own state, shown read-only.
      testMode: { appEnv: "staging", devLoginEnabled: false },
      // Fixed business rules: a 9-hour day, two free forgotten stamps a month, then 10.00 each, -60 / +15 minutes for emergencies.
      fixedRules: {
        standardDayMinutes: 540,
        freeForgottenStampsPerMonth: 2,
        emergencyRetroactiveMinutes: 60,
        emergencyReturnBufferMinutes: 15,
        forgottenStampPenaltyAgorot: 1_000,
      },
      updatedAt: expect.any(String),
    });

    // The Field Manager's copy is the Owner's without the penalty amount (money) and without edit rights.
    const asManager = await get(ctx.tokens.manager, SETTINGS).expect(200);
    const { forgottenStampPenaltyAgorot, ...rulesWithoutMoney } = asOwner.body.fixedRules;
    expect(forgottenStampPenaltyAgorot).toBe(1_000);
    expect(asManager.body).toEqual({ ...asOwner.body, canEdit: false, fixedRules: rulesWithoutMoney });
    expect(asManager.body.fixedRules).not.toHaveProperty("forgottenStampPenaltyAgorot");
    expect(JSON.stringify(asManager.body)).not.toMatch(MONEY_KEY);
    // (The same check does find the penalty in the Owner's copy.)
    expect(JSON.stringify(asOwner.body)).toMatch(MONEY_KEY);

    await get(ctx.tokens.worker, SETTINGS).expect(403);
    await request(http()).get(`/api/v1${SETTINGS}`).expect(401);
  });

  it("an Owner changes workday settings: the new settings come back and are stored, with one audit row per changed field (old -> new)", async () => {
    const ctx = await setup();
    const settingsRow = await prisma.organizationSettings.findUniqueOrThrow({ where: { organizationId: ctx.organizationId } });

    const changed = await editWorkday(ctx.tokens.owner, {
      defaultGraceMinutes: 15,
      defaultGeofenceRadiusMeters: 250,
      defaultMinGpsAccuracyMeters: 30,
      // The current value: not a change, so no audit row.
      deviceTimeDeviationSeconds: 120,
      temporaryPointRadiusMeters: 60,
      temporaryPointMinAccuracyMeters: 40,
      autoDeductUnpaidBreaks: true,
    }).expect(200);
    const workday = {
      ...DEFAULT_WORKDAY,
      defaultGraceMinutes: 15,
      defaultGeofenceRadiusMeters: 250,
      defaultMinGpsAccuracyMeters: 30,
      temporaryPointRadiusMeters: 60,
      temporaryPointMinAccuracyMeters: 40,
      autoDeductUnpaidBreaks: true,
    };
    // The response is the new settings view; the change is stored (a fresh read, and the Field Manager's copy, have it).
    expect(changed.body).toMatchObject({ canEdit: true, workday, onboarding: { invitationTtlHours: 72 }, notifications: DEFAULT_NOTIFICATIONS });
    expect((await get(ctx.tokens.owner, SETTINGS).expect(200)).body.workday).toEqual(workday);
    expect((await get(ctx.tokens.manager, SETTINGS).expect(200)).body.workday).toEqual(workday);

    expect(await auditOf(changed)).toEqual(
      [
        ["autoDeductUnpaidBreaks", "false", "true"],
        ["defaultGeofenceRadiusMeters", "100", "250"],
        ["defaultGraceMinutes", "10", "15"],
        ["defaultMinGpsAccuracyMeters", "50", "30"],
        ["temporaryPointMinAccuracyMeters", "75", "40"],
        ["temporaryPointRadiusMeters", "100", "60"],
      ].map(([field, oldValue, newValue]) =>
        expect.objectContaining({
          organizationId: ctx.organizationId,
          actorUserId: ctx.owner.user.id,
          action: "ORGANIZATION_SETTING_CHANGED",
          entityType: "OrganizationSettings",
          entityId: settingsRow.id,
          field,
          oldValue,
          newValue,
        }),
      ),
    );

    // Sending the current values again changes nothing and writes no audit row.
    const same = await editWorkday(ctx.tokens.owner, { defaultGraceMinutes: 15, autoDeductUnpaidBreaks: true }).expect(200);
    expect(same.body.workday).toEqual(workday);
    expect(await auditOf(same)).toEqual([]);

    // Only the fields sent change.
    const one = await editWorkday(ctx.tokens.owner, { deviceTimeDeviationSeconds: 90 }).expect(200);
    expect(one.body.workday).toEqual({ ...workday, deviceTimeDeviationSeconds: 90 });
    expect(await auditOf(one)).toEqual([expect.objectContaining({ field: "deviceTimeDeviationSeconds", oldValue: "120", newValue: "90" })]);
    expect(await prisma.auditLog.count({ where: { action: "ORGANIZATION_SETTING_CHANGED" } })).toBe(7);
  });

  it("onboarding and notification settings are audited per changed value; notification events not sent keep their current choice", async () => {
    const ctx = await setup();

    const ttl = await patch(ctx.tokens.owner, `${SETTINGS}/onboarding`, { invitationTtlHours: 48 }).expect(200);
    expect(ttl.body.onboarding).toEqual({ invitationTtlHours: 48 });
    expect(await auditOf(ttl)).toEqual([
      expect.objectContaining({ action: "ORGANIZATION_SETTING_CHANGED", field: "onboardingInvitationTtlHours", oldValue: "72", newValue: "48" }),
    ]);
    expect(await auditOf(await patch(ctx.tokens.owner, `${SETTINGS}/onboarding`, { invitationTtlHours: 48 }).expect(200))).toEqual([]);

    const first = await patch(ctx.tokens.owner, `${SETTINGS}/notifications`, {
      preferences: [
        { type: NotificationType.WORKER_CLOCKED_IN, owners: false },
        // Owners already get it: only the Field Managers' switch is a change.
        { type: NotificationType.ONBOARDING_SUBMITTED, owners: true, fieldManagers: true },
      ],
    }).expect(200);
    expect(first.body.notifications).toEqual(
      DEFAULT_NOTIFICATIONS.map((entry) => {
        if (entry.type === NotificationType.WORKER_CLOCKED_IN) return { ...entry, owners: false };
        if (entry.type === NotificationType.ONBOARDING_SUBMITTED) return { ...entry, fieldManagers: true };
        return entry;
      }),
    );
    expect(await auditOf(first)).toEqual([
      expect.objectContaining({
        action: "ORGANIZATION_SETTING_CHANGED",
        field: "notifications.ONBOARDING_SUBMITTED.fieldManagers",
        oldValue: "false",
        newValue: "true",
      }),
      expect.objectContaining({ action: "ORGANIZATION_SETTING_CHANGED", field: "notifications.WORKER_CLOCKED_IN.owners", oldValue: "true", newValue: "false" }),
    ]);

    // Changing the other audience of the same event keeps the stored choice for the first.
    const second = await patch(ctx.tokens.owner, `${SETTINGS}/notifications`, {
      preferences: [{ type: NotificationType.WORKER_CLOCKED_IN, fieldManagers: false }],
    }).expect(200);
    expect(second.body.notifications.find((entry: { type: string }) => entry.type === NotificationType.WORKER_CLOCKED_IN)).toEqual({
      ...byDefault(NotificationType.WORKER_CLOCKED_IN, "SHIFT_MANAGER", true),
      owners: false,
      fieldManagers: false,
    });
    expect(await auditOf(second)).toEqual([
      expect.objectContaining({ field: "notifications.WORKER_CLOCKED_IN.fieldManagers", oldValue: "true", newValue: "false" }),
    ]);
    // A Field Manager reads the same choices.
    expect((await get(ctx.tokens.manager, SETTINGS).expect(200)).body.notifications).toEqual(second.body.notifications);
    expect(await prisma.auditLog.count({ where: { action: "ORGANIZATION_SETTING_CHANGED" } })).toBe(4);
  });

  it("edits are Owner-only and validated: 403 for a Field Manager or Worker, 400 for an out-of-range or unknown value, and nothing changes", async () => {
    const ctx = await setup();

    const edits: Array<[string, Record<string, unknown>]> = [
      ["workday", { defaultGraceMinutes: 15 }],
      ["onboarding", { invitationTtlHours: 48 }],
      ["notifications", { preferences: [{ type: NotificationType.WORKER_CLOCKED_IN, owners: false }] }],
    ];
    for (const [section, body] of edits) {
      await patch(ctx.tokens.manager, `${SETTINGS}/${section}`, body).expect(403);
      await patch(ctx.tokens.worker, `${SETTINGS}/${section}`, body).expect(403);
    }

    const invalid: Array<[string, Record<string, unknown>]> = [
      ["workday", { defaultGraceMinutes: -1 }],
      ["workday", { defaultGraceMinutes: 121 }],
      ["workday", { defaultGraceMinutes: 12.5 }],
      ["workday", { defaultGeofenceRadiusMeters: 9 }],
      ["workday", { defaultGeofenceRadiusMeters: 5_001 }],
      ["workday", { defaultMinGpsAccuracyMeters: 4 }],
      ["workday", { defaultMinGpsAccuracyMeters: 501 }],
      ["workday", { deviceTimeDeviationSeconds: 9 }],
      ["workday", { deviceTimeDeviationSeconds: 3_601 }],
      ["workday", { temporaryPointRadiusMeters: 9 }],
      ["workday", { temporaryPointRadiusMeters: 2_001 }],
      ["workday", { temporaryPointMinAccuracyMeters: 4 }],
      ["workday", { temporaryPointMinAccuracyMeters: 501 }],
      // One invalid field refuses the whole request (the valid one is not applied either).
      ["workday", { defaultGraceMinutes: 15, deviceTimeDeviationSeconds: 5 }],
      // The fixed rules and the timezone are not settings; unknown keys are refused.
      ["workday", { standardDayMinutes: 600 }],
      ["workday", { timezone: "Europe/London" }],
      ["workday", { workdayStartsAt: "06:00" }],
      ["onboarding", { invitationTtlHours: 0 }],
      ["onboarding", { invitationTtlHours: 721 }],
      ["onboarding", { invitationTtlHours: 1.5 }],
      ["onboarding", {}],
      ["notifications", {}],
      ["notifications", { preferences: [] }],
      // A notification that exists but is not configurable (it goes to the worker concerned), and one that does not exist.
      ["notifications", { preferences: [{ type: NotificationType.SHIFT_APPROVED, owners: false }] }],
      ["notifications", { preferences: [{ type: "NOT_A_NOTIFICATION", owners: false }] }],
      ["notifications", { preferences: [{ owners: false }] }],
      ["notifications", { preferences: [{ type: NotificationType.WORKER_CLOCKED_IN, workers: true }] }],
    ];
    for (const [section, body] of invalid) {
      const response = await patch(ctx.tokens.owner, `${SETTINGS}/${section}`, body);
      expect({ section, body, status: response.status, code: response.body.code }).toEqual({ section, body, status: 400, code: "VALIDATION_FAILED" });
    }

    // Nothing changed and nothing was audited.
    expect((await get(ctx.tokens.owner, SETTINGS).expect(200)).body).toMatchObject({
      workday: DEFAULT_WORKDAY,
      onboarding: { invitationTtlHours: 72 },
      notifications: DEFAULT_NOTIFICATIONS,
    });
    expect(await prisma.auditLog.count({ where: { action: "ORGANIZATION_SETTING_CHANGED" } })).toBe(0);

    // The bounds themselves are accepted.
    const lowest = {
      defaultGraceMinutes: 0,
      defaultGeofenceRadiusMeters: 10,
      defaultMinGpsAccuracyMeters: 5,
      deviceTimeDeviationSeconds: 10,
      temporaryPointRadiusMeters: 10,
      temporaryPointMinAccuracyMeters: 5,
    };
    expect((await editWorkday(ctx.tokens.owner, lowest).expect(200)).body.workday).toMatchObject(lowest);
    const highest = {
      defaultGraceMinutes: 120,
      defaultGeofenceRadiusMeters: 5_000,
      defaultMinGpsAccuracyMeters: 500,
      deviceTimeDeviationSeconds: 3_600,
      temporaryPointRadiusMeters: 2_000,
      temporaryPointMinAccuracyMeters: 500,
    };
    expect((await editWorkday(ctx.tokens.owner, highest).expect(200)).body.workday).toMatchObject(highest);
    for (const invitationTtlHours of [1, 720]) {
      expect((await patch(ctx.tokens.owner, `${SETTINGS}/onboarding`, { invitationTtlHours }).expect(200)).body.onboarding).toEqual({ invitationTtlHours });
    }

    // The old catch-all `PATCH /organizations/me/settings` is gone.
    await patch(ctx.tokens.owner, SETTINGS, { defaultGraceMinutes: 15 }).expect(404);
  });

  it("null values and a repeated notification type are refused with 400 and change nothing; a field left out is simply not changed", async () => {
    // Regression: a null workday value was a 500, a null audience was stored and audited as "true -> null", and the
    // same event twice was audited as a change its second entry undid.
    const ctx = await setup();
    const before = await prisma.organizationSettings.findUniqueOrThrow({ where: { organizationId: ctx.organizationId } });
    const workdayFields = [
      "defaultGraceMinutes",
      "defaultGeofenceRadiusMeters",
      "defaultMinGpsAccuracyMeters",
      "deviceTimeDeviationSeconds",
      "temporaryPointRadiusMeters",
      "temporaryPointMinAccuracyMeters",
      "autoDeductUnpaidBreaks",
    ];
    const { WORKER_CLOCKED_IN, WORKER_CLOCKED_OUT, ONBOARDING_SUBMITTED } = NotificationType;
    const refused: Array<[string, Record<string, unknown>]> = [
      // null for any workday field, alone or next to a valid change (which is not applied either).
      ...workdayFields.flatMap((field): Array<[string, Record<string, unknown>]> => {
        const validChange = field === "autoDeductUnpaidBreaks" ? { defaultGraceMinutes: 15 } : { autoDeductUnpaidBreaks: true };
        return [
          ["workday", { [field]: null }],
          ["workday", { ...validChange, [field]: null }],
        ];
      }),
      // null for either audience of a notification, alone or next to a valid change.
      ["notifications", { preferences: [{ type: WORKER_CLOCKED_IN, owners: null }] }],
      ["notifications", { preferences: [{ type: WORKER_CLOCKED_IN, fieldManagers: null }] }],
      [
        "notifications",
        {
          preferences: [
            { type: ONBOARDING_SUBMITTED, fieldManagers: true },
            { type: WORKER_CLOCKED_IN, owners: null },
          ],
        },
      ],
      // The same event twice, whether the two entries contradict each other, agree, or set different audiences.
      [
        "notifications",
        {
          preferences: [
            { type: WORKER_CLOCKED_OUT, owners: false },
            { type: WORKER_CLOCKED_OUT, owners: true },
          ],
        },
      ],
      [
        "notifications",
        {
          preferences: [
            { type: WORKER_CLOCKED_OUT, owners: false },
            { type: WORKER_CLOCKED_OUT, owners: false },
          ],
        },
      ],
      [
        "notifications",
        {
          preferences: [
            { type: WORKER_CLOCKED_OUT, owners: false },
            { type: ONBOARDING_SUBMITTED, fieldManagers: true },
            { type: WORKER_CLOCKED_OUT, fieldManagers: false },
          ],
        },
      ],
    ];
    for (const [section, body] of refused) {
      const response = await patch(ctx.tokens.owner, `${SETTINGS}/${section}`, body);
      expect({ section, body, status: response.status, code: response.body.code }).toEqual({ section, body, status: 400, code: "VALIDATION_FAILED" });
    }

    // Nothing was saved -- the stored row, raw notification preferences included, is untouched -- and nothing audited.
    expect(await prisma.organizationSettings.findUniqueOrThrow({ where: { organizationId: ctx.organizationId } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { action: "ORGANIZATION_SETTING_CHANGED" } })).toBe(0);

    // A field left out is not changed: the other workday fields and the other audience keep their values.
    const grace = await editWorkday(ctx.tokens.owner, { defaultGraceMinutes: 15 }).expect(200);
    expect(grace.body.workday).toEqual({ ...DEFAULT_WORKDAY, defaultGraceMinutes: 15 });
    expect(await auditOf(grace)).toEqual([expect.objectContaining({ field: "defaultGraceMinutes", oldValue: "10", newValue: "15" })]);
    const owners = await patch(ctx.tokens.owner, `${SETTINGS}/notifications`, { preferences: [{ type: WORKER_CLOCKED_OUT, owners: false }] }).expect(200);
    expect(owners.body.notifications.find((entry: { type: string }) => entry.type === WORKER_CLOCKED_OUT)).toEqual({
      ...byDefault(WORKER_CLOCKED_OUT, "SHIFT_MANAGER", true),
      owners: false,
    });
    expect(await auditOf(owners)).toEqual([expect.objectContaining({ field: "notifications.WORKER_CLOCKED_OUT.owners", oldValue: "true", newValue: "false" })]);
  });

  it("grace minutes: a new shift without its own value gets the organization's default; an explicit value (even 0) wins; existing shifts keep theirs", async () => {
    const ctx = await setup();
    const newShift = (graceMinutes?: number) =>
      post(ctx.tokens.manager, "/shifts", {
        shiftType: ShiftType.STANDARD,
        title: "Lane closure",
        projectId: ctx.project.id,
        siteId: ctx.site.id,
        geofenceId: ctx.geofence.id,
        scheduledStart: ctx.start.toISOString(),
        scheduledEnd: ctx.end.toISOString(),
        ...(graceMinutes === undefined ? {} : { graceMinutes }),
      }).expect(201);

    const before = await newShift();
    expect(before.body.graceMinutes).toBe(10);

    await editWorkday(ctx.tokens.owner, { defaultGraceMinutes: 25 }).expect(200);
    expect((await newShift()).body.graceMinutes).toBe(25);
    expect((await newShift(5)).body.graceMinutes).toBe(5);
    expect((await newShift(0)).body.graceMinutes).toBe(0);
    // A shift keeps the value it was created with.
    expect((await get(ctx.tokens.manager, `/shifts/${before.body.id}`).expect(200)).body.graceMinutes).toBe(10);
  });

  it("device-time deviation: an online clock event N seconds off is refused when N is over the setting and accepted when it is not", async () => {
    const ctx = await setup();
    const limit = (deviceTimeDeviationSeconds: number) => editWorkday(ctx.tokens.owner, { deviceTimeDeviationSeconds }).expect(200);

    // 60 s behind with the limit at 30 s: refused (the default 120 s would have accepted it). A clock running ahead counts the same.
    await limit(30);
    const behind = await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id, deviceTimestamp: secondsFromNow(-60) }).expect(400);
    expect(behind.body.code).toBe("DEVICE_TIME_DEVIATION_EXCEEDED");
    expect(behind.body.details.deviationSeconds).toBeGreaterThanOrEqual(60);
    const ahead = await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id, deviceTimestamp: secondsFromNow(60) }).expect(400);
    expect(ahead.body.code).toBe("DEVICE_TIME_DEVIATION_EXCEEDED");
    expect(await prisma.timeEntry.count()).toBe(0);

    // The same 60 s with the limit at 300 s: accepted.
    await limit(300);
    const clockIn = await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id, deviceTimestamp: secondsFromNow(-60) }).expect(201);
    expect(clockIn.body.clockEvent.deviceTimeDeviationSeconds).toBeGreaterThanOrEqual(60);

    // Clock-out reads the setting too: 60 s off is refused at 30 s...
    await limit(30);
    const refusedOut = await clock(ctx.tokens.worker, "clock-out", { ...clockOutBody, deviceTimestamp: secondsFromNow(-60) }).expect(400);
    expect(refusedOut.body.code).toBe("DEVICE_TIME_DEVIATION_EXCEEDED");
    // ...and 200 s off is accepted at 300 s (beyond the fixed 120 s limit the API applied before this setting existed).
    await limit(300);
    await clock(ctx.tokens.worker, "clock-out", { ...clockOutBody, deviceTimestamp: secondsFromNow(200) }).expect(201);
  });

  it("device-time deviation: an offline event older than the setting is flagged for review (never refused); within it, verified", async () => {
    const ctx = await setup();
    const session = await loginAs(app, WORKER_PHONE, OFFLINE_DEVICE);
    const keyPair = generateOfflineSigningKeyPair(testRandomBytes);
    await post(session.accessToken, "/devices/public-key", { deviceId: OFFLINE_DEVICE, publicKey: keyPair.publicKeyBase64 }).expect(201);
    const sync = async (payload: OfflineEventSignablePayload) => {
      const signature = signOfflineEvent(canonicalizeOfflineEvent(payload), keyPair.secretKeyBase64);
      const response = await post(session.accessToken, "/offline-sync/batches", { deviceId: OFFLINE_DEVICE, events: [{ ...payload, signature }] }).expect(201);
      return response.body.results[0];
    };
    const at = (secondsAgo: number) => ({
      clientEventId: uuidv7(),
      deviceTimestamp: secondsFromNow(-secondsAgo),
      latitude: NEARBY_LAT,
      longitude: SITE_LNG,
      accuracyMeters: 10,
    });

    // Limit 300 s: events 200 s and 150 s old are verified (the fixed 120 s limit from before this setting would have flagged them).
    await editWorkday(ctx.tokens.owner, { deviceTimeDeviationSeconds: 300 }).expect(200);
    expect(await sync({ ...at(200), eventType: "CLOCK_IN", shiftId: ctx.shift.id })).toMatchObject({ status: "VERIFIED" });
    expect(await sync({ ...at(150), eventType: "CLOCK_OUT", ...clockOutBody })).toMatchObject({ status: "VERIFIED" });

    // Limit 30 s: an event 60 s old is accepted, but flagged.
    await editWorkday(ctx.tokens.owner, { deviceTimeDeviationSeconds: 30 }).expect(200);
    const flagged = await sync({ ...at(60), eventType: "CLOCK_IN", shiftId: ctx.shift.id });
    expect(flagged).toMatchObject({ status: "FLAGGED", timeEntryId: expect.any(String) });
    const clockEvent = await prisma.clockEvent.findFirstOrThrow({ where: { timeEntryId: flagged.timeEntryId } });
    expect(clockEvent).toMatchObject({ origin: "OFFLINE", locationValidationStatus: "FLAGGED" });
  });

  it("a new site's default radius and a new geofence's required GPS accuracy come from the settings; explicit values win; existing ones keep theirs", async () => {
    const ctx = await setup();
    const newSite = (body: Record<string, unknown> = {}) =>
      post(ctx.tokens.manager, "/sites", { projectId: ctx.project.id, name: "North yard", latitude: SITE_LAT, longitude: SITE_LNG, ...body }).expect(201);
    const newGeofence = (siteId: string, body: Record<string, unknown> = {}) =>
      post(ctx.tokens.manager, "/geofences", { siteId, centerLatitude: SITE_LAT, centerLongitude: SITE_LNG, radiusMeters: 120, ...body }).expect(201);

    const oldSite = await newSite();
    const oldGeofence = await newGeofence(oldSite.body.id);
    expect(oldSite.body.defaultGeofenceRadiusMeters).toBe(100);
    expect(oldGeofence.body.minAccuracyMeters).toBe(50);

    await editWorkday(ctx.tokens.owner, { defaultGeofenceRadiusMeters: 250, defaultMinGpsAccuracyMeters: 30 }).expect(200);
    const site = await newSite();
    const geofence = await newGeofence(site.body.id);
    expect(site.body.defaultGeofenceRadiusMeters).toBe(250);
    expect(geofence.body).toMatchObject({ siteId: site.body.id, radiusMeters: 120, minAccuracyMeters: 30 });
    expect((await newSite({ defaultGeofenceRadiusMeters: 80 })).body.defaultGeofenceRadiusMeters).toBe(80);
    expect((await newGeofence(site.body.id, { minAccuracyMeters: 20 })).body.minAccuracyMeters).toBe(20);
    expect(await prisma.site.findUniqueOrThrow({ where: { id: oldSite.body.id } })).toMatchObject({ defaultGeofenceRadiusMeters: 100 });
    expect(await prisma.geofence.findUniqueOrThrow({ where: { id: oldGeofence.body.id } })).toMatchObject({ minAccuracyMeters: 50 });

    // The new geofence's accuracy is what a clock-in there must meet: a 40 m fix (fine under the old 50 m default) is too coarse.
    const shift = await createStandardShift(
      prisma,
      ctx.organizationId,
      ctx.project.id,
      site.body.id,
      geofence.body.id,
      ctx.manager.user.id,
      ctx.start,
      ctx.end,
    );
    await assignWorkerToShift(prisma, shift.id, ctx.worker.workerProfile.id, ctx.manager.user.id);
    const coarse = await clock(ctx.tokens.worker, "clock-in", { shiftId: shift.id, accuracyMeters: 40 }).expect(400);
    expect(coarse.body).toMatchObject({ code: "GPS_ACCURACY_TOO_LOW", details: { accuracyMeters: 40, requiredMeters: 30 } });
    await clock(ctx.tokens.worker, "clock-in", { shiftId: shift.id, accuracyMeters: 25 }).expect(201);
  });

  it("a new temporary check-in point gets the default radius, and clocking in at one needs the temporary-point GPS accuracy", async () => {
    const ctx = await setup();
    // A point ~300 m north of the site (outside its 100 m geofence); the worker stands ~245 m further north.
    const pointLat = 32.088;
    const workerLat = 32.0902;
    const newPoint = (name: string, body: Record<string, unknown> = {}) => {
      const point = { shiftId: ctx.shift.id, name, latitude: pointLat, longitude: SITE_LNG, ...body };
      return post(ctx.tokens.manager, "/shifts/temporary-check-in-points", point).expect(201);
    };

    const oldPoint = await newPoint("Bridge north");
    expect(oldPoint.body.radiusMeters).toBe(100);

    await editWorkday(ctx.tokens.owner, { temporaryPointRadiusMeters: 400, temporaryPointMinAccuracyMeters: 20 }).expect(200);
    const point = await newPoint("Bridge south");
    expect(point.body.radiusMeters).toBe(400);
    expect((await newPoint("Bridge east", { radiusMeters: 80 })).body.radiusMeters).toBe(80);
    expect(await prisma.temporaryCheckInPoint.findUniqueOrThrow({ where: { id: oldPoint.body.id } })).toMatchObject({ radiusMeters: 100 });

    const atPoint = (temporaryCheckInPointId: string, accuracyMeters: number) =>
      clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id, temporaryCheckInPointId, latitude: workerLat, accuracyMeters });
    // 245 m away is outside the 100 m point opened before the change...
    const outside = await atPoint(oldPoint.body.id, 15).expect(400);
    expect(outside.body).toMatchObject({ code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS", details: { allowedRadiusMeters: 100 } });
    // ...and a 30 m fix is too coarse for the 20 m the setting asks at a temporary point.
    const coarse = await atPoint(point.body.id, 30).expect(400);
    expect(coarse.body).toMatchObject({ code: "GPS_ACCURACY_TOO_LOW", details: { accuracyMeters: 30, requiredMeters: 20 } });
    // Relaxing the accuracy applies to the next clock-in; the 400 m point takes the worker in.
    await editWorkday(ctx.tokens.owner, { temporaryPointMinAccuracyMeters: 40 }).expect(200);
    const inside = await atPoint(point.body.id, 30).expect(201);
    expect(inside.body.clockEvent.temporaryCheckInPointId).toBe(point.body.id);
  });

  it("notification audience: with worker clock-ins off for Owners, a clock-in notifies the shift's manager but not the Owner; each switch is per event and per audience", async () => {
    const ctx = await setup();
    const received = async (token: string) => (await get(token, "/notifications").expect(200)).body.map((row: { type: string }) => row.type).sort();

    await patch(ctx.tokens.owner, `${SETTINGS}/notifications`, { preferences: [{ type: NotificationType.WORKER_CLOCKED_IN, owners: false }] }).expect(200);
    await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id }).expect(201);
    expect(await received(ctx.tokens.manager)).toEqual([NotificationType.WORKER_CLOCKED_IN]);
    expect(await received(ctx.tokens.owner)).toEqual([]);

    // Clock-outs were not switched off: both get those.
    await clock(ctx.tokens.worker, "clock-out", clockOutBody).expect(201);
    expect(await received(ctx.tokens.manager)).toEqual([NotificationType.WORKER_CLOCKED_IN, NotificationType.WORKER_CLOCKED_OUT]);
    expect(await received(ctx.tokens.owner)).toEqual([NotificationType.WORKER_CLOCKED_OUT]);

    // The other way round: Owners back on, Field Managers (here, the shift's manager) off.
    await patch(ctx.tokens.owner, `${SETTINGS}/notifications`, {
      preferences: [{ type: NotificationType.WORKER_CLOCKED_IN, owners: true, fieldManagers: false }],
    }).expect(200);
    await clock(ctx.tokens.worker, "clock-in", { shiftId: ctx.shift.id }).expect(201);
    expect(await received(ctx.tokens.owner)).toEqual([NotificationType.WORKER_CLOCKED_IN, NotificationType.WORKER_CLOCKED_OUT]);
    expect(await received(ctx.tokens.manager)).toEqual([NotificationType.WORKER_CLOCKED_IN, NotificationType.WORKER_CLOCKED_OUT]);
  });

  it("invitation lifetime: a new onboarding invitation expires invitationTtlHours after it is created", async () => {
    const ctx = await setup();
    /** Creates an invitation and checks its expiry is `hours` after a moment inside the request. */
    async function expectInvitationLasts(token: string, hours: number) {
      const before = Date.now();
      const response = await post(token, "/onboarding-invitations").expect(201);
      const createdAt = new Date(response.body.expiresAt).getTime() - hours * 3_600_000;
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(Date.now());
      const stored = await prisma.onboardingInvitation.findUniqueOrThrow({ where: { id: response.body.invitationId } });
      expect(stored.expiresAt.toISOString()).toBe(response.body.expiresAt);
    }

    await expectInvitationLasts(ctx.tokens.manager, 72);
    await patch(ctx.tokens.owner, `${SETTINGS}/onboarding`, { invitationTtlHours: 5 }).expect(200);
    await expectInvitationLasts(ctx.tokens.manager, 5);
    await expectInvitationLasts(ctx.tokens.owner, 5);
  });
});
