"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Role } from "@fieldmaster/api-client";
import { AccountStatus } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { orgKeys } from "@/lib/org-queries";
import { useEnumLabel } from "@/i18n/enums";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ReasonForm } from "@/components/attendance/reason-form";
import { PermissionChecklist } from "./permission-checklist";

/** A role's name as shown: a built-in role's Arabic label, a custom role's own name. */
export function useRoleName(): (role: Pick<Role, "name" | "systemKey">) => string {
  const label = useEnumLabel();
  return (role) => (role.systemKey ? label("SystemRoleKey", role.systemKey) : role.name);
}

/** What a role is for: a built-in role's fixed description, a custom role's own (if any). */
export function useRoleDescription(): (role: Pick<Role, "description" | "systemKey">) => string | null {
  const tSystem = useTranslations("roles.systemDescriptions");
  return (role) => (role.systemKey ? tSystem(role.systemKey) : role.description);
}

/**
 * One role: what it is, its permissions (read-only here) and its members.
 * A built-in role is fixed (never edited or archived). A custom role can be
 * edited, or archived after a confirmation with a reason -- but not while it
 * still has members (they must be moved to another role first).
 */
export function RoleDetail({
  summary,
  canManage,
  onEdit,
  onClose,
  onArchived,
}: {
  /** The role as the list has it (the detail adds its members). */
  summary: Role;
  canManage: boolean;
  onEdit: () => void;
  onClose: () => void;
  onArchived: (message: string) => void;
}) {
  const t = useTranslations("roles.detail");
  const tRoles = useTranslations("roles");
  const label = useEnumLabel();
  const errorMessage = useErrorMessage();
  const roleName = useRoleName();
  const roleDescription = useRoleDescription();
  const { client, refreshAccess } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const headingRef = useRef<HTMLSpanElement>(null);
  const detailQuery = useQuery({ queryKey: orgKeys.role(summary.id), queryFn: () => client.getRole(summary.id) });
  const role = detailQuery.data ?? summary;
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const name = roleName(role);
  const description = roleDescription(role);
  const inUse = role.memberCount > 0;

  useEffect(() => {
    headingRef.current?.focus();
  }, [summary.id]);

  const archive = useMutation({
    mutationFn: (why: string) => client.archiveRole(role.id, why),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.roles });
      void refreshAccess?.();
      onArchived(t("archived", { name }));
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>
            <span ref={headingRef} tabIndex={-1} className="outline-none">
              {name}
            </span>
          </CardTitle>
          {role.isSystem ? <Badge tone="info">{tRoles("builtIn")}</Badge> : null}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {description ? <p className="text-slate-700">{description}</p> : null}
        {role.isSystem ? <p className="rounded-md bg-slate-100 px-3 py-2 text-slate-700">{t("systemNote")}</p> : null}

        <section aria-labelledby={`${id}-permissions`} className="space-y-2">
          <h3 id={`${id}-permissions`} className="font-semibold text-slate-900">
            {t("permissions", { count: role.permissions.length })}
          </h3>
          <PermissionChecklist idPrefix={`${id}-permission`} selected={role.permissions} readOnly />
        </section>

        <section aria-labelledby={`${id}-members`} className="space-y-2">
          <h3 id={`${id}-members`} className="font-semibold text-slate-900">
            {t("members", { count: role.memberCount })}
          </h3>
          {detailQuery.isPending ? <LoadingState /> : null}
          {detailQuery.isError ? <ErrorState error={detailQuery.error} onRetry={() => void detailQuery.refetch()} /> : null}
          {detailQuery.data && detailQuery.data.members.length === 0 ? <p className="text-slate-500">{t("noMembers")}</p> : null}
          {detailQuery.data && detailQuery.data.members.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {detailQuery.data.members.map((member) => (
                <li key={member.membershipId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="font-medium text-slate-900">{member.fullLegalName}</span>
                  <Badge tone={member.status === AccountStatus.SUSPENDED ? "warning" : statusTone(member.status)}>{label("AccountStatus", member.status)}</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {!role.isSystem && canManage ? (
          <section className="space-y-3 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onEdit}>
                {t("edit")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={inUse || archive.isPending}
                aria-describedby={inUse ? `${id}-in-use` : undefined}
                aria-expanded={confirming}
                onClick={() => {
                  archive.reset();
                  setReason("");
                  setInvalid(false);
                  setConfirming(true);
                }}
              >
                {t("archive")}
              </Button>
            </div>
            {inUse ? (
              <p id={`${id}-in-use`} className="text-xs text-slate-600">
                {t("inUse", { count: role.memberCount })}
              </p>
            ) : null}
            {confirming && !inUse ? (
              <div className="space-y-2">
                <p className="text-sm text-amber-800">{t("archiveWarning")}</p>
                <ReasonForm
                  id={`${id}-archive`}
                  label={t("archiveReason")}
                  hint={t("archiveReasonHint")}
                  value={reason}
                  invalid={invalid}
                  onChange={(value) => {
                    setReason(value);
                    setInvalid(false);
                  }}
                  onSubmit={(why) => (why.length === 0 ? setInvalid(true) : archive.mutate(why))}
                  onCancel={() => {
                    archive.reset();
                    setConfirming(false);
                  }}
                  submitLabel={t("confirmArchive")}
                  pendingLabel={t("archiving")}
                  pending={archive.isPending}
                  busy={archive.isPending}
                  variant="danger"
                />
              </div>
            ) : null}
            {archive.isError ? (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage(archive.error)}
              </p>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
