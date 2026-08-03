"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

export default function ShiftsPage() {
  const { client } = useAuth();
  const shiftsQuery = useQuery({ queryKey: ["shifts"], queryFn: () => client.listShifts() });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Scheduling</h1>
          <p className="text-sm text-slate-500">Shifts, Turan, and assignments.</p>
        </div>
        <Link href="/shifts/new">
          <Button>New shift</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shifts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {shiftsQuery.isLoading && <LoadingState />}
          {shiftsQuery.isError && <ErrorState message={(shiftsQuery.error as Error).message} />}
          {shiftsQuery.data && shiftsQuery.data.length === 0 && <EmptyState title="No shifts yet" description="Create the first shift to get started." />}
          {shiftsQuery.data && shiftsQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Start</th>
                    <th className="px-5 py-3">End</th>
                    <th className="px-5 py-3">Assigned</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shiftsQuery.data.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/shifts/${s.id}`} className="font-medium text-brand-700 hover:underline">
                          {s.title}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{s.shiftType.replace("_", " ")}</td>
                      <td className="px-5 py-3 text-slate-600">{formatDateTime(s.scheduledStart)}</td>
                      <td className="px-5 py-3 text-slate-600">{formatDateTime(s.scheduledEnd)}</td>
                      <td className="px-5 py-3 text-slate-600">{s.assignments?.length ?? 0}</td>
                      <td className="px-5 py-3">
                        <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
