import type { ReactElement, ReactNode } from "react";
import { render, renderHook, type RenderHookResult, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { APP_DIRECTION, APP_LOCALE, BUSINESS_TIME_ZONE, INTL_LOCALE } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";

/**
 * Test helpers for components that use next-intl (the app is Arabic only).
 *
 *   import { renderWithIntl } from "@/test/render-with-intl";
 *
 *   renderWithIntl(<WorkersPage />);                      // real ar.json
 *   renderWithIntl(<WorkersPage />, { queryClient: true });
 *   renderWithIntl(<Page />, { messages: { workers: { title: "..." } } }); // extra/overriding messages
 *
 * - Wraps the UI in `NextIntlClientProvider` with the REAL ar.json (so tests
 *   exercise the shipped Arabic copy), the `ar-u-nu-latn` locale and the
 *   business time zone Asia/Jerusalem, exactly like the app.
 * - `messages` is deep-merged over the real messages.
 * - `queryClient: true` adds a `QueryClientProvider` with a fresh no-retry
 *   client; pass your own `QueryClient` to inspect it.
 * - Strict by default: a missing translation or bad ICU argument THROWS, so a
 *   typo in a key fails the test instead of rendering the key path. Set
 *   `strict: false` to fall back to next-intl's default console error.
 * - Also sets `document.documentElement.lang` / `dir` like the root layout,
 *   and wraps the UI in a `<div dir="rtl">` so `dir` assertions behave as in
 *   the browser.
 */

export interface RenderWithIntlOptions {
  /** Extra / overriding messages, deep-merged over ar.json. */
  messages?: AbstractIntlMessages;
  /** `true` for a fresh QueryClient (retries off), or pass your own. */
  queryClient?: boolean | QueryClient;
  /** Throw on missing messages (default true). */
  strict?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively merges `override` over `base` without mutating either. */
export function deepMerge(base: AbstractIntlMessages, override: AbstractIntlMessages): AbstractIntlMessages {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing as AbstractIntlMessages, value as AbstractIntlMessages) : value;
  }
  return result as AbstractIntlMessages;
}

/** The real Arabic messages, optionally with extra namespaces merged in. */
export function getTestMessages(extra?: AbstractIntlMessages): AbstractIntlMessages {
  return extra ? deepMerge(ar, extra) : ar;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

/** A React wrapper component with the same providers `renderWithIntl` uses (for `renderHook` / `render({ wrapper })`). */
export function createIntlWrapper(options: RenderWithIntlOptions = {}) {
  const { messages, queryClient, strict = true } = options;
  const client = queryClient === true ? createTestQueryClient() : queryClient || null;

  document.documentElement.lang = APP_LOCALE;
  document.documentElement.dir = APP_DIRECTION;

  return function IntlWrapper({ children }: { children: ReactNode }) {
    const tree = (
      <NextIntlClientProvider
        locale={INTL_LOCALE}
        messages={getTestMessages(messages)}
        timeZone={BUSINESS_TIME_ZONE}
        onError={
          strict
            ? (error) => {
                throw error;
              }
            : undefined
        }
      >
        <div dir={APP_DIRECTION}>{children}</div>
      </NextIntlClientProvider>
    );
    return client ? <QueryClientProvider client={client}>{tree}</QueryClientProvider> : tree;
  };
}

/** `render()` inside the intl (and optional react-query) providers. */
export function renderWithIntl(ui: ReactElement, options: RenderWithIntlOptions = {}): RenderResult {
  return render(ui, { wrapper: createIntlWrapper(options) });
}

/** `renderHook()` inside the same providers. */
export function renderHookWithIntl<Result, Props>(hook: (props: Props) => Result, options: RenderWithIntlOptions = {}): RenderHookResult<Result, Props> {
  return renderHook(hook, { wrapper: createIntlWrapper(options) });
}
