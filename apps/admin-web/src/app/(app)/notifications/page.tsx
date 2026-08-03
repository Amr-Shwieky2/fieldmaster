"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

export default function NotificationsPage() {
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({ queryKey: ["notifications"], queryFn: () => client.listNotifications() });

  const markRead = useMutation({
    mutationFn: (id: string) => client.markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
        <p className="text-sm text-slate-500">Clock-ins, approvals, emergencies, and payroll events.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {notificationsQuery.isLoading && <LoadingState />}
          {notificationsQuery.isError && <ErrorState message={(notificationsQuery.error as Error).message} />}
          {notificationsQuery.data && notificationsQuery.data.length === 0 && <EmptyState title="No notifications yet" />}
          <ul>
            {(notificationsQuery.data ?? []).map((n) => (
              <li
                key={n.id}
                className={cn("flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0", !n.readAt && "bg-brand-50/40")}
              >
                <div>
                  <div className="flex items-center gap-2">
                    {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden />}
                    <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{n.body}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                </div>
                {!n.readAt && (
                  <button
                    className="shrink-0 text-xs font-medium text-brand-600 hover:underline"
                    onClick={() => markRead.mutate(n.id)}
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
