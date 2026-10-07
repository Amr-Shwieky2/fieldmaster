import type { ReactElement, ReactNode } from "react";
import { render, renderHook, type RenderHookResult, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Locale } from "@/i18n/config";
import { BUSINESS_TIME_ZONE, INTL_LOCALE, localeDirection } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";

/**
 * Test helpers for components that use next-intl.
 *
 *   import { renderWithIntl } from "@/test/render-with-intl";
 *
 *   renderWithIntl(<WorkersPage />, { locale: "ar" });          // real ar.json
 *   renderWithIntl(<WorkersPage />, { locale: "en", queryClient: true });
 *   renderWithIntl(<Page />, { messages: { workers: { title: "Workers" } } }); // extra namespaces
 *
 * - Wraps the UI in `NextIntlClientProvider` with the REAL ar.json / en.json
 *   (so tests exercise the shipped Arabic and English copy) and the business
 *   time zone Asia/Jerusalem.
 * - `messages` is deep-merged over the real messages. Use it for namespaces
 *   that are not merged into ar.json / en.json yet (page fragments).
 * - `queryClient: true` adds a `QueryClientProvider` with a fresh no-retry
 *   client; pass your own `QueryClient` to inspect it.
 * - Strict by default: a missing translation or bad ICU argument THROWS, so a
 *   typo in a key fails the test instead of rendering the key path. Set
 *   `strict: false` to fall back to next-intl's default console error.
 * - Also sets `document.documentElement.lang` / `dir` like the root layout.
 * - Wrapped in an `<div dir>` too, so `getByRole`-style queries and `dir`
 *   assertions behave as in the browser.
 */

export interface RenderWithIntlOptions {
  /** Default `"ar"` (the product default). */
  locale?: Locale;
  /** Extra / overriding messages, deep-merged over the real files. */
  messages?: AbstractIntlMessages;
  /** `true` for a fresh QueryClient (retries off), or pass your own. */
  queryClient?: boolean | QueryClient;
  /** Throw on missing messages (default true). */
  strict?: boolean;
}

const REAL_MESSAGES: Record<Locale, AbstractIntlMessages> = { ar, en };

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

/** The real messages for a locale, optionally with extra namespaces merged in. */
export function getTestMessages(locale: Locale, extra?: AbstractIntlMessages): AbstractIntlMessages {
  return extra ? deepMerge(REAL_MESSAGES[locale], extra) : REAL_MESSAGES[locale];
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
}

/** A React wrapper component with the same providers `renderWithIntl` uses (for `renderHook` / `render({ wrapper })`). */
export function createIntlWrapper(options: RenderWithIntlOptions = {}) {
  const { locale = "ar", messages, queryClient, strict = true } = options;
  const client = queryClient === true ? createTestQueryClient() : queryClient || null;

  document.documentElement.lang = locale;
  document.documentElement.dir = localeDirection(locale);

  return function IntlWrapper({ children }: { children: ReactNode }) {
    const tree = (
      <NextIntlClientProvider
        locale={INTL_LOCALE[locale]}
        messages={getTestMessages(locale, messages)}
        timeZone={BUSINESS_TIME_ZONE}
        onError={
          strict
            ? (error) => {
                throw error;
              }
            : undefined
        }
      >
        <div dir={localeDirection(locale)}>{children}</div>
      </NextIntlClientProvider>
    );
    return client ? <QueryClientProvider client={client}>{tree}</QueryClientProvider> : tree;
  };
}

/** `render()` inside the intl (and optional react-query) providers. */
export function renderWithIntl(ui: ReactElement, options: RenderWithIntlOptions = {}): RenderResult & { locale: Locale } {
  const locale = options.locale ?? "ar";
  return Object.assign(render(ui, { wrapper: createIntlWrapper({ ...options, locale }) }), { locale });
}

/** `renderHook()` inside the same providers. */
export function renderHookWithIntl<Result, Props>(hook: (props: Props) => Result, options: RenderWithIntlOptions = {}): RenderHookResult<Result, Props> {
  return renderHook(hook, { wrapper: createIntlWrapper(options) });
}
