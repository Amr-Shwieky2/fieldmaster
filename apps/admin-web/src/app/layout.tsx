import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { APP_DIRECTION, APP_LOCALE } from "@fieldmaster/i18n";
import "./globals.css";
import { Providers } from "./providers";

// Arabic UI font. It also carries Latin glyphs (names, codes); the fallback
// stack covers anything it lacks.
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
 * The app is Arabic only: every page is rendered with `lang="ar" dir="rtl"`
 * from the first HTML the browser receives, so there is nothing for the
 * client to change and no hydration mismatch.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={APP_LOCALE} dir={APP_DIRECTION} className={plexSansArabic.variable}>
      <body className="font-sans">
        {/* Inherits locale (ar-u-nu-latn), messages and time zone from src/i18n/request.ts. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
