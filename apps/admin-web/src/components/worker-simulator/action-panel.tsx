"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { Shift, TimeEntry } from "@fieldmaster/api-client";
import { TaskCategory } from "@fieldmaster/shared-types";
import { useEnumLabel } from "@/i18n/enums";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { isPointActive } from "./simulator-map";
import { REWIND_TARGET_MINUTES, type SimulatorAction, type SummaryForm } from "./types";

export interface PlacingPoint {
  name: string;
  radiusMeters: number;
}

function RewindLabel({ minutes }: { minutes: number }) {
  const t = useTranslations("workerSimulator");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return <bdi>{rest === 0 ? t("actions.rewindHours", { hours }) : t("actions.rewindHoursMinutes", { hours, minutes: rest })}</bdi>;
}

export function ActionPanel({
  hasSession,
  online,
  activeEntry,
  shift,
  checkInPointId,
  onCheckInPointChange,
  isTemporarySupervisor,
  placingPoint,
  onPlacingPointChange,
  summary,
  onSummaryChange,
  busy,
  onClockIn,
  onClockOut,
  onRewind,
  onEmergencyStart,
  onEmergencyEnd,
}: {
  hasSession: boolean;
  online: boolean;
  activeEntry: TimeEntry | null | undefined;
  shift: Shift | undefined;
  checkInPointId: string | null;
  onCheckInPointChange: (id: string | null) => void;
  isTemporarySupervisor: boolean;
  placingPoint: PlacingPoint | null;
  onPlacingPointChange: (value: PlacingPoint | null) => void;
  summary: SummaryForm;
  onSummaryChange: (patch: Partial<SummaryForm>) => void;
  busy: SimulatorAction | null;
  onClockIn: () => void;
  onClockOut: () => void;
  onRewind: (targetMinutes: number) => void;
  onEmergencyStart: () => void;
  onEmergencyEnd: () => void;
}) {
  const t = useTranslations("workerSimulator");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const ids = { point: useId(), text: useId(), category: useId(), materials: useId(), problems: useId(), followUp: useId(), pointName: useId(), pointRadius: useId() };
  const working = busy !== null;
  const activePoints = (shift?.temporaryCheckInPoints ?? []).filter((p) => isPointActive(p));
  const elapsedMinutes = activeEntry?.clockInAt ? (Date.now() - Date.parse(activeEntry.clockInAt)) / 60_000 : null;
  const canRewind = Boolean(activeEntry && !activeEntry.isEmergency && elapsedMinutes !== null);

  if (!hasSession) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("actions.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">{t("actions.needsSession")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("actions.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {!shift ? <p className="text-amber-800">{t("actions.needsShift")}</p> : null}
        {!online ? <p className="text-amber-800">{t("actions.offlineOnlyClock")}</p> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={ids.point}>{t("actions.checkInPoint")}</Label>
            <Select id={ids.point} value={checkInPointId ?? ""} onChange={(e) => onCheckInPointChange(e.target.value || null)} disabled={!shift}>
              <option value="">{t("actions.checkInPointGeofence")}</option>
              {activePoints.map((p) => (
                <option key={p.id} value={p.id}>
                  {t("actions.checkInPointTemp", { name: p.name })}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onClockIn} disabled={working || !shift}>
            {busy === "clockIn" ? t("actions.working") : tc("clockIn")}
          </Button>
          <Button onClick={onClockOut} disabled={working}>
            {busy === "clockOut" ? t("actions.working") : tc("clockOut")}
          </Button>
        </div>

        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-amber-900">{t("actions.rewindTitle")}</span>
            {REWIND_TARGET_MINUTES.map((target) => {
              const tooShort = elapsedMinutes !== null && Math.round(target - elapsedMinutes) < 1;
              return (
                <Button
                  key={target}
                  size="sm"
                  variant="secondary"
                  onClick={() => onRewind(target)}
                  disabled={working || !canRewind || tooShort}
                  title={tooShort ? t("actions.rewindTooLong") : undefined}
                >
                  <RewindLabel minutes={target} />
                </Button>
              );
            })}
            {busy === "rewind" ? <span className="text-amber-900">{t("actions.rewinding")}</span> : null}
          </div>
          <p className="text-xs text-amber-900">{t("actions.rewindHelp")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="danger" onClick={onEmergencyStart} disabled={working || !online}>
            {busy === "emergencyStart" ? t("actions.working") : t("actions.startEmergency")}
          </Button>
          <Button variant="secondary" onClick={onEmergencyEnd} disabled={working || !online}>
            {busy === "emergencyEnd" ? t("actions.working") : t("actions.endEmergency")}
          </Button>
        </div>

        {isTemporarySupervisor && shift ? (
          <div className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3">
            {placingPoint ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor={ids.pointName}>{t("actions.tempPointName")}</Label>
                  <Input id={ids.pointName} value={placingPoint.name} onChange={(e) => onPlacingPointChange({ ...placingPoint, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor={ids.pointRadius}>{t("actions.tempPointRadius")}</Label>
                  <Input
                    id={ids.pointRadius}
                    dir="ltr"
                    inputMode="numeric"
                    value={placingPoint.radiusMeters}
                    onChange={(e) => onPlacingPointChange({ ...placingPoint, radiusMeters: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                  />
                </div>
                <Button size="sm" variant="secondary" onClick={() => onPlacingPointChange(null)} className="sm:col-span-3 sm:justify-self-start">
                  {t("actions.cancelTempPoint")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => onPlacingPointChange({ name: t("actions.tempPointDefaultName"), radiusMeters: 100 })}
                disabled={working || !online}
              >
                {t("actions.openTempPoint")}
              </Button>
            )}
          </div>
        ) : null}

        <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 font-medium text-slate-800">{t("summary.title")}</legend>
          <div>
            <Label htmlFor={ids.text}>{t("summary.text")}</Label>
            <textarea
              id={ids.text}
              dir="auto"
              rows={3}
              value={summary.text}
              onChange={(e) => onSummaryChange({ text: e.target.value })}
              className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-slate-500">{t("summary.textHelp")}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={ids.category}>{t("summary.category")}</Label>
              <Select id={ids.category} value={summary.category} onChange={(e) => onSummaryChange({ category: e.target.value as TaskCategory })}>
                {Object.values(TaskCategory).map((category) => (
                  <option key={category} value={category}>
                    {enumLabel("TaskCategory", category)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={ids.materials}>{t("summary.materials")}</Label>
              <Input id={ids.materials} dir="auto" value={summary.materials} onChange={(e) => onSummaryChange({ materials: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={ids.problems}>{t("summary.problems")}</Label>
              <Input id={ids.problems} dir="auto" value={summary.problems} onChange={(e) => onSummaryChange({ problems: e.target.value })} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input id={ids.followUp} type="checkbox" className="h-4 w-4" checked={summary.followUp} onChange={(e) => onSummaryChange({ followUp: e.target.checked })} />
              <Label htmlFor={ids.followUp} className="mb-0">
                {t("summary.followUp")}
              </Label>
            </div>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
