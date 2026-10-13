"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { OnboardingInvitation } from "@fieldmaster/api-client";
import { InvitationStatus, OrgRole } from "@fieldmaster/shared-types";
import { EM_DASH } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { DateTimeText, Phone } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { invitationKeys } from "./create-invitation-card";

const COLUMNS = ["status", "phone", "created", "expires", "worker", "actions"] as const;

const TH = "px-4 py-3 text-start font-medium";
const TD = "px-4 py-3 align-top text-start text-slate-700";

function invitationTone(status: InvitationStatus): "success" | "info" | "neutral" | "danger" {
  switch (status) {
    case InvitationStatus.ACTIVE:
      return "success";
    case InvitationStatus.USED:
      return "info";
    case InvitationStatus.REVOKED:
      return "danger";
    default:
      return "neutral";
  }
}

/** "<date> بواسطة <name>", or the date alone when the person is unknown. */
function DoneBy({ at, by }: { at: string; by: string | null }) {
  const t = useTranslations("invitations");
  const date = () => <DateTimeText value={at} />;
  return <>{by ? t.rich("list.by", { name: by, date }) : <DateTimeText value={at} />}</>;
}

/**
 * Every invitation of the organization (its token is never listed: only a
 * hash is stored). An active one can be revoked after a confirmation; a used
 * one shows the worker its application created (an Owner can open the
 * review).
 */
export function InvitationsTable() {
  const t = useTranslations("invitations");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const isOwner = session?.role === OrgRole.OWNER;
  const query = useQuery({ queryKey: invitationKeys.list, queryFn: () => client.listInvitations() });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "revoked" } | { kind: "failed"; error: unknown } | null>(null);

  const revoke = useMutation({
    mutationFn: (invitationId: string) => client.revokeInvitation(invitationId),
    onMutate: () => setFeedback(null),
    onSuccess: () => setFeedback({ kind: "revoked" }),
    onError: (error) => setFeedback({ kind: "failed", error }),
    onSettled: () => {
      setConfirmingId(null);
      // Refetch either way: a 409 means the invitation was used meanwhile.
      void queryClient.invalidateQueries({ queryKey: invitationKeys.list });
    },
  });

  const invitations = useMemo(() => [...(query.data ?? [])].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [query.data]);

  /** When it was used or revoked (and by whom), under the status. */
  const statusDetail = (invitation: OnboardingInvitation) => {
    if (invitation.usedAt) return t.rich("list.usedAt", { date: () => <DateTimeText value={invitation.usedAt} /> });
    if (invitation.revokedAt) {
      const date = () => <DateTimeText value={invitation.revokedAt} />;
      return invitation.revokedByName ? t.rich("list.revokedBy", { name: invitation.revokedByName, date }) : t.rich("list.revokedAt", { date });
    }
    return null;
  };

  /** The worker whose application used the invitation: an Owner opens the review, a Field Manager sees the name. */
  const workerCell = (invitation: OnboardingInvitation) => {
    const name = invitation.workerName;
    if (invitation.workerProfileId && isOwner) {
      return (
        <Link href={`/workers/${invitation.workerProfileId}/review`} className="font-medium text-brand-700 hover:underline">
          {name ? t("list.reviewWorker", { name }) : t("list.review")}
        </Link>
      );
    }
    return name ? <span className="font-medium text-slate-900">{name}</span> : EM_DASH;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("list.title")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div aria-live="polite">
          {feedback?.kind === "revoked" ? (
            <p role="status" className="border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-sm text-emerald-800">
              {t("list.revoked")}
            </p>
          ) : null}
        </div>
        {feedback?.kind === "failed" ? (
          <p role="alert" className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
            {t("list.revokeFailed", { message: errorMessage(feedback.error) })}
          </p>
        ) : null}
        {query.isPending ? <LoadingState /> : null}
        {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.isSuccess && invitations.length === 0 ? <EmptyState title={t("list.empty.title")} description={t("list.empty.description")} /> : null}
        {invitations.length > 0 ? (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[48rem] text-start text-sm">
              <caption className="sr-only">{t("list.caption")}</caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className={TH}>
                      {t(`list.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => {
                  const confirming = confirmingId === invitation.id;
                  const confirmId = `${id}-confirm-${invitation.id}`;
                  const detail = statusDetail(invitation);
                  return [
                    <tr key={invitation.id} className="border-b border-slate-100 last:border-0">
                      <td className={TD}>
                        <Badge tone={invitationTone(invitation.status)}>{enumLabel("InvitationStatus", invitation.status)}</Badge>
                        {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
                      </td>
                      <td className={TD}>{invitation.prefilledPhoneNumber ? <Phone value={invitation.prefilledPhoneNumber} /> : EM_DASH}</td>
                      <td className={TD}>
                        <DoneBy at={invitation.createdAt} by={invitation.createdByName} />
                      </td>
                      <td className={TD}>
                        <DateTimeText value={invitation.expiresAt} />
                      </td>
                      <td className={TD}>{workerCell(invitation)}</td>
                      <td className={TD}>
                        {invitation.status === InvitationStatus.ACTIVE ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="whitespace-nowrap"
                            onClick={() => {
                              setFeedback(null);
                              setConfirmingId(confirming ? null : invitation.id);
                            }}
                            disabled={revoke.isPending}
                            aria-expanded={confirming}
                            aria-controls={confirming ? confirmId : undefined}
                            aria-label={t("list.revokeLabel", { date: format.dateTime(invitation.createdAt) })}
                          >
                            {t("list.revoke")}
                          </Button>
                        ) : null}
                      </td>
                    </tr>,
                    confirming ? (
                      <tr key={`${invitation.id}-confirm`} className="border-b border-slate-100">
                        <td colSpan={COLUMNS.length} className="px-4 pb-4">
                          <div
                            id={confirmId}
                            role="group"
                            aria-labelledby={`${confirmId}-text`}
                            className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                          >
                            <p id={`${confirmId}-text`} className="font-medium">
                              {t("list.confirmText")}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" variant="danger" onClick={() => revoke.mutate(invitation.id)} disabled={revoke.isPending}>
                                {revoke.isPending ? t("list.revoking") : t("list.confirm")}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)} disabled={revoke.isPending}>
                                {t("list.keep")}
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
