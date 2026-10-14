import { useEffect, useState } from "react";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A running timer: "01:05:09" (hours:minutes:seconds), Western digits; never negative. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}

/** A short recording: "02:59" (minutes:seconds), Western digits; never negative. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** `Date.now()`, refreshed every `intervalMs` while `active` (a live timer re-renders with it). */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs, active]);
  return now;
}
