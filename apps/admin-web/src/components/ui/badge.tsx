import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const TONE_CLASSES = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
} as const;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONE_CLASSES;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONE_CLASSES[tone], className)} {...props} />;
}

export function statusTone(status: string): keyof typeof TONE_CLASSES {
  if (["APPROVED", "ACTIVE", "FINALIZED", "COMPLETED", "PASSED"].includes(status)) return "success";
  if (["PENDING_APPROVAL", "REVIEW", "SCHEDULED", "FLAGGED", "CALCULATING"].includes(status)) return "warning";
  if (["REJECTED", "CANCELLED", "BLOCKED", "MISSED"].includes(status)) return "danger";
  return "neutral";
}
