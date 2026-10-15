import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { CheckInMethod, TimeEntryStatus } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { createTestApp, resetDatabase, request, loginAs } from "./test-app";
import { PrismaService } from "../src/common/prisma/prisma.service";
import { addFieldManager, addWorker, assignWorkerToShift, createOrgWithOwner, createProject, createSiteWithGeofence, createStandardShift } from "./fixtures";

/**
 * Pagination (scalability): every list that grows with the organization
 * answers one page with its total when asked (`?page=` / `?pageSize=`) and,
 * asked for neither, exactly what it always answered (older clients).
 */

const OWNER_PHONE = "+972500000001";
const MANAGER_PHONE = "+972500000011";
const SITE = { lat: 32.0853, lng: 34.7818 };
const WORKERS = 5;

interface Page {
  items: { id?: string; membershipId?: string }[];
  total: number;
  page: number;
  pageSize: number;
}

describe("Paginated lists", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => app.getHttpServer();
  const get = (token: string, path: string) => request(http()).get(`/api/v1${path}`).set({ Authorization: `Bearer ${token}` });

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

  /** An Owner, a Field Manager, one project, site and shift, and five workers each with an entry waiting for approval. */
  async function setup() {
    const owner = await createOrgWithOwner(prisma, OWNER_PHONE, "Dana Owner");
    const organizationId = owner.org.id;
    const manager = await addFieldManager(prisma, organizationId, MANAGER_PHONE, "Yossi Manager");
    const project = await createProject(prisma, organizationId);
    const { site, geofence } = await createSiteWithGeofence(prisma, organizationId, project.id, SITE.lat, SITE.lng, 100);
    const shift = await createStandardShift(prisma, organizationId, project.id, site.id, geofence.id, manager.user.id, new Date(Date.now() - 3_600_000), new Date(Date.now() + 8 * 3_600_000));
    const businessDate = toBusinessDate(new Date());
    for (let i = 0; i < WORKERS; i++) {
      const worker = await addWorker(prisma, organizationId, `+97250099000${i}`, `Worker ${i}`, { type: "DAILY", dailyRateAgorot: 40_000, overtimeRateAgorot: 6_000 });
      await assignWorkerToShift(prisma, shift.id, worker.workerProfile.id, manager.user.id);
      const clockInAt = new Date(Date.now() - (10 - i) * 3_600_000);
      await prisma.timeEntry.create({
        data: {
          id: uuidv7(),
          organizationId,
          workerProfileId: worker.workerProfile.id,
          shiftId: shift.id,
          status: TimeEntryStatus.PENDING_APPROVAL,
          businessDate,
          clockInAt,
          clockOutAt: new Date(clockInAt.getTime() + 60 * 60_000),
          rawDurationMinutes: 60,
          checkInMethod: CheckInMethod.GEOFENCED,
        },
      });
    }
    return { ownerToken: (await loginAs(app, OWNER_PHONE)).accessToken };
  }

  /** The lists, with how many rows the setup gives each one. */
  const LISTS: [string, number][] = [
    ["/attendance-approvals/pending", WORKERS],
    ["/time-entries", WORKERS],
    ["/workers", WORKERS],
    ["/memberships", WORKERS + 2],
    ["/memberships/access", WORKERS + 2],
    ["/shifts", 1],
    ["/projects", 1],
    ["/sites", 1],
    ["/turan-assignments", 0],
    ["/forgotten-stamp-infractions", 0],
    ["/onboarding-invitations", 0],
    ["/workers/pending-approval", 0],
    ["/onboarding-invitations/pending-workers", 0],
    ["/reports", 0],
    ["/offline-sync/batches", 0],
  ];
  const keyOf = (row: { id?: string; membershipId?: string }) => row.id ?? row.membershipId;

  it("a page holds its rows and the list's total, in the order of the whole list; without ?page the list is unchanged", async () => {
    const { ownerToken } = await setup();
    for (const [path, rows] of LISTS) {
      const whole = (await get(ownerToken, path).expect(200)).body as { id?: string; membershipId?: string }[];
      expect({ path, isArray: Array.isArray(whole), length: whole.length }).toEqual({ path, isArray: true, length: rows });

      const pages: Page[] = [];
      for (let page = 1; page <= 3; page++) {
        const body = (await get(ownerToken, `${path}${path.includes("?") ? "&" : "?"}page=${page}&pageSize=2`).expect(200)).body as Page;
        expect({ path, page: body.page, pageSize: body.pageSize, total: body.total }).toEqual({ path, page, pageSize: 2, total: rows });
        pages.push(body);
      }
      // Pages 1-3 of two rows cover the five rows once each, in the whole list's order.
      expect({ path, keys: pages.flatMap((page) => page.items.map(keyOf)) }).toEqual({ path, keys: whole.map(keyOf).slice(0, 6) });
    }
  });

  it("pageSize alone asks for the first page; a page past the end is empty with the total", async () => {
    const { ownerToken } = await setup();
    const first = (await get(ownerToken, "/attendance-approvals/pending?pageSize=1").expect(200)).body as Page;
    expect({ page: first.page, pageSize: first.pageSize, total: first.total, items: first.items.length }).toEqual({ page: 1, pageSize: 1, total: WORKERS, items: 1 });
    const past = (await get(ownerToken, "/workers?page=9&pageSize=10").expect(200)).body as Page;
    expect(past).toEqual({ items: [], total: WORKERS, page: 9, pageSize: 10 });
    // A default page of 20.
    const defaults = (await get(ownerToken, "/memberships?page=1").expect(200)).body as Page;
    expect({ pageSize: defaults.pageSize, items: defaults.items.length }).toEqual({ pageSize: 20, items: WORKERS + 2 });
  });

  it("refuses a malformed page or page size with a 400", async () => {
    const { ownerToken } = await setup();
    for (const query of ["page=0", "page=-1", "page=abc", "page=1.5", "pageSize=0", "pageSize=101", "pageSize=", "page=1&pageSize=x"]) {
      for (const path of ["/attendance-approvals/pending", "/workers", "/forgotten-stamp-infractions"]) {
        const response = await get(ownerToken, `${path}?${query}`);
        expect({ path, query, status: response.status }).toEqual({ path, query, status: 400 });
      }
    }
  });
});
