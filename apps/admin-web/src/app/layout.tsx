import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LOCALE_COOKIE, localeDirection, resolveLocale } from "@/i18n/config";
import "./globals.css";
import { Providers } from "./providers";

// Arabic-first UI font. It also carries Latin glyphs; the fallback stack covers
// anything it lacks.
const plexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex-sans-arabic",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

/**
 * `lang` and `dir` are rendered on the server from the `fm_locale` cookie, so
 * the first HTML the browser receives is already right-to-left for Arabic.
 * Nothing on the client rewrites them, so there is no hydration mismatch.
 * Switching language writes the cookie and refreshes this server tree.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} dir={localeDirection(locale)} className={plexSansArabic.variable}>
      <body className="font-sans">
        {/* Inherits locale (ar-u-nu-latn / en-u-nu-latn), messages and time zone from src/i18n/request.ts. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
