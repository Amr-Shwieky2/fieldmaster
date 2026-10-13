import { vi } from "vitest";
import { OrgRole } from "@fieldmaster/shared-types";
import { sessionStore } from "@/lib/session-store";

/**
 * `fetch` routed per "METHOD /path" for page tests that run the real
 * api-client (and, for signed-in pages, the real AuthProvider).
 */

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function apiError(status: number, code: string, message = "English API message", details: Record<string, unknown> = {}) {
  return json(status, { statusCode: status, code, message, details, correlationId: "c-1" });
}

/** Receives the request (and its URL, for query parameters such as `?format=pdf`). */
export type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;
export type FetchMock = ReturnType<typeof mockApi>;

/** Routes `fetch` by "METHOD /path" (the path after /api/v1, without the query). Unknown routes answer 500. */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^.*\/api\/v1/, "");
    const handler = routes[`${init?.method ?? "GET"} ${path}`];
    return handler ? handler(init, url) : apiError(500, "INTERNAL_ERROR", `unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

export interface RecordedRequest {
  url: URL;
  /** The parsed JSON body, or the FormData of a multipart upload. */
  body: unknown;
  headers: Record<string, string>;
}

/** The requests made to one route (path without the query). */
export function requestsTo(fetchMock: FetchMock, method: string, path: string): RecordedRequest[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => (init?.method ?? "GET") === method && new URL(String(input)).pathname.endsWith(`/api/v1${path}`))
    .map(([input, init]) => ({
      url: new URL(String(input)),
      body: init?.body instanceof FormData ? init.body : init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    }));
}

/** The paths requested so far (after /api/v1, without the query), in order. */
export function requestedPaths(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${new URL(String(input)).pathname.replace(/^.*\/api\/v1/, "")}`);
}

export function seedSession(role: OrgRole) {
  sessionStore.save({ accessToken: "test-access", refreshToken: "test-refresh", organizationId: "org-1", role, workerProfileId: null });
}

/** Attributes a user reads (tooltip, placeholder) or hears from a screen reader (accessible name, alt text). */
const READABLE_ATTRIBUTES = ["aria-label", "aria-valuetext", "title", "placeholder", "alt"];

/** Distinct Latin-script words on the page, read per text node (so adjacent elements do not merge) and per readable attribute. */
export function latinWordsOnPage(): { text: string[]; attributes: string[] } {
  const collect = (values: Iterable<string | null>) => {
    const words = new Set<string>();
    for (const value of values) for (const word of value?.match(/[A-Za-z]+/g) ?? []) words.add(word);
    return [...words].sort();
  };
  const texts: (string | null)[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node.textContent);
  const attributes = [...document.body.querySelectorAll("*")].flatMap((el) => READABLE_ATTRIBUTES.map((name) => el.getAttribute(name)));
  return { text: collect(texts), attributes: collect(attributes) };
}

/** Collapses the whitespace of an element's text (cells hold several inline elements). */
export function textOf(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A UUID v4 (an Idempotency-Key). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True when any Arabic-Indic digit is on screen (the app must show 0-9 only). */
export function hasArabicIndicDigits(text: string | null | undefined): boolean {
  return /[٠-٩۰-۹]/.test(text ?? "");
}
