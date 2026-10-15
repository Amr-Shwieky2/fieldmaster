"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Member, MemberAccess, MemberDevice, OwnerLimit, Project, Site } from "@fieldmaster/api-client";
import { AccountStatus, OrgRole, Permission } from "@fieldmaster/shared-types";
import { isForbidden, isNotFound } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useErrorMessage } from "@/lib/use-error-message";
import { orgKeys } from "@/lib/org-queries";
import { useEnumLabel } from "@/i18n/enums";
import { RequirePermission } from "@/components/require-permission";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { DateTimeText, Phone } from "@/components/formatted";
import { ArrowStartIcon } from "@/components/icons";
import { ReasonForm } from "@/components/attendance/reason-form";

const MEMBERS_KEY = ["members"];
/** The built-in roles, in the order the role list shows them (the custom roles follow). */
const BUILT_IN_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.FIELD_MANAGER, OrgRole.WORKER];
/** The fixed limit of active Owners before it became a setting: what an API without the setting still enforces. */
const LEGACY_MAX_OWNERS = 2;
/** The API's range for the limit of active Owners. */
const MAX_OWNERS_LIMIT = 100;

/** A role a member can be given: a built-in kind is sent as `{ role }`, any other role as `{ roleId }`. */
interface RoleChoice {
  value: string;
  label: string;
  target: OrgRole | { roleId: string };
}

/** A member's project scope: every project, or only the listed projects and sites. */
interface Scope {
  restricted: boolean;
  projectIds: string[];
  siteIds: string[];
}

/** An action waiting for its written reason. */
type Pending =
  | { kind: "role"; choice: RoleChoice }
  | { kind: "scope"; scope: Scope }
  | { kind: "suspend" }
  | { kind: "reactivate" }
  | { kind: "archive" }
  | { kind: "timeTracking"; on: boolean }
  | { kind: "session"; deviceId: string; sessionId: string }
  | { kind: "key"; deviceId: string };

const choiceValue = (roleId: string) => `role:${roleId}`;

/** The value of a member's current role in the role list. */
function currentRoleValue(member: Member, access: MemberAccess | undefined): string {
  if (member.role !== OrgRole.CUSTOM) return member.role;
  return access?.roleId ? choiceValue(access.roleId) : OrgRole.CUSTOM;
}

/**
 * Users, roles and devices (Step 6; whoever holds MANAGE_ORG_USERS). Every
 * change needs a reason and is audited by the API. A member gets a built-in
 * or a custom role, and may be restricted to some projects and sites (then
 * they never have the organization-wide permissions). Suspending or archiving
 * a member ends their sessions at once; an organization always keeps an
 * active Owner, and at most as many active Owners as its limit allows.
 */
export default function UsersPage() {
  return (
    <RequirePermission permission={Permission.MANAGE_ORG_USERS}>
      <Users />
    </RequirePermission>
  );
}

function Users() {
  const t = useTranslations("users");
  const label = useEnumLabel();
  const { client } = useAuth();
  const { can } = useAccess();
  const membersQuery = useQuery({ queryKey: MEMBERS_KEY, queryFn: () => client.listMembers() });
  // Each member's role record and project scope, joined by membership id (the members list only has the kind of role).
  const accessQuery = useQuery({ queryKey: orgKeys.memberAccess, queryFn: () => client.listMemberAccess() });
  // Every role a member can be given (built-in and custom); without it, the built-in ones are offered.
  const rolesQuery = useQuery({ queryKey: orgKeys.roles, queryFn: () => client.listRoles() });
  const canReadOwnerLimit = can(Permission.VIEW_ORG_SETTINGS);
  const ownerLimitQuery = useQuery({ queryKey: orgKeys.ownerLimit, queryFn: () => client.getOwnerLimit(), enabled: canReadOwnerLimit });
  const [open, setOpen] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const members = membersQuery.data ?? [];

  const accessByMember = useMemo(() => new Map((accessQuery.data ?? []).map((row) => [row.membershipId, row])), [accessQuery.data]);
  const choices = useMemo<RoleChoice[]>(() => {
    const roles = rolesQuery.data;
    if (!roles) return BUILT_IN_ROLES.map((role) => ({ value: role, label: label("OrgRole", role), target: role }));
    const builtIn = BUILT_IN_ROLES.filter((role) => roles.some((record) => record.systemKey === role && !record.archivedAt)).map((role) => ({
      value: role,
      label: label("OrgRole", role),
      target: role,
    }));
    const custom = roles
      .filter((record) => !record.isSystem && !record.archivedAt)
      .map((record) => ({ value: choiceValue(record.id), label: record.name, target: { roleId: record.id } }));
    return [...builtIn, ...custom];
  }, [rolesQuery.data, label]);
  // The Owners limit the hint states: unknown to a member who may not read it, the old fixed limit until (or unless) the API tells.
  const maxOwners: number | null | undefined = !canReadOwnerLimit ? undefined : ownerLimitQuery.data ? ownerLimitQuery.data.maxOwners : LEGACY_MAX_OWNERS;

  /** A member's role as shown: a custom role's own name, else the built-in role's label. */
  const roleName = (member: Member) =>
    member.role === OrgRole.CUSTOM ? (accessByMember.get(member.id)?.roleName ?? label("OrgRole", OrgRole.CUSTOM)) : label("OrgRole", member.role);

  return (
    <div className="space-y-6">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {t("backToSettings")}
      </Link>
      <PageHeader title={t("title")} description={t("description")} />
      <div role="status" aria-live="polite">
        {announcement ? <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{announcement}</p> : null}
      </div>
      {membersQuery.isPending && <LoadingState />}
      {membersQuery.isError && <ErrorState error={membersQuery.error} onRetry={() => void membersQuery.refetch()} />}
      {membersQuery.isSuccess && members.length === 0 ? <EmptyState title={t("empty")} /> : null}
      {members.length > 0 ? (
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
                    {t("columns.phone")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t("columns.role")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t("columns.status")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t("columns.timeTracking")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {t("columns.lastActive")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    <span className="sr-only">{t("columns.actions")}</span>
                  </th>
                </tr>
              </thead>
              {members.map((member) => (
                <tbody key={member.id} className="border-b border-slate-100 last:border-0">
                  <tr className="align-top">
                    <td className="px-2 py-2 font-medium text-slate-900">
                      {member.fullLegalName}
                      {member.isSelf ? (
                        <Badge tone="info" className="ms-2">
                          {t("self")}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <Phone value={member.phoneNumber} />
                    </td>
                    <td className="px-2 py-2">
                      {roleName(member)}
                      {accessByMember.get(member.id)?.restrictedToScope ? (
                        <Badge tone="warning" className="ms-2">
                          {t("scope.badge")}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={member.status === AccountStatus.SUSPENDED ? "warning" : statusTone(member.status)}>{label("AccountStatus", member.status)}</Badge>
                    </td>
                    <td className="px-2 py-2">{member.isTimeTrackable ? t("timeTrackingOn") : t("timeTrackingOff")}</td>
                    <td className="px-2 py-2">{member.lastActiveAt ? <DateTimeText value={member.lastActiveAt} /> : <span className="text-slate-500">{t("neverActive")}</span>}</td>
                    <td className="px-2 py-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-expanded={open === member.id}
                        aria-controls={`member-${member.id}`}
                        aria-label={t("manageFor", { name: member.fullLegalName })}
                        onClick={() => {
                          setAnnouncement(null);
                          setOpen(open === member.id ? null : member.id);
                        }}
                      >
                        {t("manage")}
                      </Button>
                    </td>
                  </tr>
                  {open === member.id ? (
                    <tr>
                      <td colSpan={7} id={`member-${member.id}`} className="px-2 pb-4">
                        <MemberPanel
                          member={member}
                          access={accessByMember.get(member.id)}
                          accessFailed={accessQuery.isError}
                          choices={choices}
                          currentRoleLabel={roleName(member)}
                          maxOwners={maxOwners}
                          onDone={setAnnouncement}
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              ))}
            </table>
          </CardContent>
        </Card>
      ) : null}
      {canReadOwnerLimit ? <OwnerLimitCard query={ownerLimitQuery} onDone={setAnnouncement} /> : null}
    </div>
  );
}

function MemberPanel({
  member,
  access,
  accessFailed,
  choices,
  currentRoleLabel,
  maxOwners,
  onDone,
}: {
  member: Member;
  /** The member's role record and scope (undefined until /memberships/access answers, or when it cannot be read). */
  access: MemberAccess | undefined;
  accessFailed: boolean;
  choices: RoleChoice[];
  currentRoleLabel: string;
  maxOwners: number | null | undefined;
  onDone: (message: string) => void;
}) {
  const tActions = useTranslations("users.actions");
  const errorMessage = useErrorMessage();
  const { client, refreshAccess } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const current = currentRoleValue(member, access);
  // The role chosen in the list (the member's own role until another one is chosen).
  const [selected, setSelected] = useState<string | null>(null);
  const role = selected ?? current;
  const archived = member.status === AccountStatus.ARCHIVED;
  // The member's own role is always in the list, even when the roles could not be loaded.
  const options = choices.some((choice) => choice.value === current)
    ? choices
    : [{ value: current, label: currentRoleLabel, target: access?.roleId ? { roleId: access.roleId } : member.role }, ...choices];
  const chosen = options.find((choice) => choice.value === role);

  const act = useMutation({
    mutationFn: async ({ action, reason: why }: { action: Pending; reason: string }): Promise<string> => {
      const name = member.fullLegalName;
      switch (action.kind) {
        case "role":
          await client.changeMemberRole(member.id, action.choice.target, why);
          return tActions("done.role", { name, role: action.choice.label });
        case "scope":
          await client.setMemberScope(member.id, { ...action.scope, reason: why });
          return action.scope.restricted ? tActions("done.scopeRestricted", { name }) : tActions("done.scopeAll", { name });
        case "suspend":
          await client.suspendMember(member.id, why);
          return tActions("done.suspend", { name });
        case "reactivate":
          await client.reactivateMember(member.id, why);
          return tActions("done.reactivate", { name });
        case "archive":
          await client.archiveMember(member.id, why);
          return tActions("done.archive", { name });
        case "timeTracking":
          await client.setMemberTimeTracking(member.id, action.on, why);
          return action.on ? tActions("done.timeTrackingOn", { name }) : tActions("done.timeTrackingOff", { name });
        case "session":
          await client.revokeMemberSession(member.id, action.sessionId, why);
          return tActions("done.session", { name });
        case "key":
          await client.revokeMemberDeviceKey(member.id, action.deviceId, why);
          return tActions("done.key", { name });
      }
    },
    onSuccess: (message, { action }) => {
      setPending(null);
      onDone(message);
      void queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["member-devices", member.id] });
      if (action.kind === "role" || action.kind === "scope" || action.kind === "suspend" || action.kind === "reactivate" || action.kind === "archive") {
        void queryClient.invalidateQueries({ queryKey: orgKeys.memberAccess });
        void queryClient.invalidateQueries({ queryKey: orgKeys.roles });
        void queryClient.invalidateQueries({ queryKey: orgKeys.ownerLimit });
        // The change may be the signed-in member's own: their permissions apply at the next request.
        void refreshAccess?.();
      }
    },
  });

  const ask = (action: Pending) => {
    act.reset();
    setReason("");
    setInvalid(false);
    setPending(action);
  };

  const prompt = pending ? promptTexts(pending) : null;
  function promptTexts(action: Pending): { label: string; submit: string; danger: boolean } {
    switch (action.kind) {
      case "role":
        return { label: tActions("reason.role", { role: action.choice.label }), submit: tActions("confirm.role"), danger: false };
      case "scope":
        return { label: tActions("reason.scope"), submit: tActions("confirm.scope"), danger: false };
      case "suspend":
        return { label: tActions("reason.suspend"), submit: tActions("confirm.suspend"), danger: true };
      case "reactivate":
        return { label: tActions("reason.reactivate"), submit: tActions("confirm.reactivate"), danger: false };
      case "archive":
        return { label: tActions("reason.archive"), submit: tActions("confirm.archive"), danger: true };
      case "timeTracking":
        return { label: action.on ? tActions("reason.timeTrackingOn") : tActions("reason.timeTrackingOff"), submit: tActions("confirm.timeTracking"), danger: false };
      case "session":
        return { label: tActions("reason.session"), submit: tActions("confirm.session"), danger: true };
      case "key":
        return { label: tActions("reason.key"), submit: tActions("confirm.key"), danger: true };
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-white p-4">
      {archived ? (
        <p className="text-slate-600">{tActions("archivedNote")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor={`${id}-role`}>{tActions("roleLabel")}</Label>
              <Select id={`${id}-role`} value={role} onChange={(event) => setSelected(event.target.value)}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" variant="secondary" disabled={role === current || !chosen} onClick={() => chosen && ask({ kind: "role", choice: chosen })}>
              {tActions("changeRole")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {member.status === AccountStatus.ACTIVE ? (
              <Button size="sm" variant="secondary" onClick={() => ask({ kind: "suspend" })}>
                {tActions("suspend")}
              </Button>
            ) : null}
            {member.status === AccountStatus.SUSPENDED ? (
              <Button size="sm" variant="secondary" onClick={() => ask({ kind: "reactivate" })}>
                {tActions("reactivate")}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => ask({ kind: "timeTracking", on: !member.isTimeTrackable })}>
              {member.isTimeTrackable ? tActions("timeTrackingOff") : tActions("timeTrackingOn")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => ask({ kind: "archive" })}>
              {tActions("archive")}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            {maxOwners === undefined ? tActions("hintAtLeastOne") : maxOwners === null ? tActions("hintNoLimit") : tActions("hint", { max: maxOwners })}
          </p>
          {access ? (
            <ScopeSection
              // A saved change of scope starts the section over (the editor closes, showing the new scope).
              key={`${access.restrictedToScope}:${access.projectIds.join(",")}:${access.siteIds.join(",")}`}
              access={access}
              busy={act.isPending}
              onSubmit={(scope) => ask({ kind: "scope", scope })}
              editingDisabled={pending !== null}
            />
          ) : accessFailed ? (
            <p className="text-xs text-slate-500">{tActions("scopeUnavailable")}</p>
          ) : null}
        </div>
      )}

      {pending && prompt ? (
        <div className="space-y-2">
          {pending.kind === "archive" ? <p className="text-sm text-amber-800">{tActions("archiveWarning")}</p> : null}
          {pending.kind === "suspend" ? <p className="text-sm text-amber-800">{tActions("suspendWarning")}</p> : null}
          {pending.kind === "scope" && pending.scope.restricted ? <p className="text-sm text-amber-800">{tActions("scopeWarning")}</p> : null}
          <ReasonForm
            id={`${id}-reason`}
            label={prompt.label}
            hint={tActions("reasonHint")}
            value={reason}
            invalid={invalid}
            onChange={(value) => {
              setReason(value);
              setInvalid(false);
            }}
            onSubmit={(why) => (why.length === 0 ? setInvalid(true) : act.mutate({ action: pending, reason: why }))}
            onCancel={() => {
              act.reset();
              setPending(null);
            }}
            submitLabel={prompt.submit}
            pendingLabel={tActions("sending")}
            pending={act.isPending}
            busy={act.isPending}
            variant={prompt.danger ? "danger" : "primary"}
          />
        </div>
      ) : null}
      {act.isError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage(act.error)}
        </p>
      ) : null}

      <DevicesList member={member} onRevokeSession={(deviceId, sessionId) => ask({ kind: "session", deviceId, sessionId })} onRevokeKey={(deviceId) => ask({ kind: "key", deviceId })} />
    </div>
  );
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value) => b.includes(value));

/**
 * A member's project scope: every project, or only some projects (each with
 * all its sites) and some sites. A restricted member sees and acts only there,
 * and never has the organization-wide permissions, whatever their role.
 */
function ScopeSection({
  access,
  busy,
  editingDisabled,
  onSubmit,
}: {
  access: MemberAccess;
  busy: boolean;
  editingDisabled: boolean;
  onSubmit: (scope: Scope) => void;
}) {
  const tScope = useTranslations("users.scope");
  const { client } = useAuth();
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [restricted, setRestricted] = useState(access.restrictedToScope);
  const [projectIds, setProjectIds] = useState<string[]>(access.projectIds);
  const [siteIds, setSiteIds] = useState<string[]>(access.siteIds);
  const [showError, setShowError] = useState(false);
  // Names of the projects and sites: only needed to show a restricted scope or to edit it.
  const needsPlaces = editing || access.restrictedToScope;
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => client.listProjects(), enabled: needsPlaces });
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: () => client.listSites(), enabled: needsPlaces });
  const projects: Project[] = projectsQuery.data ?? [];
  const sites: Site[] = sitesQuery.data ?? [];

  // Sites of a chosen project are covered by it: only the others are sent.
  const sentSiteIds = siteIds.filter((siteId) => !projectIds.includes(sites.find((site) => site.id === siteId)?.projectId ?? ""));
  const empty = restricted && projectIds.length === 0 && sentSiteIds.length === 0;
  const unchanged =
    restricted === access.restrictedToScope && (!restricted || (sameIds(projectIds, access.projectIds) && sameIds(sentSiteIds, access.siteIds)));

  const names = [
    ...access.projectIds.map((projectId) => projects.find((project) => project.id === projectId)?.name),
    ...access.siteIds.map((siteId) => {
      const site = sites.find((candidate) => candidate.id === siteId);
      if (!site) return undefined;
      const project = projects.find((candidate) => candidate.id === site.projectId);
      return project ? tScope("siteOfProject", { site: site.name, project: project.name }) : site.name;
    }),
  ].filter((name): name is string => Boolean(name));

  const toggle = (list: string[], value: string, checked: boolean) => (checked ? [...list, value] : list.filter((item) => item !== value));

  const reset = () => {
    setRestricted(access.restrictedToScope);
    setProjectIds(access.projectIds);
    setSiteIds(access.siteIds);
    setShowError(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowError(true);
    if (empty || unchanged) return;
    onSubmit(restricted ? { restricted: true, projectIds, siteIds: sentSiteIds } : { restricted: false, projectIds: [], siteIds: [] });
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-700">
          <span className="font-medium text-slate-900">{tScope("title")}: </span>
          {access.restrictedToScope ? (names.length > 0 ? tScope("restrictedTo", { places: names.join("، ") }) : tScope("restricted")) : tScope("all")}
        </p>
        {editing ? null : (
          <Button
            size="sm"
            variant="secondary"
            disabled={editingDisabled}
            onClick={() => {
              reset();
              setEditing(true);
            }}
          >
            {tScope("change")}
          </Button>
        )}
      </div>
      {editing ? (
        <form noValidate onSubmit={submit} className="space-y-3" aria-label={tScope("legend")}>
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-medium text-slate-700">{tScope("legend")}</legend>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input type="radio" name={`${id}-scope`} checked={!restricted} onChange={() => setRestricted(false)} />
              {tScope("all")}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input type="radio" name={`${id}-scope`} checked={restricted} onChange={() => setRestricted(true)} />
              {tScope("some")}
            </label>
          </fieldset>
          {restricted ? (
            <div className="space-y-2">
              {projectsQuery.isPending || sitesQuery.isPending ? <LoadingState label={tScope("loadingPlaces")} /> : null}
              {projectsQuery.isError || sitesQuery.isError ? (
                <p className="text-sm text-red-700">{isForbidden(projectsQuery.error ?? sitesQuery.error) ? tScope("placesForbidden") : tScope("placesFailed")}</p>
              ) : null}
              {projectsQuery.isSuccess && projects.length === 0 ? <p className="text-sm text-slate-500">{tScope("noProjects")}</p> : null}
              <ul className="space-y-2" aria-label={tScope("placesLabel")}>
                {projects.map((project) => {
                  const whole = projectIds.includes(project.id);
                  const projectSites = sites.filter((site) => site.projectId === project.id);
                  return (
                    <li key={project.id} className="rounded-md bg-slate-50 p-2">
                      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        <input
                          type="checkbox"
                          checked={whole}
                          aria-describedby={`${id}-whole-hint`}
                          onChange={(event) => setProjectIds(toggle(projectIds, project.id, event.target.checked))}
                        />
                        {project.name}
                      </label>
                      {projectSites.length > 0 ? (
                        <ul className="mt-1 space-y-1 ps-6">
                          {projectSites.map((site) => (
                            <li key={site.id}>
                              <label className="flex items-center gap-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={whole || siteIds.includes(site.id)}
                                  disabled={whole}
                                  onChange={(event) => setSiteIds(toggle(siteIds, site.id, event.target.checked))}
                                />
                                {site.name}
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <p id={`${id}-whole-hint`} className="text-xs text-slate-500">
                {tScope("wholeProjectHint")}
              </p>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">{tScope("orgWideNote")}</p>
          {showError && empty ? (
            <p role="alert" className="text-xs text-red-600">
              {tScope("emptyError")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || unchanged}>
              {tScope("save")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                reset();
                setEditing(false);
              }}
            >
              {tScope("cancel")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * The organization's limit of active Owners (empty = no limit) and how many
 * there are now. Changing it needs MANAGE_ORG_SETTINGS (the API's `canEdit`)
 * and a reason; it never goes below the active Owners. While it loads nothing
 * is shown, and a failure is a quiet note (the members list is the page's
 * main content).
 */
function OwnerLimitCard({ query, onDone }: { query: { data?: OwnerLimit; isError: boolean; error: unknown; refetch: () => unknown }; onDone: (message: string) => void }) {
  const tLimit = useTranslations("users.ownerLimit");
  const tActions = useTranslations("users.actions");
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { can } = useAccess();
  const queryClient = useQueryClient();
  const id = useId();
  const limit = query.data;
  const [value, setValue] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const save = useMutation({
    mutationFn: ({ maxOwners, why }: { maxOwners: number | null; why: string }) => client.updateOwnerLimit(maxOwners, why),
    onSuccess: (updated) => {
      queryClient.setQueryData(orgKeys.ownerLimit, updated);
      setValue(null);
      setReason("");
      setShowErrors(false);
      onDone(updated.maxOwners === null ? tLimit("doneNoLimit") : tLimit("done", { max: updated.maxOwners }));
    },
  });

  if (query.isError) {
    // Not allowed to read it, or an API without the setting (its fixed limit applies): nothing to show.
    if (isForbidden(query.error) || isNotFound(query.error)) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <span>{tLimit("loadFailed")}</span>
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
          {tLimit("reload")}
        </Button>
      </div>
    );
  }
  if (!limit) return null;

  const editable = limit.canEdit && can(Permission.MANAGE_ORG_SETTINGS);
  const text = value ?? (limit.maxOwners === null ? "" : String(limit.maxOwners));
  const trimmed = text.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const minimum = Math.max(1, limit.activeOwners);
  const problems: { value?: string; reason?: string } = {};
  if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_OWNERS_LIMIT)) problems.value = tLimit("rangeError", { min: minimum, max: MAX_OWNERS_LIMIT });
  else if (parsed !== null && parsed < limit.activeOwners) problems.value = tLimit("belowActive", { count: limit.activeOwners });
  if (reason.trim() === "") problems.reason = tActions("reasonRequired");
  const unchanged = parsed === limit.maxOwners;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (unchanged || problems.value || problems.reason) return;
    save.mutate({ maxOwners: parsed, why: reason.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tLimit("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{tLimit("current")}</dt>
            <dd className="font-medium text-slate-900">{limit.maxOwners === null ? tLimit("noLimit") : limit.maxOwners}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{tLimit("active")}</dt>
            <dd className="font-medium text-slate-900">{limit.activeOwners}</dd>
          </div>
        </dl>
        {editable ? (
          <form noValidate onSubmit={submit} className="space-y-3">
            <div>
              <Label htmlFor={`${id}-max`}>{tLimit("label")}</Label>
              <Input
                id={`${id}-max`}
                type="number"
                inputMode="numeric"
                dir="ltr"
                min={minimum}
                max={MAX_OWNERS_LIMIT}
                step={1}
                className="w-32"
                value={text}
                onChange={(event) => {
                  save.reset();
                  setValue(event.target.value);
                }}
                aria-invalid={(showErrors && Boolean(problems.value)) || undefined}
                aria-describedby={`${id}-max-hint${showErrors && problems.value ? ` ${id}-max-error` : ""}`}
              />
              <p id={`${id}-max-hint`} className="mt-1 text-xs text-slate-500">
                {tLimit("hint", { count: limit.activeOwners })}
              </p>
              {showErrors && problems.value ? (
                <p id={`${id}-max-error`} role="alert" className="mt-1 text-xs text-red-600">
                  {problems.value}
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor={`${id}-reason`}>{tLimit("reasonLabel")}</Label>
              <textarea
                id={`${id}-reason`}
                dir="auto"
                rows={2}
                value={reason}
                onChange={(event) => {
                  save.reset();
                  setReason(event.target.value);
                }}
                aria-invalid={(showErrors && Boolean(problems.reason)) || undefined}
                aria-describedby={`${id}-reason-hint${showErrors && problems.reason ? ` ${id}-reason-error` : ""}`}
                className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p id={`${id}-reason-hint`} className="mt-1 text-xs text-slate-500">
                {tActions("reasonHint")}
              </p>
              {showErrors && problems.reason ? (
                <p id={`${id}-reason-error`} role="alert" className="mt-1 text-xs text-red-600">
                  {problems.reason}
                </p>
              ) : null}
            </div>
            {showErrors && unchanged ? <p className="text-xs text-slate-600">{tLimit("unchanged")}</p> : null}
            {save.isError ? (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage(save.error)}
              </p>
            ) : null}
            <Button type="submit" size="sm" disabled={save.isPending}>
              {save.isPending ? tActions("sending") : tLimit("save")}
            </Button>
          </form>
        ) : (
          <p className="text-xs text-slate-500">{tLimit("readOnly")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DevicesList({
  member,
  onRevokeSession,
  onRevokeKey,
}: {
  member: Member;
  onRevokeSession: (deviceId: string, sessionId: string) => void;
  onRevokeKey: (deviceId: string) => void;
}) {
  const tDevices = useTranslations("users.devices");
  const { client } = useAuth();
  const devicesQuery = useQuery({ queryKey: ["member-devices", member.id], queryFn: () => client.listMemberDevices(member.id) });
  const devices = devicesQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tDevices("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {devicesQuery.isPending && <LoadingState />}
        {devicesQuery.isError && <ErrorState error={devicesQuery.error} onRetry={() => void devicesQuery.refetch()} />}
        {devicesQuery.isSuccess && devices.length === 0 ? <p className="text-slate-500">{tDevices("empty")}</p> : null}
        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} member={member} onRevokeSession={onRevokeSession} onRevokeKey={onRevokeKey} />
        ))}
      </CardContent>
    </Card>
  );
}

function DeviceRow({
  device,
  member,
  onRevokeSession,
  onRevokeKey,
}: {
  device: MemberDevice;
  member: Member;
  onRevokeSession: (deviceId: string, sessionId: string) => void;
  onRevokeKey: (deviceId: string) => void;
}) {
  const tDevices = useTranslations("users.devices");
  const archived = member.status === AccountStatus.ARCHIVED;
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-slate-900">
          {tDevices.has(`platforms.${device.platform}`) ? tDevices(`platforms.${device.platform}`) : tDevices("platforms.other")}
          {device.appVersion ? <span className="ms-2 text-xs text-slate-500">{tDevices("appVersion", { version: device.appVersion })}</span> : null}
        </p>
        <Badge tone={device.key.status === "ACTIVE" ? "success" : device.key.status === "REVOKED" ? "danger" : "neutral"}>{tDevices(`key.${device.key.status}`)}</Badge>
      </div>
      <p className="text-xs text-slate-500">
        {device.lastActiveAt ? tDevices.rich("lastActive", { time: () => <DateTimeText value={device.lastActiveAt} /> }) : tDevices("neverActive")}
      </p>
      {device.key.status === "ACTIVE" && !archived ? (
        <Button size="sm" variant="secondary" onClick={() => onRevokeKey(device.id)}>
          {tDevices("revokeKey")}
        </Button>
      ) : null}
      <ul className="space-y-1">
        {device.sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1">
            <span className="text-slate-700">
              {tDevices.rich("session", {
                origin: tDevices.has(`origins.${session.origin}`) ? tDevices(`origins.${session.origin}`) : tDevices("origins.other"),
                started: () => <DateTimeText value={session.createdAt} />,
                used: () => <DateTimeText value={session.lastUsedAt} />,
              })}
            </span>
            {session.active ? (
              <span className="flex items-center gap-2">
                <Badge tone="success">{tDevices("sessionActive")}</Badge>
                <Button size="sm" variant="ghost" onClick={() => onRevokeSession(device.id, session.id)}>
                  {tDevices("revokeSession")}
                </Button>
              </span>
            ) : (
              <Badge tone="neutral">{tDevices("sessionEnded")}</Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
