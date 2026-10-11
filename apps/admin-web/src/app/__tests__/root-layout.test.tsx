import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The root layout is a server component that loads the font through
// next/font. Stub it, plus the next-intl provider (which only passes config
// through on the server). The layout must not depend on cookies or headers:
// the app is Arabic only.
vi.mock("next/headers", () => ({
  cookies: async () => {
    throw new Error("the root layout must not read cookies: the app is Arabic only");
  },
}));
vi.mock("next/font/google", () => ({ IBM_Plex_Sans_Arabic: () => ({ variable: "font-plex-sans-arabic" }) }));
vi.mock("next-intl", () => ({ NextIntlClientProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("../providers", () => ({ Providers: ({ children }: { children: ReactNode }) => children }));

import RootLayout from "../layout";

describe("RootLayout first server render", () => {
  it("is always Arabic and right-to-left", () => {
    const html = renderToStaticMarkup(RootLayout({ children: <p>content</p> }));
    expect(html).toContain('<html lang="ar" dir="rtl"');
    expect(html).toContain("<p>content</p>");
  });

  it("uses the Arabic font", () => {
    const html = renderToStaticMarkup(RootLayout({ children: null }));
    expect(html).toContain('class="font-plex-sans-arabic"');
    expect(html).toContain('<body class="font-sans">');
  });
});
