"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/use-format";
import { deviceTimestamp, type SimulatedDevice } from "@/lib/worker-simulator/device";
import { timeWithSeconds } from "@/lib/worker-simulator/bidi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

/**
 * A number field that keeps what is being typed ("-", "-3") and reports only
 * complete numbers, so a negative clock offset can be entered. It follows the
 * value when it changes from outside (a scenario's "prepare").
 */
function NumberField({ id, value, min, onValue }: { id: string; value: number; min?: number; onValue: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() !== "" ? current : String(value)));
  }, [value]);
  return (
    <Input
      id={id}
      dir="ltr"
      inputMode="numeric"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(parsed)) onValue(min === undefined ? parsed : Math.max(min, parsed));
      }}
    />
  );
}

export function DeviceControls({ device, onChange }: { device: SimulatedDevice; onChange: (patch: Partial<SimulatedDevice>) => void }) {
  const t = useTranslations("workerSimulator");
  const format = useFormat();
  const accuracyId = useId();
  const offsetId = useId();
  const mockId = useId();
  const connectionName = useId();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("device.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div>
          <Label htmlFor={accuracyId}>{t("device.accuracy")}</Label>
          <NumberField id={accuracyId} value={device.accuracyMeters} min={0} onValue={(accuracyMeters) => onChange({ accuracyMeters })} />
        </div>
        <div>
          <Label htmlFor={offsetId}>{t("device.clockOffset")}</Label>
          <NumberField id={offsetId} value={device.clockOffsetSeconds} onValue={(clockOffsetSeconds) => onChange({ clockOffsetSeconds })} />
          <p className="mt-1 text-xs text-slate-500">{t("device.clockPreview", { time: timeWithSeconds(format.time, deviceTimestamp(device)) })}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id={mockId}
            type="checkbox"
            className="h-4 w-4"
            checked={device.mockLocationSuspected}
            onChange={(e) => onChange({ mockLocationSuspected: e.target.checked })}
          />
          <Label htmlFor={mockId} className="mb-0">
            {t("device.mockLocation")}
          </Label>
        </div>
        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium text-slate-700">{t("device.connection")}</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" name={connectionName} checked={device.online} onChange={() => onChange({ online: true })} />
              {t("device.online")}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name={connectionName} checked={!device.online} onChange={() => onChange({ online: false })} />
              {t("device.offline")}
            </label>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
