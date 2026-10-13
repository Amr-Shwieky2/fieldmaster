import { NotificationType } from "@fieldmaster/shared-types";
import { sharedMessages } from "@fieldmaster/i18n/node";
import { buildPushContent, pushBody, pushTitle } from "../push/push-content";
import {
  EXPO_PUSH_URL,
  ExpoPushProvider,
  LogPushProvider,
  buildExpoPushRequests,
  readExpoTickets,
  resolvePushProviderKind,
  type PushMessage,
} from "../push/push-provider";

const ENTRY_ID = "0192f0aa-0000-7000-8000-000000000001";
const SHIFT_ID = "0192f0aa-0000-7000-8000-000000000002";
const WORKER_PROFILE_ID = "0192f0aa-0000-7000-8000-000000000003";
const TURAN_ID = "0192f0aa-0000-7000-8000-000000000004";
const NOTIFICATION_ID = "0192f0aa-0000-7000-8000-0000000000aa";

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{2,}/;

function message(index: number): PushMessage {
  return {
    to: `ExponentPushToken[token-${index}]`,
    title: "تمت الموافقة على الحضور",
    body: "عرض التفاصيل",
    data: { notificationId: NOTIFICATION_ID, type: NotificationType.SHIFT_APPROVED, timeEntryId: ENTRY_ID },
    sound: "default",
    channelId: "default",
  };
}

function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("push content (Arabic, from the shared labels; ids only)", () => {
  it("titles each type with its shared Arabic label and uses one generic Arabic body", () => {
    for (const type of Object.values(NotificationType)) {
      expect(pushTitle(type)).toBe((sharedMessages.enums.NotificationType as Record<string, string>)[type]);
      expect(pushTitle(type)).toMatch(ARABIC);
      expect(pushTitle(type)).not.toMatch(LATIN_WORD);
    }
    expect(pushBody()).toBe("عرض التفاصيل");
    expect(pushTitle("SOMETHING_NEW")).toBe(sharedMessages.common.notifications);
  });

  it("a worker's push carries the notification and record ids only: no money, no names, no reason, no English text", () => {
    // What an approval / rejection stores for the worker (plus money a buggy call site might add).
    const approved = buildPushContent({
      id: NOTIFICATION_ID,
      type: NotificationType.SHIFT_REJECTED,
      dataJson: {
        timeEntryId: ENTRY_ID,
        shiftId: SHIFT_ID,
        shiftTitle: "Ayalon North lane closure",
        businessDate: "2026-10-13",
        reason: "Clock-in was 40 minutes late per foreman Yossi Cohen",
        approvedRegularMinutes: 540,
        estimatedCostAgorot: 45_000,
        workerProfileId: WORKER_PROFILE_ID,
        workerName: "Eli Worker",
      },
    });
    expect(approved.data).toEqual({ notificationId: NOTIFICATION_ID, type: NotificationType.SHIFT_REJECTED, timeEntryId: ENTRY_ID, shiftId: SHIFT_ID });
    const wire = JSON.stringify(approved);
    for (const leaked of ["Agorot", "45000", "Eli Worker", "Yossi", "Ayalon", "late", WORKER_PROFILE_ID, "540"]) expect(wire).not.toContain(leaked);
    expect(approved.title).toMatch(ARABIC);
    expect(approved.body).toMatch(ARABIC);
  });

  it("a manager's push about a worker carries no worker id or name either", () => {
    const content = buildPushContent({
      id: NOTIFICATION_ID,
      type: NotificationType.WORKER_CLOCKED_OUT,
      dataJson: { timeEntryId: ENTRY_ID, shiftId: SHIFT_ID, workerProfileId: WORKER_PROFILE_ID, workerName: "Eli Worker", durationMinutes: 600, estimatedCostAgorot: 52_500 },
    });
    expect(content.data).toEqual({ notificationId: NOTIFICATION_ID, type: NotificationType.WORKER_CLOCKED_OUT, timeEntryId: ENTRY_ID, shiftId: SHIFT_ID });
  });

  it("keeps a Turan assignment id and a month, and drops values that are not ids", () => {
    expect(
      buildPushContent({
        id: NOTIFICATION_ID,
        type: NotificationType.TURAN_ASSIGNMENT_CREATED,
        dataJson: { turanAssignmentId: TURAN_ID, turanType: "NIGHT_TURAN", yearMonth: "2026-10", calloutId: "not-an-id", shiftId: 42 },
      }).data,
    ).toEqual({ notificationId: NOTIFICATION_ID, type: NotificationType.TURAN_ASSIGNMENT_CREATED, turanAssignmentId: TURAN_ID, yearMonth: "2026-10" });
    expect(buildPushContent({ id: NOTIFICATION_ID, type: NotificationType.WORKER_APPROVED, dataJson: null }).data).toEqual({
      notificationId: NOTIFICATION_ID,
      type: NotificationType.WORKER_APPROVED,
    });
  });
});

describe("Expo push provider", () => {
  it("builds JSON POSTs to Expo's push API in batches of at most 100, with the access token only when set", () => {
    const messages = Array.from({ length: 205 }, (_, index) => message(index));
    const requests = buildExpoPushRequests(messages);
    expect(requests.map((request) => (JSON.parse(request.init.body) as unknown[]).length)).toEqual([100, 100, 5]);
    for (const request of requests) {
      expect(request.url).toBe(EXPO_PUSH_URL);
      expect(request.url).toBe("https://exp.host/--/api/v2/push/send");
      expect(request.init.method).toBe("POST");
      expect(request.init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    }
    expect(JSON.parse(requests[2].init.body)[4]).toEqual(message(204));
    expect(buildExpoPushRequests([message(0)], "secret-access-token")[0].init.headers.Authorization).toBe("Bearer secret-access-token");
    expect(buildExpoPushRequests([])).toEqual([]);
  });

  it("sends through fetch and reads one ticket per message, keeping only Expo's error code", async () => {
    const fetch = jest.fn(async (_url: string, init: { body: string }) => {
      const batch = JSON.parse(init.body) as PushMessage[];
      return fakeResponse(200, {
        data: batch.map((sent) =>
          sent.to.endsWith("[token-1]")
            ? { status: "error", message: `"${sent.to}" is not a registered push notification recipient`, details: { error: "DeviceNotRegistered" } }
            : { status: "ok", id: `ticket-${sent.to}` },
        ),
      });
    });
    const provider = new ExpoPushProvider(fetch, "access-token");
    const tickets = await provider.send([message(0), message(1), message(2)]);

    expect(tickets).toEqual([{ ok: true }, { ok: false, error: "DeviceNotRegistered" }, { ok: true }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }];
    expect(url).toBe(EXPO_PUSH_URL);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer access-token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual([message(0), message(1), message(2)]);
    // The ticket error never carries Expo's message (it quotes the token).
    expect(JSON.stringify(tickets)).not.toContain("ExponentPushToken");
  });

  it("splits 150 messages into two requests and keeps the tickets in order", async () => {
    const fetch = jest.fn(async (_url: string, init: { body: string }) =>
      fakeResponse(200, { data: (JSON.parse(init.body) as unknown[]).map(() => ({ status: "ok", id: "x" })) }),
    );
    const tickets = await new ExpoPushProvider(fetch).send(Array.from({ length: 150 }, (_, index) => message(index)));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(tickets).toHaveLength(150);
    expect(tickets.every((ticket) => ticket.ok)).toBe(true);
    expect((fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1].headers.Authorization).toBeUndefined();
  });

  it("throws on 429 / 5xx (the delivery job retries) and records other refusals as tickets", async () => {
    await expect(new ExpoPushProvider(jest.fn(async () => fakeResponse(503, {}))).send([message(0)])).rejects.toThrow(/503/);
    await expect(new ExpoPushProvider(jest.fn(async () => fakeResponse(429, {}))).send([message(0)])).rejects.toThrow(/429/);
    expect(await new ExpoPushProvider(jest.fn(async () => fakeResponse(400, { errors: [{ code: "VALIDATION_ERROR" }] }))).send([message(0), message(1)])).toEqual([
      { ok: false, error: "HTTP_400" },
      { ok: false, error: "HTTP_400" },
    ]);
  });

  it("reads malformed ticket answers as failures", () => {
    expect(readExpoTickets({ data: [{ status: "ok" }] }, 2)).toEqual([{ ok: true }, { ok: false, error: "UNKNOWN" }]);
    expect(readExpoTickets(null, 1)).toEqual([{ ok: false, error: "UNKNOWN" }]);
    expect(readExpoTickets({ data: [{ status: "error", details: { error: 42 } }] }, 1)).toEqual([{ ok: false, error: "UNKNOWN" }]);
  });

  it("the log provider sends nothing, answers ok for every device and never logs a token or the text", async () => {
    const provider = new LogPushProvider();
    const logged: string[] = [];
    jest.spyOn((provider as unknown as { logger: { log: (line: string) => void } }).logger, "log").mockImplementation((line: string) => {
      logged.push(line);
    });
    expect(await provider.send([message(0), message(1)])).toEqual([{ ok: true }, { ok: true }]);
    provider.skipped({ id: NOTIFICATION_ID, type: NotificationType.SHIFT_REJECTED }, "PUSH_DISABLED");
    expect(logged).toEqual([
      `[DEV PUSH] SHIFT_APPROVED (notification ${NOTIFICATION_ID}) to 2 device(s)`,
      `[DEV PUSH] SHIFT_REJECTED (notification ${NOTIFICATION_ID}) not sent: PUSH_DISABLED`,
    ]);
    expect(logged.join("\n")).not.toMatch(/ExponentPushToken|token-|التفاصيل/);
  });
});

describe("resolvePushProviderKind (PUSH_PROVIDER)", () => {
  it("defaults to log and accepts expo, case-insensitively", () => {
    expect(resolvePushProviderKind({})).toBe("log");
    expect(resolvePushProviderKind({ PUSH_PROVIDER: "" })).toBe("log");
    expect(resolvePushProviderKind({ PUSH_PROVIDER: " Expo " })).toBe("expo");
    expect(resolvePushProviderKind({ PUSH_PROVIDER: "log" })).toBe("log");
  });

  it("refuses anything else", () => {
    expect(() => resolvePushProviderKind({ PUSH_PROVIDER: "firebase" })).toThrow(/PUSH_PROVIDER must be one of log, expo/);
  });
});
