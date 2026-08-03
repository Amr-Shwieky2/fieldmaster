export function formatAgorot(agorot: number | null | undefined): string {
  if (agorot === null || agorot === undefined) return "—";
  return `₪${(agorot / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IL", { timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short" });
}
