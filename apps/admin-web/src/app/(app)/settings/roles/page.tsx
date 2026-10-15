"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Role } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { orgKeys } from "@/lib/org-queries";
import { RequirePermission } from "@/components/require-permission";
import { PageHeader } from "@/components/page-header";
import { ArrowStartIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { RoleDetail, useRoleDescription, useRoleName } from "@/components/roles/role-detail";
import { RoleEditor } from "@/components/roles/role-editor";

/** What the page shows below the list. */
type View = { kind: "none" } | { kind: "detail"; roleId: string } | { kind: "create" } | { kind: "edit"; roleId: string };

/**
 * Roles and permissions (MANAGE_ROLES). What a member sees and can do comes
 * from the permissions of their role, never from its name. The built-in
 * roles (Owner, Field Manager, Worker) are fixed and listed first; custom
 * roles are made from the permission catalog, edited with a reason, and
 * archived once nobody has them. Every change is audited by the API.
 */
export default function RolesPage() {
  return (
    <RequirePermission permission={Permission.MANAGE_ROLES}>
      <Roles />
    </RequirePermission>
  );
}

function Roles() {
  const t = useTranslations("roles");
  const tUsers = useTranslations("users");
  const roleName = useRoleName();
  const roleDescription = useRoleDescription();
  const { client } = useAuth();
  const { can } = useAccess();
  const canManage = can(Permission.MANAGE_ROLES);
  const rolesQuery = useQuery({ queryKey: orgKeys.roles, queryFn: () => client.listRoles() });
  const [view, setView] = useState<View>({ kind: "none" });
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const roles = rolesQuery.data ?? [];
  // Built-in roles first, then the custom ones (the API's order).
  const ordered = [...roles.filter((role) => role.isSystem), ...roles.filter((role) => !role.isSystem)];
  const selected = view.kind === "detail" || view.kind === "edit" ? roles.find((role) => role.id === view.roleId) : undefined;

  const show = (next: View) => {
    setAnnouncement(null);
    setView(next);
  };

  return (
    <div className="space-y-6">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {tUsers("backToSettings")}
      </Link>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canManage ? (
            <Button onClick={() => show({ kind: "create" })} aria-expanded={view.kind === "create"}>
              {t("create")}
            </Button>
          ) : null
        }
      />
      <div role="status" aria-live="polite">
        {announcement ? <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{announcement}</p> : null}
      </div>

      {rolesQuery.isPending && <LoadingState />}
      {rolesQuery.isError && <ErrorState error={rolesQuery.error} onRetry={() => void rolesQuery.refetch()} />}
      {rolesQuery.isSuccess && roles.length === 0 ? <EmptyState /> : null}
      {ordered.length > 0 ? (
        <Card>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("caption")}</caption>
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t("columns.name")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t("columns.description")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">
                    {t("columns.permissions")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">
                    {t("columns.members")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    <span className="sr-only">{t("columns.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((role) => {
                  const name = roleName(role);
                  return (
                    <tr key={role.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-2 py-2 font-medium text-slate-900">
                        {name}
                        {role.isSystem ? (
                          <Badge tone="info" className="ms-2">
                            {t("builtIn")}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-slate-600">{roleDescription(role) ?? <span className="text-slate-400">{t("noDescription")}</span>}</td>
                      <td className="px-2 py-2 text-end">{role.permissions.length}</td>
                      <td className="px-2 py-2 text-end">{role.memberCount}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={t("viewFor", { name })}
                            aria-expanded={view.kind === "detail" && view.roleId === role.id}
                            onClick={() => show(view.kind === "detail" && view.roleId === role.id ? { kind: "none" } : { kind: "detail", roleId: role.id })}
                          >
                            {t("view")}
                          </Button>
                          {role.isSystem ? (
                            <span className="text-xs text-slate-500">{t("notEditable")}</span>
                          ) : canManage ? (
                            <Button size="sm" variant="ghost" aria-label={t("editFor", { name })} onClick={() => show({ kind: "edit", roleId: role.id })}>
                              {t("edit")}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      {view.kind === "create" ? (
        <RoleEditor
          onCancel={() => show({ kind: "none" })}
          onSaved={(message: string, saved: Role) => {
            setView({ kind: "detail", roleId: saved.id });
            setAnnouncement(message);
          }}
        />
      ) : null}
      {view.kind === "edit" && selected && !selected.isSystem ? (
        <RoleEditor
          key={selected.id}
          role={selected}
          onCancel={() => show({ kind: "detail", roleId: selected.id })}
          onSaved={(message: string) => {
            setView({ kind: "detail", roleId: selected.id });
            setAnnouncement(message);
          }}
        />
      ) : null}
      {view.kind === "detail" && selected ? (
        <RoleDetail
          key={selected.id}
          summary={selected}
          canManage={canManage}
          onEdit={() => show({ kind: "edit", roleId: selected.id })}
          onClose={() => show({ kind: "none" })}
          onArchived={(message) => {
            setView({ kind: "none" });
            setAnnouncement(message);
          }}
        />
      ) : null}
    </div>
  );
}
