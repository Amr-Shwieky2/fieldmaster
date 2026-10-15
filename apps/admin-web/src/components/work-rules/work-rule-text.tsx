"use client";

import { useTranslations } from "next-intl";
import { FINANCIAL_WORK_RULE_KEYS, WORK_RULE_KEYS, type WorkRuleKey, type WorkRules } from "@fieldmaster/shared-types";
import { Money } from "@/components/formatted";

/** How a rule's value is read and typed: a duration in minutes, a number of infractions, or an amount of money (agorot). */
export type WorkRuleUnit = "minutes" | "count" | "money";

export const WORK_RULE_UNITS: Readonly<Record<WorkRuleKey, WorkRuleUnit>> = {
  standardDayMinutes: "minutes",
  overtimeThresholdMinutes: "minutes",
  freeForgottenStampsPerMonth: "count",
  forgottenStampPenaltyAgorot: "money",
  emergencyMinutesBefore: "minutes",
  emergencyMinutesAfter: "minutes",
  clockInEarlyWindowMinutes: "minutes",
};

/** The rules a viewer is shown, in the catalog order: the money rule only for one who may see money. */
export function visibleRuleKeys(showMoney: boolean): WorkRuleKey[] {
  return WORK_RULE_KEYS.filter((key) => showMoney || !FINANCIAL_WORK_RULE_KEYS.includes(key));
}

/** "9 ساعات", "8 ساعات و30 دقيقة", "15 دقيقة" (Western digits, Arabic plurals). */
export function useDurationText(): (minutes: number) => string {
  const tUnits = useTranslations("units");
  const t = useTranslations("workRules");
  return (minutes) => {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours > 0 && rest === 0) return tUnits("hoursLong", { count: hours });
    if (hours > 0) return t("duration", { hours: tUnits("hoursLong", { count: hours }), minutes: tUnits("minutesLong", { count: rest }) });
    return tUnits("minutesLong", { count: minutes });
  };
}

/**
 * A rule's value in plain Arabic. The money rule is rendered only when
 * `showMoney` (and the value is there: the API leaves it out for anyone
 * else); otherwise nothing at all.
 */
export function WorkRuleValue({ ruleKey, rules, showMoney }: { ruleKey: WorkRuleKey; rules: Partial<WorkRules>; showMoney: boolean }) {
  const t = useTranslations("workRules");
  const duration = useDurationText();
  const value = rules[ruleKey];
  if (value === undefined) return null;
  switch (WORK_RULE_UNITS[ruleKey]) {
    case "money":
      return showMoney ? <Money agorot={value} /> : null;
    case "count":
      return <bdi>{t("infractions", { count: value })}</bdi>;
    case "minutes":
      return <bdi>{duration(value)}</bdi>;
  }
}
