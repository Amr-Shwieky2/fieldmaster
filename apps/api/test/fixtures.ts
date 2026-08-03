import { v7 as uuidv7 } from "uuid";
import { AccountStatus, CheckInMethod, CompensationType, OrgRole, ShiftStatus, ShiftType } from "@fieldmaster/shared-types";
import { toBusinessDate } from "@fieldmaster/shared-validation";
import { PrismaService } from "../src/common/prisma/prisma.service";

const id = () => uuidv7();

export async function createOrgWithOwner(prisma: PrismaService, phoneNumber = "+972500000001", name = "Test Owner") {
  const org = await prisma.organization.create({ data: { id: id(), name: "Test Org" } });
  await prisma.organizationSettings.create({ data: { id: id(), organizationId: org.id } });
  const user = await prisma.user.create({ data: { id: id(), phoneNumber, fullLegalName: name, status: AccountStatus.ACTIVE } });
  const membership = await prisma.organizationMembership.create({
    data: { id: id(), organizationId: org.id, userId: user.id, role: OrgRole.OWNER, status: AccountStatus.ACTIVE },
  });
  return { org, user, membership };
}

export async function addFieldManager(prisma: PrismaService, organizationId: string, phoneNumber: string, name: string, isTimeTrackable = false) {
  const user = await prisma.user.create({ data: { id: id(), phoneNumber, fullLegalName: name, status: AccountStatus.ACTIVE } });
  const membership = await prisma.organizationMembership.create({
    data: { id: id(), organizationId, userId: user.id, role: OrgRole.FIELD_MANAGER, isTimeTrackable, status: AccountStatus.ACTIVE },
  });
  let workerProfile = null;
  if (isTimeTrackable) {
    workerProfile = await prisma.workerProfile.create({ data: { id: id(), membershipId: membership.id, organizationId } });
  }
  return { user, membership, workerProfile };
}

export async function addWorker(
  prisma: PrismaService,
  organizationId: string,
  phoneNumber: string,
  name: string,
  compensation?: { type: typeof CompensationType.DAILY | typeof CompensationType.HOURLY; dailyRateAgorot?: number; hourlyRateAgorot?: number; overtimeRateAgorot: number },
) {
  const user = await prisma.user.create({ data: { id: id(), phoneNumber, fullLegalName: name, status: AccountStatus.ACTIVE } });
  const membership = await prisma.organizationMembership.create({
    data: { id: id(), organizationId, userId: user.id, role: OrgRole.WORKER, isTimeTrackable: true, status: AccountStatus.ACTIVE },
  });
  const workerProfile = await prisma.workerProfile.create({ data: { id: id(), membershipId: membership.id, organizationId } });

  if (compensation) {
    await prisma.compensationProfile.create({
      data: {
        id: id(),
        workerProfileId: workerProfile.id,
        compensationType: compensation.type,
        dailyBaseRateAgorot: compensation.dailyRateAgorot,
        baseHourlyRateAgorot: compensation.hourlyRateAgorot,
        overtimeHourlyRateAgorot: compensation.overtimeRateAgorot,
        effectiveStartDate: new Date("2020-01-01"),
        changeReason: "Test fixture",
        createdBy: user.id,
      },
    });
  }

  return { user, membership, workerProfile };
}

export async function createProject(prisma: PrismaService, organizationId: string, code = `PRJ-${id().slice(0, 8)}`) {
  return prisma.project.create({ data: { id: id(), organizationId, name: "Test Project", projectCode: code, status: "ACTIVE" } });
}

export async function createSiteWithGeofence(prisma: PrismaService, organizationId: string, projectId: string, latitude: number, longitude: number, radiusMeters = 100) {
  const site = await prisma.site.create({
    data: { id: id(), organizationId, projectId, name: "Test Site", latitude, longitude, defaultGeofenceRadiusMeters: radiusMeters },
  });
  const geofence = await prisma.geofence.create({
    data: { id: id(), organizationId, siteId: site.id, centerLatitude: latitude, centerLongitude: longitude, radiusMeters, minAccuracyMeters: 50, version: 1, createdBy: id() },
  });
  return { site, geofence };
}

export async function createStandardShift(
  prisma: PrismaService,
  organizationId: string,
  projectId: string,
  siteId: string,
  geofenceId: string,
  managerId: string,
  start: Date,
  end: Date,
  checkInMethod: CheckInMethod = CheckInMethod.GEOFENCED,
) {
  return prisma.shift.create({
    data: {
      id: id(),
      organizationId,
      projectId,
      siteId,
      geofenceId,
      shiftType: ShiftType.STANDARD,
      title: "Test Shift",
      scheduledStart: start,
      scheduledEnd: end,
      checkInMethod,
      businessDate: toBusinessDate(start),
      managerId,
      status: ShiftStatus.PUBLISHED,
      createdBy: managerId,
    },
  });
}

export async function assignWorkerToShift(prisma: PrismaService, shiftId: string, workerProfileId: string, assignedBy: string) {
  return prisma.shiftAssignment.create({ data: { id: id(), shiftId, workerProfileId, assignedBy } });
}
