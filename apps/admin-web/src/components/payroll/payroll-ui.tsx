"use client";

import type { ReactNode } from "react";
import type { PayrollVersionDetail } from "@fieldmaster/api-client";
import { cn } from "@/lib/cn";
import { useFormat } from "@/lib/use-format";
import { LtrText, Money } from "@/components/formatted";

/** Shared look of the payroll tables (numbers aligned to the inline end). */
export const TABLE_WRAPPER = "relative overflow-x-auto";
export const THEAD = "border-b border-slate-200 bg-slate-50 text-xs text-slate-500";
export const TH = "px-4 py-3 text-start font-medium";
export const TH_NUMBER = "px-4 py-3 text-end font-medium";
export const ROW = "border-b border-slate-100 last:border-0";
export const TD = "px-4 py-3 text-start text-slate-700";
export const TD_NUMBER = "whitespace-nowrap px-4 py-3 text-end text-slate-700";

// Wide tables: the first column (the worker) sticks to the inline-start edge while the figures scroll.
export const STICKY_HEAD = "sticky start-0 z-10 bg-slate-50";
export const STICKY_CELL = "sticky start-0 z-10 bg-white";

/** A version has results to show: its calculation, or the net per worker a legacy version stored. */
export function hasResults(detail: Pick<PayrollVersionDetail, "totals" | "legacyNetByWorker" | "workers">): boolean {
  return detail.totals !== null || detail.legacyNetByWorker !== null || detail.workers.length > 0;
}

/** An amount added to the pay: `+₪ 50.00` in green; `₪ 0.00` when there is none. */
export function AddedMoney({ agorot, className }: { agorot: number; className?: string }) {
  const format = useFormat();
  if (agorot === 0) return <Money agorot={0} className={cn("text-slate-400", className)} />;
  return <LtrText className={cn("text-emerald-700", className)}>+{format.money(agorot)}</LtrText>;
}

/** An amount deducted from the pay (given as a positive number): `-₪ 25.00` in red; `₪ 0.00` when there is none. */
export function DeductedMoney({ agorot, className }: { agorot: number; className?: string }) {
  if (agorot === 0) return <Money agorot={0} className={cn("text-slate-400", className)} />;
  return <Money agorot={-agorot} className={cn("text-red-700", className)} />;
}

/** A signed amount: positive adds (green, `+`), negative deducts (red, `-`). */
export function SignedMoney({ agorot, className }: { agorot: number; className?: string }) {
  return agorot < 0 ? <DeductedMoney agorot={-agorot} className={className} /> : <AddedMoney agorot={agorot} className={className} />;
}

const NOTE_TONES = {
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900",
  neutral: "border-slate-300 bg-slate-100 text-slate-800",
} as const;

/** A banner about the version on screen (a warning, a count, a read-only notice). */
export function Note({ tone, children, className }: { tone: keyof typeof NOTE_TONES; children: ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("space-y-2 rounded-md border px-4 py-3 text-sm", NOTE_TONES[tone], className)}>
      {children}
    </div>
  );
}
