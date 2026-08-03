import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { PrismaService } from "../src/common/prisma/prisma.service";

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

/** Truncates every business table so each test file starts from a clean slate. */
export async function resetDatabase(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      idempotency_records, otp_challenges,
      payroll_calculation_snapshots, payroll_adjustments, payroll_items, payroll_periods,
      forgotten_stamp_infractions, manual_time_corrections, attendance_approvals, daily_summaries,
      unpaid_breaks, clock_events, emergency_callouts, time_entries,
      temporary_check_in_points, temporary_supervisor_assignments, shift_assignments, shifts,
      turan_assignments, geofences, sites, projects,
      notification_deliveries, notifications,
      offline_sync_events, offline_sync_batches, device_public_keys,
      onboarding_invitations, identity_documents, encrypted_bank_accounts, compensation_profiles, worker_profiles,
      refresh_token_families, user_devices, organization_memberships, users,
      audit_logs, organization_settings, organizations
    RESTART IDENTITY CASCADE;
  `);
}

export interface LoggedInUser {
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  role: string;
}

export async function loginAs(app: INestApplication, phoneNumber: string, deviceId = "test-device"): Promise<LoggedInUser> {
  const http = app.getHttpServer();
  await request(http).post("/api/v1/auth/otp/request").send({ phoneNumber }).expect(204);
  const response = await request(http)
    .post("/api/v1/auth/otp/verify")
    .send({ phoneNumber, code: "000000", deviceId, platform: "WEB" })
    .expect(201);
  return response.body;
}

export { request };
