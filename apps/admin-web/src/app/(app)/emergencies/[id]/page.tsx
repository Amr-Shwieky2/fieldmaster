"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { EmergencyCalloutRecord } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { EM_DASH, isNotFound } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { ArrowStartIcon } from "@/components/icons";
import { DateTimeText, Money } from "@/components/formatted";
import { EmergencyTimes } from "@/components/emergency-times";
import { EvidenceMap, type EvidencePoint } from "@/components/attendance/evidence-map";

/** One emergency call-out: times, authorization, start/end GPS, summary, approval and (Owner only) its estimated cost. */
export default function EmergencyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("emergencies.detail");
  const tStates = useTranslations("states");
  const { client } = useAuth();
  const calloutQuery = useQuery({ queryKey: ["emergency-callouts", "detail", id], queryFn: () => client.getEmergencyCallout(id) });

  let content: ReactNode;
  if (calloutQuery.isPending) content = <LoadingState />;
  else if (calloutQuery.isError && !isNotFound(calloutQuery.error))
    content = <ErrorState error={calloutQuery.error} onRetry={() => void calloutQuery.refetch()} />;
  else if (!calloutQuery.data) content = <EmptyState title={tStates("notFoundTitle")} description={t("notFound")} />;
  else content = <Callout callout={calloutQuery.data} />;

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/emergencies" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {t("backToList")}
      </Link>
      {content}
    </div>
  );
}

function Callout({ callout }: { callout: EmergencyCalloutRecord }) {
  const t = useTranslations("emergencies.detail");
  const tc = useTranslations("common");
  const label = useEnumLabel();
  const format = useFormat();
  const { session } = useAuth();
  const meters = (value: number | null) => (value === null ? EM_DASH : format.number(Math.round(value)));
  // Owner DTO only: the key does not exist at all in a Field Manager's response (and the role is checked too).
  const hasCost = session?.role === OrgRole.OWNER && "estimatedCostAgorot" in callout;

  const points: EvidencePoint[] = [
    {
      key: "start",
      latitude: callout.start.latitude,
      longitude: callout.start.longitude,
      accuracyMeters: callout.start.accuracyMeters,
      color: "start",
      label: t("startPoint", { accuracy: meters(callout.start.accuracyMeters) }),
    },
    ...(callout.end
      ? [
          {
            key: "end",
            latitude: callout.end.latitude,
            longitude: callout.end.longitude,
            accuracyMeters: callout.end.accuracyMeters,
            color: "end" as const,
            label: t("endPoint", { accuracy: meters(callout.end.accuracyMeters) }),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={callout.worker.fullLegalName}
        description={tc("emergencyCallout")}
        actions={callout.status ? <Badge tone={statusTone(callout.status)}>{label("TimeEntryStatus", callout.status)}</Badge> : null}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("times")}</CardTitle>
            </CardHeader>
            <CardContent>
              <EmergencyTimes callout={callout} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("map")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <EvidenceMap areas={[]} points={points} label={t("mapLabel")} help={t("mapHelp")} />
              {!callout.end ? <p className="text-sm text-slate-500">{t("noEnd")}</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tc("dailySummary")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {callout.summary ? (
                <div className="space-y-1">
                  <p className="text-slate-500">{label("TaskCategory", callout.summary.taskCategory)}</p>
                  <p className="whitespace-pre-line" dir="auto">
                    {callout.summary.text ?? EM_DASH}
                  </p>
                </div>
              ) : (
                <p className="text-slate-500">{t("noSummary")}</p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("authorization")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">{label("EmergencyAuthorizationSource", callout.authorizationSource)}</p>
              {callout.authorizedByName ? <p className="text-slate-600">{t("authorizedBy", { name: callout.authorizedByName })}</p> : null}
              {callout.turanAssignment ? (
                <p className="text-slate-600">
                  {t.rich("turanWindow", {
                    type: label("TuranType", callout.turanAssignment.turanType),
                    start: () => <DateTimeText value={callout.turanAssignment!.startAt} />,
                    end: () => <DateTimeText value={callout.turanAssignment!.endAt} />,
                  })}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("approval")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {callout.status ? <Badge tone={statusTone(callout.status)}>{label("TimeEntryStatus", callout.status)}</Badge> : null}
              {callout.timeEntryId ? (
                <Link href={`/attendance/${callout.timeEntryId}`} className="block font-medium text-brand-700 hover:underline">
                  {t("viewAttendance")}
                </Link>
              ) : null}
            </CardContent>
          </Card>
          {hasCost ? (
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{t("cost")}</CardTitle>
                <Badge tone="info">{t("ownerOnly")}</Badge>
              </CardHeader>
              <CardContent className="text-sm">
                {callout.estimatedCostAgorot !== null && callout.estimatedCostAgorot !== undefined ? (
                  <Money agorot={callout.estimatedCostAgorot} className="text-base font-semibold" />
                ) : (
                  <p className="text-slate-500">{t("noCost")}</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
