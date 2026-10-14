"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CreateRoleInput, Role, UpdateRoleInput } from "@fieldmaster/api-client";
import { getErrorCode } from "@fieldmaster/i18n";
import { ALL_PERMISSIONS, isPermission, type Permission, type PermissionProblem } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { orgKeys } from "@/lib/org-queries";
import { togglePermission } from "@/lib/permissions";
import { useEnumLabel } from "@/i18n/enums";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { PermissionChecklist } from "./permission-checklist";

/** The API's limits for a role's name and description, and for a reason. */
export const ROLE_NAME_MIN = 2;
export const ROLE_NAME_MAX = 60;
export const ROLE_DESCRIPTION_MAX = 300;
const REASON_MAX = 500;

type Field = "name" | "description" | "reason";

const TEXTAREA = "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600">
      {message}
    </p>
  );
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value) => b.includes(value));

/**
 * Creates a custom role, or edits one (a built-in role is never edited): its
 * name, description and permissions from the grouped catalog. Ticking a
 * permission ticks what it requires and unticking one unticks what depends
 * on it, so the list is always one the API accepts. An edit needs a reason
 * (stored in the audit log) and applies to the role's members at their next
 * request. Server refusals (a name already used, the last administrator...)
 * are shown in Arabic.
 */
export function RoleEditor({ role, onCancel, onSaved }: { role?: Role; onCancel: () => void; onSaved: (message: string, role: Role) => void }) {
  const t = useTranslations("roles.editor");
  const label = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client, refreshAccess } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const headingRef = useRef<HTMLSpanElement>(null);
  const editing = role !== undefined;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<Permission[]>(() => ALL_PERMISSIONS.filter((permission) => (role?.permissions ?? []).includes(permission)));
  const [reason, setReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    // The form opens below the list: take the focus there.
    headingRef.current?.focus();
  }, []);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const problems: Partial<Record<Field, string>> = {};
  if (trimmedName.length < ROLE_NAME_MIN || trimmedName.length > ROLE_NAME_MAX) problems.name = t("errors.name", { min: ROLE_NAME_MIN, max: ROLE_NAME_MAX });
  if (trimmedDescription.length > ROLE_DESCRIPTION_MAX) problems.description = t("errors.description", { max: ROLE_DESCRIPTION_MAX });
  if (editing && reason.trim() === "") problems.reason = t("errors.reason");
  else if (reason.trim().length > REASON_MAX) problems.reason = t("errors.reasonTooLong", { max: REASON_MAX });

  /** An edit sends only what changed (a permission this app does not know yet is kept as it is). */
  const changes: UpdateRoleInput = {};
  if (role) {
    const unknown = role.permissions.filter((permission) => !isPermission(permission));
    if (trimmedName !== role.name) changes.name = trimmedName;
    if (trimmedDescription !== (role.description ?? "")) changes.description = trimmedDescription;
    if (!sameSet(permissions, role.permissions.filter(isPermission))) changes.permissions = [...permissions, ...unknown];
  }
  const unchanged = editing && Object.keys(changes).length === 0;

  const save = useMutation({
    mutationFn: (): Promise<Role> => {
      if (role) return client.updateRole(role.id, { ...changes, reason: reason.trim() });
      const input: CreateRoleInput = { name: trimmedName, permissions, ...(trimmedDescription ? { description: trimmedDescription } : {}) };
      return client.createRole(input);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.roles });
      // The users page shows each member's role by name.
      void queryClient.invalidateQueries({ queryKey: orgKeys.memberAccess });
      // A member of this role may be the signed-in one: their permissions change at the next request.
      void refreshAccess?.();
      onSaved(editing ? t("saved", { name: saved.name }) : t("created", { name: saved.name }), saved);
    },
  });

  // Shown after the first submit, then kept up to date while the fields change.
  const visible: Partial<Record<Field, string>> = showErrors ? problems : {};
  const errorId = (field: Field) => `${id}-${field}-error`;
  const describedBy = (field: Field, hint?: string) => [hint, visible[field] ? errorId(field) : undefined].filter(Boolean).join(" ") || undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.keys(problems).length > 0 || unchanged) return;
    save.mutate();
  };

  // INVALID_ROLE_PERMISSIONS: which permission misses which (the checklist prevents it; the server is the authority).
  const permissionProblems =
    save.isError && getErrorCode(save.error) === "INVALID_ROLE_PERMISSIONS"
      ? (((save.error as { body?: { details?: { problems?: PermissionProblem[] } } }).body?.details?.problems ?? []) as PermissionProblem[])
      : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span ref={headingRef} tabIndex={-1} className="outline-none">
            {role ? t("editTitle", { name: role.name }) : t("createTitle")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit} className="space-y-5">
          <div>
            <Label htmlFor={`${id}-name`}>{t("name")}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={ROLE_NAME_MAX}
              onChange={(event) => {
                save.reset();
                setName(event.target.value);
              }}
              aria-invalid={Boolean(visible.name) || undefined}
              aria-describedby={describedBy("name")}
            />
            <FieldError id={errorId("name")} message={visible.name} />
          </div>
          <div>
            <Label htmlFor={`${id}-description`}>{t("description")}</Label>
            <textarea
              id={`${id}-description`}
              dir="auto"
              rows={2}
              value={description}
              maxLength={ROLE_DESCRIPTION_MAX}
              onChange={(event) => {
                save.reset();
                setDescription(event.target.value);
              }}
              aria-invalid={Boolean(visible.description) || undefined}
              aria-describedby={describedBy("description")}
              className={TEXTAREA}
            />
            <FieldError id={errorId("description")} message={visible.description} />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">{t("permissions", { count: permissions.length })}</h3>
            <p className="text-xs text-slate-500">{t("permissionsHint")}</p>
            <PermissionChecklist
              idPrefix={`${id}-permission`}
              selected={permissions}
              onToggle={(permission, checked) => {
                save.reset();
                setPermissions(togglePermission(permissions, permission, checked));
              }}
            />
          </div>

          {role ? (
            <div>
              <Label htmlFor={`${id}-reason`}>{t("reason")}</Label>
              <textarea
                id={`${id}-reason`}
                dir="auto"
                rows={2}
                value={reason}
                onChange={(event) => {
                  save.reset();
                  setReason(event.target.value);
                }}
                aria-invalid={Boolean(visible.reason) || undefined}
                aria-describedby={describedBy("reason", `${id}-reason-hint`)}
                className={TEXTAREA}
              />
              <p id={`${id}-reason-hint`} className="mt-1 text-xs text-slate-500">
                {t("reasonHint", { count: role.memberCount })}
              </p>
              <FieldError id={errorId("reason")} message={visible.reason} />
            </div>
          ) : null}

          {showErrors && unchanged ? <p className="text-sm text-slate-600">{t("unchanged")}</p> : null}
          {save.isError ? (
            <div role="alert" className="space-y-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <p>{errorMessage(save.error)}</p>
              {permissionProblems.length > 0 ? (
                <ul className="list-disc ps-5">
                  {permissionProblems.map((problem) => (
                    <li key={problem.permission}>
                      {isPermission(problem.permission) && problem.missing
                        ? t("problem", {
                            permission: label("Permission", problem.permission),
                            missing: problem.missing.map((missing) => label("Permission", missing)).join("، "),
                          })
                        : t("unknownPermission")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t("saving") : editing ? t("save") : t("create")}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
