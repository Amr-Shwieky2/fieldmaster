import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/** One figure with its label and an optional hint (counts, durations) below it. */
export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
        {hint ? <div className="mt-1 space-y-0.5 text-xs text-slate-500">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
