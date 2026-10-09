"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Worker } from "@fieldmaster/api-client";
import { AccountStatus, CompensationType } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { isNotFound } from "@fieldmaster/i18n";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { BusinessDateText, DateTimeText, Money, Phone } from "@/components/formatted";
import { ArrowStartIcon } from "@/components/icons";
import { RateText } from "../_components/rate-text";

/**
 * The API serializes the date-only `effectiveStartDate` column as an ISO
 * timestamp at UTC midnight; the calendar day is its first 10 characters.
 */
function toBusinessDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match ? match[0] : null;
}

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("workers");
  const tStates = useTranslations("states");
  const { client } = useAuth();
  const workerQuery = useQuery({ queryKey: ["worker", id], queryFn: () => client.getWorker(id) });

  let content: ReactNode;
  if (workerQuery.isPending) {
    content = <LoadingState />;
  } else if (workerQuery.isError && !isNotFound(workerQuery.error)) {
    content = <ErrorState error={workerQuery.error} onRetry={() => void workerQuery.refetch()} />;
  } else if (!workerQuery.data) {
    content = <EmptyState title={tStates("notFoundTitle")} description={t("detail.notFound")} />;
  } else {
    content = <WorkerDetail worker={workerQuery.data} />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/workers" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {t("backToList")}
      </Link>
      {content}
    </div>
  );
}

function WorkerDetail({ worker }: { worker: Worker }) {
  const t = useTranslations("workers");
  const tc = useTranslations("common");
  const label = useEnumLabel();
  const compensation = worker.compensation;

  return (
    <>
      <PageHeader title={worker.fullLegalName} description={<Phone value={worker.phoneNumber} />} />

      <Card>
        <CardHeader>
          <CardTitle>{t("detail.profile")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <Row label={tc("status")}>
              <Badge tone={statusTone(worker.accountStatus)}>{label("AccountStatus", worker.accountStatus)}</Badge>
            </Row>
            <Row label={t("detail.role")}>{label("OrgRole", worker.role)}</Row>
            <Row label={t("detail.joined")}>
              <DateTimeText value={worker.createdAt} />
            </Row>
          </dl>
        </CardContent>
      </Card>

      {/* Compensation is Owner-only: the API omits it for a Field Manager, who sees the explanation instead. */}
      <Card>
        <CardHeader>
          <CardTitle>{tc("compensation")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {compensation ? (
            <dl className="space-y-3">
              <Row label={t("detail.compensationType")}>{label("CompensationType", compensation.compensationType)}</Row>
              {compensation.compensationType === CompensationType.DAILY ? (
                <Row label={tc("dailyRate")}>
                  <Money agorot={compensation.dailyBaseRateAgorot} />
                </Row>
              ) : (
                <Row label={tc("hourlyRate")}>
                  <Money agorot={compensation.baseHourlyRateAgorot} />
                </Row>
              )}
              <Row label={t("detail.overtimeRate")}>
                <RateText per="hour" agorot={compensation.overtimeHourlyRateAgorot} />
              </Row>
              <Row label={t("detail.effectiveFrom")}>
                <BusinessDateText value={toBusinessDate(compensation.effectiveStartDate)} />
              </Row>
            </dl>
          ) : (
            <p className="text-slate-500">
              {worker.accountStatus === AccountStatus.ACTIVE ? t("detail.noCompensationActive") : t("detail.noCompensationOther")}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}
