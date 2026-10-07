"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CorrectionReason } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { EM_DASH } from "@/lib/format";
import { useEnumLabel } from "@/i18n/enums";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, LtrText } from "@/components/formatted";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

/**
 * Manual time corrections store a CorrectionReason code, and some system events
 * (e.g. a rejected offline sync) store an API error code. Everything else is
 * free text typed by a person and is shown as written.
 */
const CORRECTION_REASONS = new Set<string>(Object.values(CorrectionReason));
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]+$/;

const ltr = (chunks: ReactNode) => <LtrText>{chunks}</LtrText>;

function AuditLogContent() {
  const t = useTranslations("auditLog");
  const tErrors = useTranslations("errors");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const auditQuery = useQuery({ queryKey: ["audit-logs"], queryFn: () => client.listAuditLogs() });
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; brokenAtId?: string } | null>(null);

  const verify = useMutation({
    mutationFn: () => client.verifyAuditChain(),
    onMutate: () => setVerifyResult(null),
    onSuccess: setVerifyResult,
  });

  // Known codes get a translated label; a code added by the API later is shown as-is (left-to-right).
  const actionLabel = (code: string): ReactNode => (t.has(`actions.${code}`) ? t(`actions.${code}`) : <LtrText className="font-mono text-xs">{code}</LtrText>);
  const entityLabel = (type: string): ReactNode => (t.has(`entityTypes.${type}`) ? t(`entityTypes.${type}`) : <LtrText>{type}</LtrText>);
  const reasonLabel = (reason: string | null): string => {
    if (!reason) return EM_DASH;
    if (CORRECTION_REASONS.has(reason)) return enumLabel("CorrectionReason", reason);
    if (ERROR_CODE_PATTERN.test(reason)) {
      // Audit rows carry no error details, so prefer the wording without placeholders.
      const noDetailsKey = `${reason}_NO_DETAILS`;
      if (tErrors.has(noDetailsKey)) return tErrors(noDetailsKey);
      if (tErrors.has(reason)) return tErrors(reason);
    }
    return reason;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t.rich("description", { ltr })}
        actions={
          <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
            {verify.isPending ? t("verify.pending") : t("verify.action")}
          </Button>
        }
      />

      <div aria-live="polite">
        {verifyResult && (
          <Card>
            <CardContent className="py-4">
              {verifyResult.valid ? (
                <Badge tone="success">{t("verify.valid")}</Badge>
              ) : (
                <Badge tone="danger">{verifyResult.brokenAtId ? t.rich("verify.broken", { id: verifyResult.brokenAtId, ltr }) : t("verify.brokenUnknown")}</Badge>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {verify.isError && (
        <Card>
          <CardContent role="alert" className="space-y-1 py-4 text-sm">
            <p className="font-medium text-red-700">{t("verify.failed")}</p>
            <p className="text-red-600">{errorMessage(verify.error)}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("events.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {auditQuery.isLoading && <LoadingState />}
          {auditQuery.isError && <ErrorState error={auditQuery.error} onRetry={() => void auditQuery.refetch()} />}
          {auditQuery.data && auditQuery.data.items.length === 0 && <EmptyState title={t("empty.title")} description={t("empty.description")} />}
          {auditQuery.data && auditQuery.data.items.length > 0 && (
            <div className="relative overflow-x-auto">
              <table className="w-full text-start text-sm">
                <caption className="sr-only">{t("events.caption")}</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("columns.action")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("columns.entity")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("columns.reason")}
                    </th>
                    <th scope="col" className="px-5 py-3 text-start font-medium">
                      {t("columns.when")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {auditQuery.data.items.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-5 py-3 font-medium text-slate-900">{actionLabel(e.action)}</td>
                      <td className="px-5 py-3 text-slate-600">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span>{entityLabel(e.entityType)}</span>
                          <span title={t("entityIdTitle", { id: e.entityId })}>
                            <LtrText className="font-mono text-xs text-slate-500">{`${e.entityId.slice(0, 8)}…`}</LtrText>
                          </span>
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{reasonLabel(e.reason)}</td>
                      <td className="px-5 py-3 text-slate-600">
                        <DateTimeText value={e.createdAt} />
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

export default function AuditLogPage() {
  return (
    <OwnerOnly>
      <AuditLogContent />
    </OwnerOnly>
  );
}
