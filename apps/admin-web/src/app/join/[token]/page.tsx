import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { JoinPage } from "@/components/join/join-page";

/**
 * The public page a worker opens from an invitation link (no login, outside
 * the app shell). Its URL carries the invitation token, so the page is kept
 * out of search engines and never sends it on as a referrer.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("join");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function JoinRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinPage token={token} />;
}
