"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/page-header";
import { ArrowStartIcon } from "@/components/icons";
import { CreateInvitationCard } from "../_components/create-invitation-card";
import { InvitationsTable } from "../_components/invitations-table";

/**
 * Worker invitations (Owner and Field Manager): create a single-use join
 * link, see every invitation's state and revoke an active one.
 */
export default function InvitationsPage() {
  const t = useTranslations("invitations");
  const tWorkers = useTranslations("workers");
  return (
    <div className="space-y-6">
      <Link href="/workers" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {tWorkers("backToList")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />
      <CreateInvitationCard />
      <InvitationsTable />
    </div>
  );
}
