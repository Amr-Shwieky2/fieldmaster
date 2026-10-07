import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { FullPageMessage } from "@/components/full-page-message";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("states");
  return { title: t("pageNotFoundTitle") };
}

/** Replaces Next's built-in English 404 page; rendered inside the root layout, so lang/dir are set. */
export default async function NotFound() {
  const t = await getTranslations("states");
  return <FullPageMessage title={t("pageNotFoundTitle")} description={t("pageNotFoundDescription")} linkLabel={t("goToDashboard")} />;
}
