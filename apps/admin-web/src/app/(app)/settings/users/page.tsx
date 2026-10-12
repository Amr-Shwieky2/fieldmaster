"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { Member, MemberDevice } from "@fieldmaster/api-client";
import { AccountStatus, OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { DateTimeText, Phone } from "@/components/formatted";
import { ArrowStartIcon } from "@/components/icons";
import { ReasonForm } from "@/components/attendance/reason-form";

const MEMBERS_KEY = ["members"];
const ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.FIELD_MANAGER, OrgRole.WORKER];

/** An action waiting for its written reason. */
type Pending =
  | { kind: "role"; role: OrgRole }
  | { kind: "suspend" }
  | { kind: "reactivate" }
  | { kind: "archive" }
  | { kind: "timeTracking"; on: boolean }
  | { kind: "session"; deviceId: string; sessionId: string }
  | { kind: "key"; deviceId: string };

/**
 * Users, roles and devices (Step 6, Owners only). Every change needs a
 * reason and is audited by the API. Suspending or archiving a member ends
 * their sessions at once; an organization always keeps an active Owner.
 */
export default function UsersPage() {
  return (
    <OwnerOnly>
      <Users />
    </OwnerOnly>
  );
}

function Users() {
  const t = useTranslations("users");
  const label = useEnumLabel();
  const { client } = useAuth();
  const membersQuery = useQuery({ queryKey: MEMBERS_KEY, queryFn: () => client.listMembers() });
  const [open, setOpen] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const members = membersQuery.data ?? [];

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
                    <td className="px-2 py-2">{label("OrgRole", member.role)}</td>
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
                        <MemberPanel member={member} onDone={setAnnouncement} />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              ))}
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MemberPanel({ member, onDone }: { member: Member; onDone: (message: string) => void }) {
  const tActions = useTranslations("users.actions");
  const label = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [role, setRole] = useState<OrgRole>(member.role);
  const archived = member.status === AccountStatus.ARCHIVED;

  const act = useMutation({
    mutationFn: async ({ action, reason: why }: { action: Pending; reason: string }): Promise<string> => {
      const name = member.fullLegalName;
      switch (action.kind) {
        case "role":
          await client.changeMemberRole(member.id, action.role, why);
          return tActions("done.role", { name, role: label("OrgRole", action.role) });
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
    onSuccess: (message) => {
      setPending(null);
      onDone(message);
      void queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["member-devices", member.id] });
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
        return { label: tActions("reason.role", { role: label("OrgRole", action.role) }), submit: tActions("confirm.role"), danger: false };
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
              <Select id={`${id}-role`} value={role} onChange={(event) => setRole(event.target.value as OrgRole)}>
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {label("OrgRole", option)}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" variant="secondary" disabled={role === member.role} onClick={() => ask({ kind: "role", role })}>
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
          <p className="text-xs text-slate-500">{tActions("hint")}</p>
        </div>
      )}

      {pending && prompt ? (
        <div className="space-y-2">
          {pending.kind === "archive" ? <p className="text-sm text-amber-800">{tActions("archiveWarning")}</p> : null}
          {pending.kind === "suspend" ? <p className="text-sm text-amber-800">{tActions("suspendWarning")}</p> : null}
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
