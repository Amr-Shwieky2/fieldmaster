"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LtrText } from "@/components/formatted";
import { useFormat } from "@/lib/use-format";

/**
 * A pay rate such as "₪ 400.00 يوميًا" / "₪ 400.00/day". The amount stays an
 * integer number of agorot and is wrapped in an LTR isolate so it keeps its
 * order inside Arabic text.
 */
export function RateText({ agorot, per }: { agorot: number | null | undefined; per: "day" | "hour" }) {
  const t = useTranslations("workers");
  const format = useFormat();
  const ltr = (chunks: ReactNode) => <LtrText>{chunks}</LtrText>;
  const amount = format.money(agorot);
  return <>{per === "day" ? t.rich("rate.perDay", { amount, ltr }) : t.rich("rate.perHour", { amount, ltr })}</>;
}
