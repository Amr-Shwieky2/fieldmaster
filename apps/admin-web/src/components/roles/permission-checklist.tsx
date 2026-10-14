"use client";

import { useTranslations } from "next-intl";
import { PERMISSION_GROUPS, PERMISSION_REQUIRES, isFinancialPermission, isOrgWidePermission, type Permission } from "@fieldmaster/shared-types";
import { useEnumLabel } from "@/i18n/enums";
import { Badge } from "@/components/ui/badge";

/**
 * The permission catalog as a checklist, grouped and ordered like the API's
 * catalog (الحضور، الجدولة، المواقع، العمال، الرواتب والمالية، التقارير،
 * الإعدادات، سجل التدقيق). Each permission says what it needs, whether it
 * opens money («مالي») and whether a member restricted to some projects can
 * have it. Read-only for a built-in role (and for the role's detail view);
 * the editor passes `onToggle`, which applies the dependency rule
 * (`togglePermission` in lib/permissions.ts).
 */
export function PermissionChecklist({
  idPrefix,
  selected,
  onToggle,
  readOnly = false,
}: {
  idPrefix: string;
  selected: readonly Permission[];
  onToggle?: (permission: Permission, checked: boolean) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("roles.permissions");
  const label = useEnumLabel();
  const chosen = new Set(selected);

  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map(({ group, permissions }) => {
        const count = permissions.filter((permission) => chosen.has(permission)).length;
        return (
          <fieldset key={group} className="rounded-md border border-slate-200 px-3 pb-3 pt-1">
            <legend className="px-1 text-sm font-semibold text-slate-900">
              {label("PermissionGroup", group)} <span className="font-normal text-slate-500">{t("groupCount", { count, total: permissions.length })}</span>
            </legend>
            <ul className="space-y-2">
              {permissions.map((permission) => {
                const id = `${idPrefix}-${permission}`;
                const requires = PERMISSION_REQUIRES[permission] ?? [];
                const financial = isFinancialPermission(permission);
                const orgWide = isOrgWidePermission(permission);
                const hasNotes = financial || orgWide || requires.length > 0;
                return (
                  <li key={permission} className="flex items-start gap-2">
                    <input
                      id={id}
                      type="checkbox"
                      className="mt-1"
                      checked={chosen.has(permission)}
                      disabled={readOnly}
                      onChange={(event) => onToggle?.(permission, event.target.checked)}
                      aria-describedby={hasNotes ? `${id}-notes` : undefined}
                    />
                    <div className="min-w-0 text-sm">
                      <label htmlFor={id} className="font-medium text-slate-800">
                        {label("Permission", permission)}
                      </label>
                      {hasNotes ? (
                        <div id={`${id}-notes`} className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                          {financial ? <Badge tone="warning">{t("financial")}</Badge> : null}
                          {orgWide ? <Badge tone="neutral">{t("organizationWide")}</Badge> : null}
                          {requires.length > 0 ? (
                            <span>{t("requires", { permissions: requires.map((required) => label("Permission", required)).join("، ") })}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
