"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFormatter, useNow, useTranslations } from "next-intl";
import type { NotificationItem } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { useFormat } from "@/lib/use-format";
import { useErrorMessage } from "@/lib/use-error-message";
import { renderNotificationText } from "@/lib/notification-text";
import { useAppLocale } from "@/i18n/use-app-locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { DateTimeText } from "@/components/formatted";
import { cn } from "@/lib/cn";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

export default function NotificationsPage() {
  const t = useTranslations("notifications");
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const fmt = useFormat();
  const [announcement, setAnnouncement] = useState("");
  // One clock for every row's relative time ("5 minutes ago"), refreshed each minute.
  const now = useNow({ updateInterval: 60_000 });
  const notificationsQuery = useQuery({ queryKey: ["notifications"], queryFn: () => client.listNotifications() });

  const markRead = useMutation({
    mutationFn: (id: string) => client.markNotificationRead(id),
    onSuccess: () => {
      setAnnouncement(t("markedRead"));
      return queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => setAnnouncement(""),
  });

  const notifications = notificationsQuery.data ?? [];
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("title")} description={t("description")} />

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {markRead.isError ? (
        <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">{t("markReadFailed")}</p>
          <p>{errorMessage(markRead.error)}</p>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <CardTitle>{t("activity")}</CardTitle>
          {unreadCount > 0 ? <Badge tone="info">{t("unreadCount", { count: fmt.number(unreadCount) })}</Badge> : null}
        </CardHeader>
        <CardContent className="p-0">
          {notificationsQuery.isLoading ? (
            <LoadingState label={t("loading")} />
          ) : notificationsQuery.isError ? (
            <ErrorState error={notificationsQuery.error} onRetry={() => notificationsQuery.refetch()} />
          ) : notifications.length === 0 ? (
            <EmptyState title={t("empty.title")} description={t("empty.description")} />
          ) : (
            <ul aria-label={t("listLabel")}>
              {notifications.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  now={now}
                  isMarking={markRead.isPending && markRead.variables === n.id}
                  onMarkRead={() => markRead.mutate(n.id)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationRow({
  notification,
  now,
  isMarking,
  onMarkRead,
}: {
  notification: NotificationItem;
  now: Date;
  isMarking: boolean;
  onMarkRead: () => void;
}) {
  const t = useTranslations("notifications");
  const fmt = useFormat();
  const locale = useAppLocale();
  const intl = useFormatter();
  // English may show the stored English text for old notifications without data; Arabic never does.
  const text = renderNotificationText(t, fmt, notification, { storedTextFallback: locale === "en" });
  const titleId = `notification-${notification.id}-title`;
  const isUnread = !notification.readAt;

  return (
    <li className={cn("flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 last:border-0", isUnread && "bg-brand-50/40")}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {isUnread ? (
            <>
              <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-hidden />
              <span className="sr-only">{t("unread")}</span>
            </>
          ) : null}
          <p id={titleId} className="text-sm font-medium text-slate-900">
            {text.title}
          </p>
        </div>
        <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-600">{text.body}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
          <time dateTime={notification.createdAt}>{intl.relativeTime(new Date(notification.createdAt), now)}</time>
          <span aria-hidden>·</span>
          <DateTimeText value={notification.createdAt} />
        </p>
      </div>
      {isUnread ? (
        <Button variant="ghost" size="sm" className="shrink-0 text-brand-700" disabled={isMarking} aria-describedby={titleId} onClick={onMarkRead}>
          {isMarking ? t("markingRead") : t("markRead")}
        </Button>
      ) : null}
    </li>
  );
}
