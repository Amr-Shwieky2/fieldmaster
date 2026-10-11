"use client";

import { useTranslations } from "next-intl";
import type { Shift, TimeEntry, WorkerSimulatorContext } from "@fieldmaster/api-client";
import { toBusinessDay } from "@fieldmaster/i18n";
import { ShiftStatus, ShiftType } from "@fieldmaster/shared-types";
import { useEnumLabel } from "@/i18n/enums";
import { useFormat } from "@/lib/use-format";
import { useShiftTitle } from "@/lib/shift-title";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";

const CLOSED = new Set<string>([ShiftStatus.CLOSED, ShiftStatus.CANCELLED]);

/** Shifts the worker could clock in to: assigned, not closed or cancelled, not an emergency placeholder. */
export function splitOpenShifts(shifts: Shift[], now: Date = new Date()) {
  const today = toBusinessDay(now) ?? "";
  const open = shifts.filter((s) => !CLOSED.has(s.status) && s.shiftType !== ShiftType.EMERGENCY_CALLOUT);
  const byStart = (a: Shift, b: Shift) => a.scheduledStart.localeCompare(b.scheduledStart);
  return {
    current: open.filter((s) => s.businessDate >= today).sort(byStart),
    earlier: open.filter((s) => s.businessDate < today).sort(byStart),
  };
}

function ShiftRow({ shift, selected, onSelect }: { shift: Shift; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("workerSimulator");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const shiftTitle = useShiftTitle();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-slate-900">
          <bdi>{shiftTitle(shift)}</bdi>
        </p>
        <p className="text-slate-600">
          {t("status.shiftTime", { date: format.businessDate(shift.businessDate), start: format.time(shift.scheduledStart), end: format.time(shift.scheduledEnd) })}
        </p>
        <div className="flex flex-wrap gap-2">
          {shift.site?.name ? (
            <span className="text-slate-500">
              <bdi>{shift.site.name}</bdi>
            </span>
          ) : null}
          <Badge tone="info">{enumLabel("CheckInMethod", shift.checkInMethod)}</Badge>
          <Badge tone={statusTone(shift.status)}>{enumLabel("ShiftStatus", shift.status)}</Badge>
        </div>
      </div>
      <Button size="sm" variant={selected ? "primary" : "secondary"} onClick={onSelect} aria-pressed={selected}>
        {selected ? t("status.selected") : t("status.select")}
      </Button>
    </li>
  );
}

export function WorkerStatus({
  loading,
  workerProfileId,
  activeEntry,
  shifts,
  context,
  selectedShiftId,
  onSelectShift,
}: {
  loading: boolean;
  workerProfileId: string | null;
  activeEntry: TimeEntry | null | undefined;
  shifts: Shift[];
  context: WorkerSimulatorContext | undefined;
  selectedShiftId: string | null;
  onSelectShift: (id: string) => void;
}) {
  const t = useTranslations("workerSimulator");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const { current, earlier } = splitOpenShifts(shifts);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("status.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {loading ? <LoadingState label={t("status.loading")} /> : null}
        {!workerProfileId ? <p className="text-amber-800">{t("status.notTimeTrackable")}</p> : null}

        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {activeEntry ? (
            <Badge tone="success">
              {activeEntry.isEmergency
                ? t("status.emergencyActive", { time: format.time(activeEntry.clockInAt) })
                : t("status.clockedIn", { time: format.time(activeEntry.clockInAt) })}
            </Badge>
          ) : (
            <Badge>{t("status.notClockedIn")}</Badge>
          )}
          {activeEntry?.devRewoundAt ? <Badge tone="warning">{t("status.devRewound")}</Badge> : null}
        </div>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">{t("status.shiftsTitle")}</h3>
          {current.length === 0 ? (
            <p className="text-slate-500">{t("status.noShifts")}</p>
          ) : (
            <ul className="space-y-2">
              {current.map((shift) => (
                <ShiftRow key={shift.id} shift={shift} selected={shift.id === selectedShiftId} onSelect={() => onSelectShift(shift.id)} />
              ))}
            </ul>
          )}
          {earlier.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-slate-600">{t("status.earlierShifts", { count: earlier.length })}</summary>
              <ul className="mt-2 space-y-2">
                {earlier.map((shift) => (
                  <ShiftRow key={shift.id} shift={shift} selected={shift.id === selectedShiftId} onSelect={() => onSelectShift(shift.id)} />
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">{t("status.turanTitle")}</h3>
          {context && context.turanAssignments.length > 0 ? (
            <ul className="space-y-1">
              {context.turanAssignments.map((turan) => (
                <li key={turan.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {t("status.turanItem", {
                      type: enumLabel("TuranType", turan.turanType),
                      status: enumLabel("TuranStatus", turan.status),
                      start: format.dateTime(turan.startAt),
                      end: format.dateTime(turan.endAt),
                    })}
                  </span>
                  {turan.role === "BACKUP" ? <Badge>{t("status.turanBackup")}</Badge> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">{t("status.noTuran")}</p>
          )}
          {context ? (
            <Badge tone={context.emergencyEligibleTuranAssignmentId ? "success" : "neutral"}>
              {context.emergencyEligibleTuranAssignmentId ? t("status.emergencyEligible") : t("status.emergencyNotEligible")}
            </Badge>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-slate-800">{t("status.tempSupervisorTitle")}</h3>
          {context && context.temporarySupervisorAssignments.length > 0 ? (
            <ul className="space-y-1">
              {context.temporarySupervisorAssignments.map((a) => (
                <li key={a.id}>{t("status.tempSupervisorActive", { shift: a.shiftTitle, time: format.dateTime(a.expiresAt) })}</li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">{t("status.tempSupervisorNone")}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
