"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CreateWorkRuleVersionInput, WorkRuleVersionView, WorkRulesView } from "@fieldmaster/api-client";
import { Permission, WORK_RULE_LIMITS, WORK_RULES_FIRST_EFFECTIVE_DATE, type WorkRuleKey, type WorkRules } from "@fieldmaster/shared-types";
import { toWesternDigits } from "@fieldmaster/i18n";
import { useAuth } from "@/lib/auth-context";
import { useAccess } from "@/lib/use-access";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { orgKeys } from "@/lib/org-queries";
import { BUSINESS_DATE_PATTERN } from "@/lib/jerusalem-time";
import { useEnumLabel } from "@/i18n/enums";
import { RequirePermission } from "@/components/require-permission";
import { PageHeader } from "@/components/page-header";
import { ArrowStartIcon } from "@/components/icons";
import { BusinessDateText, DateTimeText, MonthText } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { WORK_RULE_UNITS, WorkRuleValue, useDurationText, visibleRuleKeys } from "@/components/work-rules/work-rule-text";

const REASON_MAX = 500;
const TEXTAREA = "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

/** `YYYY-MM-DD` plus some days (calendar arithmetic, no time zone involved). */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The version in force on a business date: the latest effective date on or before it (the later version when two share it). */
function versionOn(versions: readonly WorkRuleVersionView[], date: string): WorkRuleVersionView | null {
  let best: WorkRuleVersionView | null = null;
  for (const candidate of versions) {
    if (candidate.effectiveFrom > date) continue;
    if (!best || candidate.effectiveFrom > best.effectiveFrom || (candidate.effectiveFrom === best.effectiveFrom && candidate.version > best.version)) best = candidate;
  }
  return best;
}

/**
 * The organization's work rules (VIEW_ORG_SETTINGS; changed with
 * MANAGE_ORG_SETTINGS): the values the attendance and payroll calculations
 * use, kept as effective-dated versions. A change is a new version that
 * starts after today -- never an edit of a past day -- so what was already
 * calculated is never rewritten, and a finalized payroll month keeps its own
 * numbers. The penalty is money: it is shown, and may be changed, only by a
 * member who may see money.
 */
export default function WorkRulesPage() {
  return (
    <RequirePermission permission={Permission.VIEW_ORG_SETTINGS}>
      <WorkRulesContent />
    </RequirePermission>
  );
}

function WorkRulesContent() {
  const t = useTranslations("workRules");
  const tUsers = useTranslations("users");
  const { client } = useAuth();
  const { can } = useAccess();
  const query = useQuery({ queryKey: orgKeys.workRules, queryFn: () => client.getWorkRules() });
  const [changing, setChanging] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const view = query.data;
  // Money only when the API says so and the member holds the permission (both, as a second check).
  const showMoney = view !== undefined && view.canSeeMoney && can(Permission.VIEW_FINANCIALS);
  const canEdit = view !== undefined && view.canEdit && can(Permission.MANAGE_ORG_SETTINGS);

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <ArrowStartIcon />
        {tUsers("backToSettings")}
      </Link>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canEdit && !changing ? (
            <Button
              onClick={() => {
                setAnnouncement(null);
                setChanging(true);
              }}
            >
              {t("change")}
            </Button>
          ) : null
        }
      />
      <div role="status" aria-live="polite">
        {announcement ? <p className="rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{announcement}</p> : null}
      </div>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {view ? (
        <>
          {!view.canEdit ? <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">{t("readOnly")}</p> : null}
          <CurrentRules view={view} showMoney={showMoney} />
          {changing && canEdit ? (
            <ChangeRulesForm
              view={view}
              showMoney={showMoney}
              onCancel={() => setChanging(false)}
              onSaved={(message) => {
                setChanging(false);
                setAnnouncement(message);
              }}
            />
          ) : null}
          <History view={view} showMoney={showMoney} />
        </>
      ) : null}
    </div>
  );
}

/** The rules in force today, each with what it means; a version that has not started yet is announced. */
function CurrentRules({ view, showMoney }: { view: WorkRulesView; showMoney: boolean }) {
  const t = useTranslations("workRules");
  const inForce = versionOn(view.versions, view.today);
  const upcoming = view.versions.filter((version) => version.effectiveFrom > view.today);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("current.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-slate-500">
          {!inForce || inForce.effectiveFrom === WORK_RULES_FIRST_EFFECTIVE_DATE
            ? t("current.sinceStart")
            : t.rich("current.since", { version: inForce.version, date: () => <BusinessDateText value={inForce.effectiveFrom} /> })}
        </p>
        <dl className="divide-y divide-slate-100">
          {visibleRuleKeys(showMoney).map((key) => (
            <div key={key} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4">
              <dt className="font-medium text-slate-700">{t(`rules.${key}.label`)}</dt>
              <dd className="sm:col-span-2">
                <p className="font-semibold text-slate-900">
                  <WorkRuleValue ruleKey={key} rules={view.current} showMoney={showMoney} />
                </p>
                <p className="text-xs text-slate-500">{t(`rules.${key}.hint`)}</p>
              </dd>
            </div>
          ))}
        </dl>
        {upcoming.map((version) => (
          <p key={version.id} className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900">
            <Badge tone="warning">{t("notStarted")}</Badge>
            {t.rich("current.upcoming", { version: version.version, date: () => <BusinessDateText value={version.effectiveFrom} /> })}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

/** Every version, newest first: when it starts, why, and what it changed from the version before it. */
function History({ view, showMoney }: { view: WorkRulesView; showMoney: boolean }) {
  const t = useTranslations("workRules");
  const ordered = [...view.versions].sort((a, b) => a.version - b.version);
  const inForce = versionOn(view.versions, view.today);
  const keys = visibleRuleKeys(showMoney);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("history.title")}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("history.caption")}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("history.columns.version")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("history.columns.effectiveFrom")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("history.columns.reason")}
              </th>
              <th scope="col" className="px-2 py-2 text-start font-medium">
                {t("history.columns.changes")}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...ordered].reverse().map((version) => {
              const previous = ordered[ordered.indexOf(version) - 1];
              const changed = previous ? keys.filter((key) => previous.rules[key] !== version.rules[key]) : [];
              const first = version.effectiveFrom === WORK_RULES_FIRST_EFFECTIVE_DATE;
              return (
                <tr key={version.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-2 py-2">
                    <span className="font-medium text-slate-900">{version.version > 0 ? t("history.versionNumber", { version: version.version }) : t("history.original")}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {version.effectiveFrom > view.today ? <Badge tone="warning">{t("notStarted")}</Badge> : null}
                      {inForce?.id === version.id ? <Badge tone="success">{t("history.inForce")}</Badge> : null}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {first ? t("history.fromStart") : <BusinessDateText value={version.effectiveFrom} />}
                    {!first ? (
                      <p className="text-xs text-slate-500">{t.rich("history.addedAt", { time: () => <DateTimeText value={version.createdAt} /> })}</p>
                    ) : null}
                  </td>
                  <td className="px-2 py-2 text-slate-700">
                    <bdi>{version.reason ?? (first ? t("history.originalReason") : t("history.noReason"))}</bdi>
                  </td>
                  <td className="px-2 py-2">
                    {!previous ? (
                      <span className="text-slate-500">{t("history.originalValues")}</span>
                    ) : changed.length === 0 ? (
                      <span className="text-slate-500">{t("history.noVisibleChange")}</span>
                    ) : (
                      <ul className="space-y-1">
                        {changed.map((key) => (
                          <li key={key}>
                            {t.rich("history.change", {
                              rule: t(`rules.${key}.label`),
                              from: () => <WorkRuleValue ruleKey={key} rules={previous.rules} showMoney={showMoney} />,
                              to: () => <WorkRuleValue ruleKey={key} rules={version.rules} showMoney={showMoney} />,
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/** A typed value as the rule's integer (minutes, infractions, or agorot from a shekel amount); null when it is not one. */
function parseRuleValue(key: WorkRuleKey, text: string): number | null {
  const value = toWesternDigits(text.trim()).replace(/٫/g, ".");
  if (WORK_RULE_UNITS[key] === "money") {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  }
  return /^\d+$/.test(value) ? Number(value) : null;
}

/** The text an input starts with: the rule's value (a shekel amount for the money rule). */
function ruleInputText(key: WorkRuleKey, value: number | undefined): string {
  if (value === undefined) return "";
  return WORK_RULE_UNITS[key] === "money" ? (value / 100).toFixed(2) : String(value);
}

/**
 * «تغيير القواعد»: the rules to change (each starts from the value in force
 * on the chosen date, within the API's limits), the date the new version
 * starts (after today) and the reason. While a date is chosen it shows which
 * payroll months the change reaches. The past is never rewritten.
 */
function ChangeRulesForm({ view, showMoney, onCancel, onSaved }: { view: WorkRulesView; showMoney: boolean; onCancel: () => void; onSaved: (message: string) => void }) {
  const tForm = useTranslations("workRules.form");
  const tRules = useTranslations("workRules");
  const format = useFormat();
  const duration = useDurationText();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const tomorrow = addDays(view.today, 1);
  const [effectiveFrom, setEffectiveFrom] = useState(tomorrow);
  const [chosen, setChosen] = useState<WorkRuleKey[]>([]);
  const [texts, setTexts] = useState<Partial<Record<WorkRuleKey, string>>>({});
  const [reason, setReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const keys = visibleRuleKeys(showMoney);

  const dateValid = BUSINESS_DATE_PATTERN.test(effectiveFrom) && effectiveFrom > view.today;
  // The values the new version starts from: those in force on its date (the rules not changed keep them).
  const base: Partial<WorkRules> = (dateValid ? versionOn(view.versions, effectiveFrom)?.rules : undefined) ?? view.current;
  const limitOf = (key: WorkRuleKey) => view.limits[key] ?? WORK_RULE_LIMITS[key];

  const problems: Partial<Record<WorkRuleKey | "date" | "rules" | "reason", string>> = {};
  const changes: Partial<WorkRules> = {};
  for (const key of chosen) {
    const value = parseRuleValue(key, texts[key] ?? "");
    const { min, max } = limitOf(key);
    if (value === null || value < min || value > max) {
      problems[key] =
        WORK_RULE_UNITS[key] === "money" ? tForm("moneyRangeError", { min: format.money(min), max: format.money(max) }) : tForm("rangeError", { min, max });
    } else if (value !== base[key]) {
      changes[key] = value;
    }
  }
  const merged = { ...base, ...changes };
  if (
    !problems.overtimeThresholdMinutes &&
    !problems.standardDayMinutes &&
    merged.overtimeThresholdMinutes !== undefined &&
    merged.standardDayMinutes !== undefined &&
    merged.overtimeThresholdMinutes < merged.standardDayMinutes
  ) {
    problems[chosen.includes("overtimeThresholdMinutes") ? "overtimeThresholdMinutes" : "standardDayMinutes"] = tForm("thresholdBelowStandardDay", {
      standard: duration(merged.standardDayMinutes),
    });
  }
  if (!dateValid) problems.date = tForm("dateError", { date: format.businessDate(tomorrow) });
  if (Object.keys(changes).length === 0 && !keys.some((key) => problems[key])) problems.rules = tForm("nothingChanged");
  if (reason.trim() === "") problems.reason = tForm("reasonRequired");
  else if (reason.trim().length > REASON_MAX) problems.reason = tForm("reasonTooLong", { max: REASON_MAX });

  const impactQuery = useQuery({
    queryKey: orgKeys.workRulesImpact(effectiveFrom),
    queryFn: () => client.getWorkRulesImpact(effectiveFrom),
    enabled: dateValid,
  });

  const save = useMutation({
    mutationFn: (input: CreateWorkRuleVersionInput) => client.createWorkRuleVersion(input),
    onSuccess: (updated) => {
      // The API answers with the whole view (the new version in the history).
      queryClient.setQueryData(orgKeys.workRules, updated);
      onSaved(tForm("saved", { date: format.businessDate(effectiveFrom) }));
    },
  });

  const visible = showErrors ? problems : {};
  const errorId = (field: string) => `${id}-${field}-error`;

  const toggle = (key: WorkRuleKey, checked: boolean) => {
    save.reset();
    setChosen(checked ? keys.filter((candidate) => candidate === key || chosen.includes(candidate)) : chosen.filter((candidate) => candidate !== key));
    if (checked && texts[key] === undefined) setTexts({ ...texts, [key]: ruleInputText(key, base[key]) });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (Object.keys(problems).length > 0) return;
    save.mutate({ effectiveFrom, reason: reason.trim(), ...changes });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tForm("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={submit} className="space-y-5 text-sm">
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">{tForm("pastNeverChanges")}</p>

          <div>
            <Label htmlFor={`${id}-date`}>{tForm("effectiveFrom")}</Label>
            <Input
              id={`${id}-date`}
              type="date"
              dir="ltr"
              className="w-48"
              min={tomorrow}
              value={effectiveFrom}
              onChange={(event) => {
                save.reset();
                setEffectiveFrom(event.target.value);
              }}
              aria-invalid={Boolean(visible.date) || undefined}
              aria-describedby={`${id}-date-hint${visible.date ? ` ${errorId("date")}` : ""}`}
            />
            <p id={`${id}-date-hint`} className="mt-1 text-xs text-slate-500">
              {dateValid ? tForm.rich("effectiveFromHint", { date: () => <BusinessDateText value={effectiveFrom} /> }) : tForm("effectiveFromRule")}
            </p>
            {visible.date ? (
              <p id={errorId("date")} role="alert" className="mt-1 text-xs text-red-600">
                {visible.date}
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-3">
            <legend className="mb-1 font-medium text-slate-700">{tForm("rulesLegend")}</legend>
            {keys.map((key) => {
              const checked = chosen.includes(key);
              const { min, max } = limitOf(key);
              const unit = WORK_RULE_UNITS[key];
              const parsed = parseRuleValue(key, texts[key] ?? "");
              return (
                <div key={key} className="rounded-md border border-slate-200 p-3">
                  <label className="flex items-center gap-2 font-medium text-slate-800">
                    <input type="checkbox" checked={checked} onChange={(event) => toggle(key, event.target.checked)} />
                    {tRules(`rules.${key}.label`)}
                  </label>
                  <p className="ms-6 text-xs text-slate-500">
                    {tForm.rich("currentValue", { value: () => <WorkRuleValue ruleKey={key} rules={base} showMoney={showMoney} /> })}
                  </p>
                  {checked ? (
                    <div className="ms-6 mt-2">
                      <Label htmlFor={`${id}-${key}`}>{tForm(`newValue.${unit}`)}</Label>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          id={`${id}-${key}`}
                          type="text"
                          inputMode={unit === "money" ? "decimal" : "numeric"}
                          dir="ltr"
                          className="w-32"
                          value={texts[key] ?? ""}
                          onChange={(event) => {
                            save.reset();
                            setTexts({ ...texts, [key]: event.target.value });
                          }}
                          aria-invalid={Boolean(visible[key]) || undefined}
                          aria-describedby={`${id}-${key}-hint${visible[key] ? ` ${errorId(key)}` : ""}`}
                        />
                        {unit === "minutes" && parsed !== null ? <span className="text-slate-600">{tForm("equals", { duration: duration(parsed) })}</span> : null}
                      </div>
                      <p id={`${id}-${key}-hint`} className="mt-1 text-xs text-slate-500">
                        {unit === "money" ? tForm("moneyHint", { min: format.money(min), max: format.money(max) }) : tForm("rangeHint", { min, max })}
                      </p>
                      {visible[key] ? (
                        <p id={errorId(key)} role="alert" className="mt-1 text-xs text-red-600">
                          {visible[key]}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {visible.rules ? (
              <p role="alert" className="text-xs text-red-600">
                {visible.rules}
              </p>
            ) : null}
          </fieldset>

          <div>
            <Label htmlFor={`${id}-reason`}>{tForm("reason")}</Label>
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
              aria-describedby={`${id}-reason-hint${visible.reason ? ` ${errorId("reason")}` : ""}`}
              className={TEXTAREA}
            />
            <p id={`${id}-reason-hint`} className="mt-1 text-xs text-slate-500">
              {tForm("reasonHint")}
            </p>
            {visible.reason ? (
              <p id={errorId("reason")} role="alert" className="mt-1 text-xs text-red-600">
                {visible.reason}
              </p>
            ) : null}
          </div>

          {dateValid ? <Impact effectiveFrom={effectiveFrom} query={impactQuery} /> : null}

          {save.isError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage(save.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? tForm("saving") : tForm("save")}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>
              {tForm("cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Which payroll months a change effective on this date reaches (their next calculation uses it) and which stay as they are (finalized). */
function Impact({
  effectiveFrom,
  query,
}: {
  effectiveFrom: string;
  query: { data?: { openMonths: { yearMonth: string; status: string; version: number | null }[]; finalizedMonths: { yearMonth: string; version: number }[] }; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
}) {
  const tImpact = useTranslations("workRules.impact");
  const label = useEnumLabel();
  const id = useId();
  const impact = query.data;
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 rounded-md border border-slate-200 p-3">
      <h3 id={`${id}-title`} className="font-semibold text-slate-900">
        {tImpact.rich("title", { date: () => <BusinessDateText value={effectiveFrom} /> })}
      </h3>
      {query.isPending ? <LoadingState label={tImpact("loading")} /> : null}
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {impact ? (
        <>
          <div>
            <p className="font-medium text-slate-800">{tImpact("openMonths")}</p>
            {impact.openMonths.length === 0 ? (
              <p className="text-slate-500">{tImpact("noOpenMonths")}</p>
            ) : (
              <ul className="list-disc ps-5 text-slate-700">
                {impact.openMonths.map((month) => (
                  <li key={month.yearMonth}>
                    <MonthText yearMonth={month.yearMonth} />
                    {" — "}
                    {month.status === "NOT_CALCULATED" ? tImpact("notCalculated") : label("PayrollPeriodStatus", month.status)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="font-medium text-slate-800">{tImpact("finalizedMonths")}</p>
            {impact.finalizedMonths.length === 0 ? (
              <p className="text-slate-500">{tImpact("noFinalizedMonths")}</p>
            ) : (
              <ul className="list-disc ps-5 text-slate-700">
                {impact.finalizedMonths.map((month) => (
                  <li key={month.yearMonth}>{tImpact.rich("finalizedMonth", { month: () => <MonthText yearMonth={month.yearMonth} />, version: month.version })}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
