"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { TimeEntryEvidence } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import { isNotFound } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { ArrowStartIcon } from "@/components/icons";
import { BusinessDateText } from "@/components/formatted";
import { FlagBadges } from "@/components/attendance/flag-badges";
import { EntryActions, type EntryActionSuccess } from "@/components/attendance/entry-actions";
import { CorrectionDialog } from "@/components/attendance/correction-dialog";
import {
  DurationCard,
  EmergencyCard,
  EntryCostCard,
  HistoryCard,
  LocationCard,
  RecordCard,
  SummaryCard,
  TimelineCard,
} from "@/components/attendance/evidence-sections";

/**
 * One time entry with everything a manager needs to decide (Step 5): who and
 * where, the device / server / validated times, the map with refused
 * attempts, the minutes, the summary and the full history, plus the actions
 * (each only with its own permission). The evidence response carries no
 * money for anyone; a member who may see pay (VIEW_FINANCIALS with
 * VIEW_COMPENSATION) also gets the entry's estimated cost from its own endpoint.
 */
export default function AttendanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tDetail = useTranslations("attendance.detail");
  const tStates = useTranslations("states");
  const { client } = useAuth();
  const evidenceQuery = useQuery({ queryKey: ["time-entry-evidence", id], queryFn: () => client.getTimeEntryEvidence(id) });

  let content: ReactNode;
  if (evidenceQuery.isPending) {
    content = <LoadingState />;
  } else if (evidenceQuery.isError && !isNotFound(evidenceQuery.error)) {
    content = <ErrorState error={evidenceQuery.error} onRetry={() => void evidenceQuery.refetch()} />;
  } else if (!evidenceQuery.data) {
    content = <EmptyState title={tStates("notFoundTitle")} description={tDetail("notFound")} />;
  } else {
    content = <Evidence evidence={evidenceQuery.data} />;
  }

  return (
    <div className="max-w-6xl space-y-6">
      <Link href="/attendance" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {tDetail("backToList")}
      </Link>
      {content}
    </div>
  );
}

function Evidence({ evidence }: { evidence: TimeEntryEvidence }) {
  const t = useTranslations("attendance");
  const tDetail = useTranslations("attendance.detail");
  const label = useEnumLabel();
  const { can, canAll } = useAccess();
  const canSeeCost = canAll([Permission.VIEW_FINANCIALS, Permission.VIEW_COMPENSATION]);
  const [announcement, setAnnouncement] = useState<{ key: EntryActionSuccess | "corrected"; name: string } | null>(null);
  const [correcting, setCorrecting] = useState(false);
  // What the entry allows now (the API) and what the member may do (their permissions).
  const allowedActions = {
    approve: evidence.allowedActions.approve && can(Permission.APPROVE_ATTENDANCE),
    reject: evidence.allowedActions.reject && can(Permission.APPROVE_ATTENDANCE),
    requestCorrection: evidence.allowedActions.requestCorrection && can(Permission.APPROVE_ATTENDANCE),
    fullDayCredit: evidence.allowedActions.fullDayCredit && can(Permission.APPLY_FULL_DAY_CREDIT),
    correct: evidence.allowedActions.correct && can(Permission.CORRECT_TIME_ENTRIES),
  };
  const anyAction =
    allowedActions.approve || allowedActions.reject || allowedActions.requestCorrection || allowedActions.fullDayCredit || allowedActions.correct;

  return (
    <>
      <PageHeader
        title={evidence.worker.fullLegalName}
        description={tDetail.rich("subtitle", { date: () => <BusinessDateText value={evidence.businessDate} /> })}
        actions={
          <>
            <Badge tone={statusTone(evidence.status)}>{label("TimeEntryStatus", evidence.status)}</Badge>
            {evidence.fullDayCredit.applied ? <Badge tone="info">{t("fullDayCreditApplied")}</Badge> : null}
            <FlagBadges flags={evidence.flags} />
          </>
        }
      />

      <div role="status" aria-live="polite">
        {announcement ? (
          <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{t(`messages.${announcement.key}`, { name: announcement.name })}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TimelineCard evidence={evidence} />
          <LocationCard evidence={evidence} />
          <HistoryCard evidence={evidence} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{tDetail("actions.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {evidence.rejectedReason ? (
                <p className="text-slate-700">
                  {tDetail("actions.rejectedReason")}: <bdi>{evidence.rejectedReason}</bdi>
                </p>
              ) : null}
              {evidence.periodFinalized ? <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">{tDetail("actions.periodFinalized")}</p> : null}
              {anyAction ? (
                <EntryActions
                  entryId={evidence.id}
                  workerName={evidence.worker.fullLegalName}
                  allowed={allowedActions}
                  onSuccess={(key, name) => setAnnouncement({ key, name })}
                  extra={
                    allowedActions.correct ? (
                      <Button size="sm" variant="secondary" onClick={() => setCorrecting(true)}>
                        {tDetail("actions.manualCorrection")}
                      </Button>
                    ) : null
                  }
                />
              ) : (
                <p className="text-slate-500">{tDetail("actions.none")}</p>
              )}
            </CardContent>
          </Card>
          <RecordCard evidence={evidence} />
          <DurationCard evidence={evidence} />
          {/* Money: a separate request to its own endpoint; a member who may not see pay never renders (or requests) it. */}
          {canSeeCost ? <EntryCostCard timeEntryId={evidence.id} /> : null}
          {evidence.emergency ? <EmergencyCard emergency={evidence.emergency} /> : null}
          <SummaryCard summary={evidence.dailySummary} />
        </div>
      </div>

      {correcting ? (
        <CorrectionDialog
          entry={{
            id: evidence.id,
            workerProfileId: evidence.worker.id,
            workerName: evidence.worker.fullLegalName,
            status: evidence.status,
            clockInAt: evidence.clockInAt,
            clockOutAt: evidence.clockOutAt,
            rawDurationMinutes: evidence.duration.rawDurationMinutes,
            unpaidBreakMinutes: evidence.duration.unpaidBreakMinutes,
            fullDayCredit: evidence.fullDayCredit.applied,
            dayRules: evidence.dayRules,
          }}
          onClose={() => setCorrecting(false)}
          onSaved={() => {
            setCorrecting(false);
            setAnnouncement({ key: "corrected", name: evidence.worker.fullLegalName });
          }}
        />
      ) : null}
    </>
  );
}
