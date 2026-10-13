import type { INestApplication } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";
import { request } from "./test-app";

/** Polls `GET /payroll-periods/:yearMonth/calculation` until run `runId` has finished (SUCCEEDED or FAILED). */
export async function waitForCalculation(app: INestApplication, accessToken: string, yearMonth: string, runId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await request(app.getHttpServer()).get(`/api/v1/payroll-periods/${yearMonth}/calculation`).set("Authorization", `Bearer ${accessToken}`);
    const finished = response.status === 200 && response.body.id === runId && (response.body.state === "SUCCEEDED" || response.body.state === "FAILED");
    if (finished) return response.body;
    if (Date.now() > deadline) throw new Error(`Payroll calculation ${runId} did not finish: ${response.status} ${JSON.stringify(response.body)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Starts a calculation (202, a background job) and waits for it; fails unless it SUCCEEDED. Answers the finished run. */
export async function calculatePayroll(app: INestApplication, accessToken: string, yearMonth: string, idempotencyKey: string = uuidv7()) {
  const started = await request(app.getHttpServer())
    .post(`/api/v1/payroll-periods/${yearMonth}/calculate`)
    .set("Authorization", `Bearer ${accessToken}`)
    .set("Idempotency-Key", idempotencyKey)
    .expect(202);
  const run = await waitForCalculation(app, accessToken, yearMonth, started.body.id);
  expect(run).toMatchObject({ state: "SUCCEEDED", progress: 100, errorCode: null });
  return run;
}
