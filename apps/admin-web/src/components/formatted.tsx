"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EM_DASH } from "@/lib/format";
import { useFormat } from "@/lib/use-format";

/**
 * Bidi-safe display of values that must read left-to-right even inside an
 * Arabic sentence: money (`₪ 1,234.50`), phone numbers (`+972...`), times,
 * dates, durations, ids and codes. Without the isolate, an RTL paragraph
 * reorders them (`+972500000001` would render as `972500000001+`).
 */
export function LtrText({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("whitespace-nowrap", className)} style={{ unicodeBidi: "isolate" }}>
      {children}
    </bdi>
  );
}

export function Money({ agorot, className }: { agorot: number | null | undefined; className?: string }) {
  return <LtrText className={className}>{useFormat().money(agorot)}</LtrText>;
}

export function Phone({ value, className }: { value: string | null | undefined; className?: string }) {
  return <LtrText className={className}>{value || EM_DASH}</LtrText>;
}

export function DateTimeText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <bdi className={cn("whitespace-nowrap", className)}>{useFormat().dateTime(value)}</bdi>;
}

export function DateText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <bdi className={cn("whitespace-nowrap", className)}>{useFormat().date(value)}</bdi>;
}

export function BusinessDateText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <bdi className={cn("whitespace-nowrap", className)}>{useFormat().businessDate(value)}</bdi>;
}

export function TimeText({ value, className }: { value: string | null | undefined; className?: string }) {
  return <LtrText className={className}>{useFormat().time(value)}</LtrText>;
}

export function MinutesText({ minutes, className }: { minutes: number | null | undefined; className?: string }) {
  return <bdi className={cn("whitespace-nowrap", className)}>{useFormat().minutes(minutes)}</bdi>;
}

export function MonthText({ yearMonth, className }: { yearMonth: string | null | undefined; className?: string }) {
  return <bdi className={cn("whitespace-nowrap", className)}>{useFormat().month(yearMonth)}</bdi>;
}
