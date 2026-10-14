import { Logger } from "@nestjs/common";
import type { PushData } from "./push-content";

/** One push to one device (an Expo push message). */
export interface PushMessage {
  /** The device's Expo push token. Never logged. */
  to: string;
  title: string;
  body: string;
  data: PushData;
  sound: "default";
  /** The Android notification channel the app creates ("default"); ignored on iOS. */
  channelId: typeof PUSH_ANDROID_CHANNEL_ID;
}

/** The Android channel the mobile app creates for every FieldMaster notification. */
export const PUSH_ANDROID_CHANNEL_ID = "default";

/** What happened to each message, in the order they were given. `error` is a provider code (e.g. DeviceNotRegistered), never text. */
export type PushTicket = { ok: true } | { ok: false; error: string };

export interface PushProvider {
  readonly name: PushProviderKind;
  /** The NotificationDelivery channel its deliveries are recorded under. */
  readonly channel: string;
  /** Throws only when nothing could be sent at all (the delivery job retries); per-message failures are tickets. */
  send(messages: readonly PushMessage[]): Promise<PushTicket[]>;
  /** A notification that is not sent (push switched off, no device with a token); the development provider says so in the log. */
  skipped?(notification: { id: string; type: string }, reason: string): void;
}

/** Injection token of the configured push provider (PUSH_PROVIDER). */
export const PUSH_PROVIDER = Symbol("PUSH_PROVIDER");

export const PUSH_PROVIDERS = ["log", "expo"] as const;
export type PushProviderKind = (typeof PUSH_PROVIDERS)[number];

/** PUSH_PROVIDER: `log` (default: development, tests) or `expo` (Expo's push service, which delivers through FCM / APNs). */
export function resolvePushProviderKind(env: NodeJS.ProcessEnv = process.env): PushProviderKind {
  const raw = env.PUSH_PROVIDER?.trim().toLowerCase();
  if (!raw) return "log";
  if (!(PUSH_PROVIDERS as readonly string[]).includes(raw)) {
    throw new Error(`PUSH_PROVIDER must be one of ${PUSH_PROVIDERS.join(", ")} (got "${env.PUSH_PROVIDER}").`);
  }
  return raw as PushProviderKind;
}

/**
 * Development and tests: nothing leaves the API. Logs one line per
 * notification -- its type, its id, and how many devices it went to or why it
 * was not sent -- and never a push token or the text.
 */
export class LogPushProvider implements PushProvider {
  readonly name = "log" as const;
  readonly channel = "PUSH_LOG";
  private readonly logger = new Logger("Push");

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const first = messages[0];
    if (first) this.logger.log(`[DEV PUSH] ${first.data.type} (notification ${first.data.notificationId}) to ${messages.length} device(s)`);
    return messages.map(() => ({ ok: true }));
  }

  skipped(notification: { id: string; type: string }, reason: string): void {
    this.logger.log(`[DEV PUSH] ${notification.type} (notification ${notification.id}) not sent: ${reason}`);
  }
}

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
export const EXPO_PUSH_BATCH_SIZE = 100;
export const EXPO_PUSH_TIMEOUT_MS = 10_000;

export interface PushHttpRequest {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
}

/** The requests that send `messages` through Expo's push API: batches of at most 100, JSON, with the access token when one is set. */
export function buildExpoPushRequests(messages: readonly PushMessage[], accessToken?: string): PushHttpRequest[] {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const requests: PushHttpRequest[] = [];
  for (let start = 0; start < messages.length; start += EXPO_PUSH_BATCH_SIZE) {
    requests.push({ url: EXPO_PUSH_URL, init: { method: "POST", headers, body: JSON.stringify(messages.slice(start, start + EXPO_PUSH_BATCH_SIZE)) } });
  }
  return requests;
}

type FetchLike = (url: string, init: PushHttpRequest["init"] & { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Reads Expo's push tickets: `{ data: [{ status: "ok" } | { status: "error", details: { error } }] }`. Only the error code is kept (Expo's message can quote the token). */
export function readExpoTickets(body: unknown, count: number): PushTicket[] {
  const data = body !== null && typeof body === "object" && Array.isArray((body as { data?: unknown }).data) ? ((body as { data: unknown[] }).data) : [];
  return Array.from({ length: count }, (_, index) => {
    const ticket = data[index] as { status?: unknown; details?: { error?: unknown } } | undefined;
    if (ticket?.status === "ok") return { ok: true } as const;
    const code = typeof ticket?.details?.error === "string" ? ticket.details.error : "UNKNOWN";
    return { ok: false, error: code } as const;
  });
}

/**
 * Expo's push service (`POST https://exp.host/--/api/v2/push/send`). The
 * optional EXPO_ACCESS_TOKEN is sent when the Expo project requires it
 * ("enhanced push security"). A transport failure throws, so the delivery
 * job retries; a refused message is a ticket with Expo's error code.
 */
export class ExpoPushProvider implements PushProvider {
  readonly name = "expo" as const;
  readonly channel = "PUSH_EXPO";

  constructor(
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly accessToken: string | undefined = process.env.EXPO_ACCESS_TOKEN || undefined,
  ) {}

  async send(messages: readonly PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    const requests = buildExpoPushRequests(messages, this.accessToken);
    for (const [index, request] of requests.entries()) {
      const batchSize = Math.min(EXPO_PUSH_BATCH_SIZE, messages.length - index * EXPO_PUSH_BATCH_SIZE);
      const response = await this.fetchImpl(request.url, { ...request.init, signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS) });
      if (!response.ok) {
        // 429 / 5xx: worth retrying the whole delivery; any other status will not get better.
        if (response.status === 429 || response.status >= 500) throw new Error(`Expo push service answered ${response.status}.`);
        tickets.push(...Array.from({ length: batchSize }, () => ({ ok: false, error: `HTTP_${response.status}` }) as const));
        continue;
      }
      tickets.push(...readExpoTickets(await response.json(), batchSize));
    }
    return tickets;
  }
}
