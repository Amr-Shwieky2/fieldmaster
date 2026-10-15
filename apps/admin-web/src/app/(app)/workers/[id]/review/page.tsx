"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { OnboardingReview } from "@fieldmaster/api-client";
import { AccountStatus, Permission } from "@fieldmaster/shared-types";
import { EM_DASH, isNotFound } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useEnumLabel } from "@/i18n/enums";
import { RequirePermission } from "@/components/require-permission";
import { PageHeader } from "@/components/page-header";
import { DateTimeText, LtrText, Phone } from "@/components/formatted";
import { ArrowStartIcon } from "@/components/icons";
import { Badge, statusTone } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { WorkerApprovalForm } from "../../_components/approval-form";
import { OnboardingFilePreview } from "../../_components/onboarding-file-preview";

/**
 * A join application is reviewed (APPROVE_ONBOARDING with VIEW_BANK_INFO):
 * the details as the worker entered them (ID and bank details decrypted by
 * the API), the uploaded documents, the privacy consent, and then approved
 * with a compensation or rejected with a reason. Every view of this data is
 * audited by the API, so the page reads it once per visit and keeps nothing
 * after it closes. Whoever lacks those permissions (a Field Manager) never
 * gets here: RequirePermission sends them to the dashboard before any request.
 */
export default function OnboardingReviewPage() {
  return (
    <RequirePermission permission={[Permission.APPROVE_ONBOARDING, Permission.VIEW_BANK_INFO]}>
      <ReviewContent />
    </RequirePermission>
  );
}

function ReviewContent() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("onboardingReview");
  const tWorkers = useTranslations("workers");
  const tStates = useTranslations("states");
  const { client } = useAuth();
  const query = useQuery({
    queryKey: ["onboarding-review", id],
    queryFn: () => client.getOnboardingReview(id),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  let content: ReactNode;
  if (query.data) {
    content = <ReviewDetails review={query.data} />;
  } else if (query.isError && isNotFound(query.error)) {
    content = (
      <Card>
        <EmptyState title={tStates("notFoundTitle")} description={t("notFound")} />
      </Card>
    );
  } else if (query.isError) {
    content = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else {
    content = <LoadingState />;
  }

  return (
    <div className="max-w-5xl space-y-6">
      <Link href="/workers" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {tWorkers("backToList")}
      </Link>
      {content}
    </div>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2 sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm text-slate-500">{term}</dt>
      <dd className="min-w-0 break-words text-sm text-slate-900 sm:col-span-2">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ReviewDetails({ review }: { review: OnboardingReview }) {
  const t = useTranslations("onboardingReview");
  const label = useEnumLabel();
  const pending = review.membershipStatus === AccountStatus.PENDING_APPROVAL;
  const bank = review.bankAccount;

  return (
    <>
      <PageHeader
        title={t("title", { name: review.fullLegalName })}
        description={t("description")}
        actions={<Badge tone={statusTone(review.membershipStatus)}>{label("AccountStatus", review.membershipStatus)}</Badge>}
      />
      <p role="note" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
        {t("auditNote")}
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={t("personal.title")}>
          <dl className="divide-y divide-slate-100">
            <Detail term={t("personal.fullLegalName")}>{review.fullLegalName}</Detail>
            <Detail term={t("personal.preferredName")}>{review.preferredName ?? EM_DASH}</Detail>
            <Detail term={t("personal.phone")}>
              <Phone value={review.phoneNumber} />
            </Detail>
            <Detail term={t("personal.submittedAt")}>
              <DateTimeText value={review.submittedAt} />
            </Detail>
          </dl>
        </Section>

        <Section title={t("identity.title")}>
          <dl className="divide-y divide-slate-100">
            <Detail term={t("identity.type")}>{review.governmentIdType ? label("GovernmentIdType", review.governmentIdType) : EM_DASH}</Detail>
            <Detail term={t("identity.number")}>
              {review.governmentIdNumber ? <LtrText className="font-mono">{review.governmentIdNumber}</LtrText> : EM_DASH}
            </Detail>
          </dl>
          <div className="mt-3 space-y-2">
            <h3 className="text-sm font-medium text-slate-700">{t("identity.document")}</h3>
            {review.identityDocument ? (
              <OnboardingFilePreview file={review.identityDocument} alt={t("identity.documentAlt", { name: review.fullLegalName })} />
            ) : (
              <p className="text-sm text-slate-500">{t("identity.missing")}</p>
            )}
          </div>
        </Section>

        <Section title={t("bank.title")}>
          {bank ? (
            <dl className="divide-y divide-slate-100">
              <Detail term={t("bank.bankName")}>{bank.bankName}</Detail>
              <Detail term={t("bank.branchNumber")}>
                <LtrText className="font-mono">{bank.branchNumber}</LtrText>
              </Detail>
              <Detail term={t("bank.accountNumber")}>
                <LtrText className="font-mono">{bank.accountNumber}</LtrText>
              </Detail>
              <Detail term={t("bank.accountHolderName")}>{bank.accountHolderName}</Detail>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">{t("bank.missing")}</p>
          )}
        </Section>

        <Section title={t("photo.title")}>
          {review.profilePhoto ? (
            <OnboardingFilePreview file={review.profilePhoto} alt={t("photo.alt", { name: review.fullLegalName })} />
          ) : (
            <p className="text-sm text-slate-500">{t("photo.missing")}</p>
          )}
        </Section>

        <Section title={t("consent.title")}>
          <p className="text-sm text-slate-700">
            {review.consentAcceptedAt
              ? t.rich("consent.accepted", {
                  version: review.privacyNoticeVersion ?? EM_DASH,
                  ltr: (chunks) => <LtrText>{chunks}</LtrText>,
                  date: () => <DateTimeText value={review.consentAcceptedAt} />,
                })
              : t("consent.missing")}
          </p>
        </Section>
      </div>

      {pending ? (
        <WorkerApprovalForm workerProfileId={review.workerProfileId} />
      ) : (
        <p role="note" className="rounded-md border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-800">
          {t("decided", { status: label("AccountStatus", review.membershipStatus) })}
        </p>
      )}
    </>
  );
}
