"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DateTimeText, MinutesText } from "@/components/formatted";

/**
 * An emergency call-out's four times (spec section 16): the actual start and
 * end clicks, and the compensated window payroll uses (60 minutes before the
 * start, 15 minutes after the end), with both durations.
 */
export function EmergencyTimes({
  callout,
}: {
  callout: {
    actualStartClick: string;
    compensatedStart: string;
    actualEndClick: string | null;
    compensatedEnd: string | null;
    actualWorkedMinutes: number | null;
    compensatedDurationMinutes: number | null;
    retroactiveMinutes: number;
    returnBufferMinutes: number | null;
  };
}) {
  const t = useTranslations("emergencies.times");
  const notEnded = <span className="text-slate-500">{t("notEnded")}</span>;
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <Item label={t("actualStart")}>
        <DateTimeText value={callout.actualStartClick} />
      </Item>
      <Item label={t("compensatedStart", { minutes: callout.retroactiveMinutes })}>
        <DateTimeText value={callout.compensatedStart} />
      </Item>
      <Item label={t("actualEnd")}>{callout.actualEndClick ? <DateTimeText value={callout.actualEndClick} /> : notEnded}</Item>
      <Item label={t("compensatedEnd", { minutes: callout.returnBufferMinutes ?? 15 })}>
        {callout.compensatedEnd ? <DateTimeText value={callout.compensatedEnd} /> : notEnded}
      </Item>
      <Item label={t("actualWorked")}>{callout.actualWorkedMinutes !== null ? <MinutesText minutes={callout.actualWorkedMinutes} /> : notEnded}</Item>
      <Item label={t("totalCompensated")}>
        {callout.compensatedDurationMinutes !== null ? <MinutesText minutes={callout.compensatedDurationMinutes} /> : notEnded}
      </Item>
    </dl>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{children}</dd>
    </div>
  );
}
