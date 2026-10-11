import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";

/** The mobile app's own Arabic messages (the simulator shows the worker exactly what the phone would). */
const mobile = JSON.parse(readFileSync(resolve(process.cwd(), "../mobile/src/i18n/messages/ar.json"), "utf8"));

function pick(source: Record<string, string>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k]]));
}

describe("worker simulator wording matches the mobile app", () => {
  it("uses the mobile clock-in and clock-out receipts word for word", () => {
    const { clockIn, clockOut } = ar.workerSimulator.receipt;
    expect(clockIn).toEqual(pick(mobile.clockIn, Object.keys(clockIn)));
    expect(clockOut).toEqual(pick(mobile.clockOut, Object.keys(clockOut)));
    expect(Object.keys(clockOut)).toEqual(expect.arrayContaining(["successTitle", "successBody", "successDuration", "successPending", "queuedTitle"]));
  });

  it("uses the mobile offline queue's status labels and reasons", () => {
    expect(ar.workerSimulator.offline.status).toEqual(mobile.offlineQueue.status);
    expect(ar.workerSimulator.offline.reasons).toEqual(mobile.offlineQueue.reasons);
    expect(ar.workerSimulator.offline.syncNow).toBe(mobile.offlineQueue.syncNow);
    expect(ar.workerSimulator.offline.status.PENDING).toBe("بانتظار المزامنة");
  });
});
