import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The root layout is a server component: it reads the locale cookie through
// next/headers and loads the font through next/font. Stub both, plus the
// next-intl provider (which only passes config through on the server).
const cookieValue = { current: undefined as string | undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "fm_locale" && cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/font/google", () => ({ IBM_Plex_Sans_Arabic: () => ({ variable: "font-plex-sans-arabic" }) }));
vi.mock("next-intl", () => ({ NextIntlClientProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("../providers", () => ({ Providers: ({ children }: { children: ReactNode }) => children }));

import RootLayout from "../layout";

async function firstServerRender(cookie: string | undefined) {
  cookieValue.current = cookie;
  return renderToStaticMarkup(await RootLayout({ children: <p>content</p> }));
}

describe("RootLayout first server render", () => {
  beforeEach(() => {
    cookieValue.current = undefined;
  });

  it("is Arabic and right-to-left by default (no cookie)", async () => {
    expect(await firstServerRender(undefined)).toContain('<html lang="ar" dir="rtl"');
  });

  it("is Arabic and right-to-left with fm_locale=ar", async () => {
    expect(await firstServerRender("ar")).toContain('<html lang="ar" dir="rtl"');
  });

  it("is English and left-to-right with fm_locale=en", async () => {
    expect(await firstServerRender("en")).toContain('<html lang="en" dir="ltr"');
  });

  it("ignores an unsupported locale such as Hebrew and falls back to Arabic", async () => {
    expect(await firstServerRender("he")).toContain('<html lang="ar" dir="rtl"');
  });
});
