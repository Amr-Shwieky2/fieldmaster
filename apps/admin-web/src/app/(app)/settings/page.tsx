"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { NotificationPreferenceView, OrganizationSettingsView, WorkdaySettings } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/page-header";
import { LtrText, Money } from "@/components/formatted";

const QUERY_KEY = ["organization-settings"];

/** The numeric workday settings: key, unit (`units.*`) and allowed range (the API's limits). */
const WORKDAY_NUMBERS = [
  { key: "defaultGraceMinutes", unit: "minutes", min: 0, max: 120 },
  { key: "defaultGeofenceRadiusMeters", unit: "meters", min: 10, max: 5000 },
  { key: "defaultMinGpsAccuracyMeters", unit: "meters", min: 5, max: 500 },
  { key: "deviceTimeDeviationSeconds", unit: "seconds", min: 10, max: 3600 },
  { key: "temporaryPointRadiusMeters", unit: "meters", min: 10, max: 2000 },
  { key: "temporaryPointMinAccuracyMeters", unit: "meters", min: 5, max: 500 },
] as const;
type WorkdayNumberKey = (typeof WORKDAY_NUMBERS)[number]["key"];

/**
 * Organization settings (Step 6). Whoever holds MANAGE_ORG_SETTINGS changes
 * each section on its own (the API audits every changed value, old -> new);
 * with VIEW_ORG_SETTINGS alone the same values are shown read-only, without
 * any amount. The work rules in force today and the test-mode status are
 * shown but never edited here (the work rules have their own page, as
 * effective-dated versions).
 */
export default function SettingsPage() {
  const t = useTranslations("settings");
  const { client } = useAuth();
  const { can } = useAccess();
  const settingsQuery = useQuery({ queryKey: QUERY_KEY, queryFn: () => client.getOrganizationSettings() });
  const settings = settingsQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            {can(Permission.MANAGE_ORG_USERS) ? (
              <Link href="/settings/users" className="text-sm font-medium text-brand-700 hover:underline">
                {t("usersLink")}
              </Link>
            ) : null}
            {can(Permission.MANAGE_ROLES) ? (
              <Link href="/settings/roles" className="text-sm font-medium text-brand-700 hover:underline">
                {t("rolesLink")}
              </Link>
            ) : null}
            <Link href="/settings/work-rules" className="text-sm font-medium text-brand-700 hover:underline">
              {t("workRulesLink")}
            </Link>
          </>
        }
      />
      {settingsQuery.isPending && <LoadingState />}
      {settingsQuery.isError && <ErrorState error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()} />}
      {settings ? (
        <>
          {!settings.canEdit ? <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">{t("readOnly")}</p> : null}
          <WorkdaySection settings={settings} />
          <OnboardingSection settings={settings} />
          <NotificationsSection settings={settings} />
          <TestModeSection settings={settings} />
          <FixedRulesSection settings={settings} />
        </>
      ) : null}
    </div>
  );
}

/** Saves one section and shows its own success or error. */
function useSectionSave<T>(save: (input: T) => Promise<OrganizationSettingsView>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onSuccess: (updated) => queryClient.setQueryData(QUERY_KEY, updated),
  });
}

function SectionStatus({ error, saved }: { error: unknown; saved: boolean }) {
  const t = useTranslations("settings");
  const errorMessage = useErrorMessage();
  return (
    <div aria-live="polite">
      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage(error)}
        </p>
      ) : saved ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{t("saved")}</p>
      ) : null}
    </div>
  );
}

function SectionCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-slate-500">{description}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function WorkdaySection({ settings }: { settings: OrganizationSettingsView }) {
  const tWorkday = useTranslations("settings.workday");
  const tUnits = useTranslations("settings.units");
  const tc = useTranslations("settings");
  const { client } = useAuth();
  const id = useId();
  const initial = Object.fromEntries(WORKDAY_NUMBERS.map(({ key }) => [key, String(settings.workday[key])])) as Record<WorkdayNumberKey, string>;
  const [values, setValues] = useState(initial);
  const [autoDeduct, setAutoDeduct] = useState(settings.workday.autoDeductUnpaidBreaks);
  const [showErrors, setShowErrors] = useState(false);
  const save = useSectionSave((input: Partial<WorkdaySettings>) => client.updateWorkdaySettings(input));

  const invalid = Object.fromEntries(
    WORKDAY_NUMBERS.map(({ key, min, max }) => {
      const value = Number(values[key]);
      return [key, values[key].trim() === "" || !Number.isInteger(value) || value < min || value > max];
    }),
  ) as Record<WorkdayNumberKey, boolean>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.values(invalid).some(Boolean)) return;
    save.mutate({ ...Object.fromEntries(WORKDAY_NUMBERS.map(({ key }) => [key, Number(values[key])])), autoDeductUnpaidBreaks: autoDeduct });
  };

  return (
    <SectionCard title={tWorkday("title")} description={tWorkday("description")}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {WORKDAY_NUMBERS.map(({ key, unit, min, max }) => (
            <div key={key}>
              <Label htmlFor={`${id}-${key}`}>{tWorkday(`fields.${key}.label`)}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-${key}`}
                  type="number"
                  inputMode="numeric"
                  dir="ltr"
                  min={min}
                  max={max}
                  step={1}
                  className="w-32"
                  value={values[key]}
                  disabled={!settings.canEdit}
                  onChange={(event) => {
                    save.reset();
                    setValues({ ...values, [key]: event.target.value });
                  }}
                  aria-invalid={(showErrors && invalid[key]) || undefined}
                  aria-describedby={`${id}-${key}-hint${showErrors && invalid[key] ? ` ${id}-${key}-error` : ""}`}
                />
                <span className="text-slate-600">{tUnits(unit)}</span>
              </div>
              <p id={`${id}-${key}-hint`} className="mt-1 text-xs text-slate-500">
                {tWorkday(`fields.${key}.hint`)}
              </p>
              {showErrors && invalid[key] ? (
                <p id={`${id}-${key}-error`} role="alert" className="mt-1 text-xs text-red-600">
                  {tc("rangeError", { min, max })}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <div>
          <label className="flex items-center gap-2 text-slate-800">
            <input
              type="checkbox"
              checked={autoDeduct}
              disabled={!settings.canEdit}
              onChange={(event) => {
                save.reset();
                setAutoDeduct(event.target.checked);
              }}
            />
            {tWorkday("fields.autoDeductUnpaidBreaks.label")}
          </label>
          <p className="mt-1 text-xs text-slate-500">{tWorkday("fields.autoDeductUnpaidBreaks.hint")}</p>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-slate-500">{tWorkday("timezone")}</p>
          <p className="font-medium text-slate-900">{tWorkday.rich("timezoneValue", { zone: () => <LtrText>{settings.workday.timezone}</LtrText> })}</p>
          <p className="text-xs text-slate-500">{tWorkday("timezoneHint")}</p>
        </div>
        <SectionStatus error={save.error} saved={save.isSuccess} />
        {settings.canEdit ? (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? tc("saving") : tWorkday("save")}
          </Button>
        ) : null}
      </form>
    </SectionCard>
  );
}

function OnboardingSection({ settings }: { settings: OrganizationSettingsView }) {
  const tOnboarding = useTranslations("settings.onboarding");
  const tc = useTranslations("settings");
  const { client } = useAuth();
  const id = useId();
  const [hours, setHours] = useState(String(settings.onboarding.invitationTtlHours));
  const [showErrors, setShowErrors] = useState(false);
  const save = useSectionSave((input: { invitationTtlHours: number }) => client.updateOnboardingSettings(input));
  const value = Number(hours);
  const invalid = hours.trim() === "" || !Number.isInteger(value) || value < 1 || value > 720;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (!invalid) save.mutate({ invitationTtlHours: value });
  };

  return (
    <SectionCard title={tOnboarding("title")} description={tOnboarding("description")}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor={`${id}-ttl`}>{tOnboarding("invitationTtlHours")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`${id}-ttl`}
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={1}
              max={720}
              step={1}
              className="w-32"
              value={hours}
              disabled={!settings.canEdit}
              onChange={(event) => {
                save.reset();
                setHours(event.target.value);
              }}
              aria-invalid={(showErrors && invalid) || undefined}
              aria-describedby={showErrors && invalid ? `${id}-ttl-error` : `${id}-ttl-hint`}
            />
            <span className="text-slate-600">{tOnboarding("hours")}</span>
          </div>
          {showErrors && invalid ? (
            <p id={`${id}-ttl-error`} role="alert" className="mt-1 text-xs text-red-600">
              {tc("rangeError", { min: 1, max: 720 })}
            </p>
          ) : (
            <p id={`${id}-ttl-hint`} className="mt-1 text-xs text-slate-500">
              {tOnboarding("invitationTtlHint")}
            </p>
          )}
        </div>
        <SectionStatus error={save.error} saved={save.isSuccess} />
        {settings.canEdit ? (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? tc("saving") : tOnboarding("save")}
          </Button>
        ) : null}
      </form>
    </SectionCard>
  );
}

function NotificationsSection({ settings }: { settings: OrganizationSettingsView }) {
  const tNotifications = useTranslations("settings.notifications");
  const tc = useTranslations("settings");
  const label = useEnumLabel();
  const { client } = useAuth();
  const [choices, setChoices] = useState(() => new Map(settings.notifications.map((item) => [item.type, { owners: item.owners, fieldManagers: item.fieldManagers }])));
  const save = useSectionSave((preferences: { type: NotificationPreferenceView["type"]; owners: boolean; fieldManagers: boolean }[]) =>
    client.updateNotificationSettings(preferences),
  );

  const toggle = (type: NotificationPreferenceView["type"], audience: "owners" | "fieldManagers", value: boolean) => {
    save.reset();
    const next = new Map(choices);
    next.set(type, { ...next.get(type)!, [audience]: value });
    setChoices(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate([...choices.entries()].map(([type, choice]) => ({ type, ...choice })));
  };

  return (
    <SectionCard title={tNotifications("title")} description={tNotifications("description")}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{tNotifications("caption")}</caption>
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {tNotifications("event")}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {tNotifications("owners")}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {tNotifications("fieldManagers")}
                </th>
              </tr>
            </thead>
            <tbody>
              {settings.notifications.map((item) => {
                const choice = choices.get(item.type)!;
                const name = label("NotificationType", item.type);
                return (
                  <tr key={item.type} className="border-b border-slate-100 align-top last:border-0">
                    <th scope="row" className="px-2 py-2 text-start font-normal">
                      <p className="font-medium text-slate-900">{name}</p>
                      <p className="text-xs text-slate-500">{tNotifications(`audience.${item.fieldManagerAudience}`)}</p>
                    </th>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={tNotifications("ownersFor", { event: name })}
                        checked={choice.owners}
                        disabled={!settings.canEdit}
                        onChange={(event) => toggle(item.type, "owners", event.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={tNotifications("fieldManagersFor", { event: name })}
                        checked={choice.fieldManagers}
                        disabled={!settings.canEdit}
                        onChange={(event) => toggle(item.type, "fieldManagers", event.target.checked)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">{tNotifications("customRolesHint")}</p>
        <p className="text-xs text-slate-500">{tNotifications("hint")}</p>
        <SectionStatus error={save.error} saved={save.isSuccess} />
        {settings.canEdit ? (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? tc("saving") : tNotifications("save")}
          </Button>
        ) : null}
      </form>
    </SectionCard>
  );
}

function TestModeSection({ settings }: { settings: OrganizationSettingsView }) {
  const tTestMode = useTranslations("settings.testMode");
  return (
    <SectionCard title={tTestMode("title")} description={tTestMode("description")}>
      <dl className="space-y-2">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2">
          <dt className="text-slate-500">{tTestMode("appEnv")}</dt>
          <dd className="font-medium text-slate-900">
            <LtrText>{settings.testMode.appEnv}</LtrText>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-slate-500">{tTestMode("devLogin")}</dt>
          <dd>
            <Badge tone={settings.testMode.devLoginEnabled ? "warning" : "neutral"}>{settings.testMode.devLoginEnabled ? tTestMode("on") : tTestMode("off")}</Badge>
          </dd>
        </div>
      </dl>
    </SectionCard>
  );
}

/** The work rules in force today (the API reads them from the current version), read-only; they change on the work rules page. */
function FixedRulesSection({ settings }: { settings: OrganizationSettingsView }) {
  const tRules = useTranslations("settings.fixedRules");
  const rules = settings.fixedRules;
  return (
    <SectionCard title={tRules("title")} description={tRules("description")}>
      <ul className="list-disc space-y-2 ps-5 text-slate-800">
        <li>{tRules("standardDay", { minutes: rules.standardDayMinutes, hours: rules.standardDayMinutes / 60 })}</li>
        <li>{tRules("freeForgottenStamps", { count: rules.freeForgottenStampsPerMonth })}</li>
        <li>
          {rules.forgottenStampPenaltyAgorot !== undefined
            ? tRules.rich("penaltyOwner", { amount: () => <Money agorot={rules.forgottenStampPenaltyAgorot} /> })
            : tRules("penaltyFieldManager")}
        </li>
        <li>{tRules("emergency", { before: rules.emergencyRetroactiveMinutes, after: rules.emergencyReturnBufferMinutes })}</li>
      </ul>
      <Link href="/settings/work-rules" className="inline-block text-sm font-medium text-brand-700 hover:underline">
        {settings.canEdit ? tRules("editLink") : tRules("viewLink")}
      </Link>
    </SectionCard>
  );
}
