import { cn } from "@/lib/cn";

/**
 * Direction-aware icons. Drawn pointing to the inline END side in LTR and
 * mirrored with `rtl:-scale-x-100`, so "forward" always points the way the
 * text reads. Decorative by default (aria-hidden); label the button instead.
 */

export function ChevronEndIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cn("h-4 w-4 shrink-0 rtl:-scale-x-100", className)}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronStartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cn("h-4 w-4 shrink-0 rtl:-scale-x-100", className)}>
      <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowEndIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cn("h-4 w-4 shrink-0 rtl:-scale-x-100", className)}>
      <path d="M4 10h12m-4.5-4.5L16 10l-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowStartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={cn("h-4 w-4 shrink-0 rtl:-scale-x-100", className)}>
      <path d="M16 10H4m4.5-4.5L4 10l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
