"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ShiftType, CheckInMethod } from "@fieldmaster/shared-types";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useEnumLabel } from "@/i18n/enums";
import { ArrowStartIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Inline query error under a field, with a retry button. */
function InlineQueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const tc = useTranslations("common");
  const errorMessage = useErrorMessage();
  return (
    <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-red-600">
      <span>{errorMessage(error)}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
        {tc("retry")}
      </Button>
    </div>
  );
}

export default function NewShiftPage() {
  const router = useRouter();
  const { client } = useAuth();
  const t = useTranslations("shifts");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => client.listProjects() });
  const [projectId, setProjectId] = useState("");
  const sitesQuery = useQuery({ queryKey: ["sites", projectId], queryFn: () => client.listSites(projectId), enabled: !!projectId });

  const [title, setTitle] = useState("");
  const [shiftType, setShiftType] = useState<ShiftType>(ShiftType.STANDARD);
  const [siteId, setSiteId] = useState("");
  const [checkInMethod, setCheckInMethod] = useState<CheckInMethod>(CheckInMethod.GEOFENCED);
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60_000);
  const inNineHours = new Date(now.getTime() + 9 * 60 * 60_000);
  const [start, setStart] = useState(toLocalInputValue(inOneHour));
  const [end, setEnd] = useState(toLocalInputValue(inNineHours));

  const selectedSite = sitesQuery.data?.find((s) => s.id === siteId);
  const geofenceId = selectedSite?.geofences?.[0]?.id;

  const createShift = useMutation({
    mutationFn: () =>
      client.createShift({
        title,
        shiftType,
        projectId: projectId || undefined,
        siteId: siteId || undefined,
        geofenceId: checkInMethod === CheckInMethod.GEOFENCED ? geofenceId : undefined,
        checkInMethod,
        scheduledStart: new Date(start).toISOString(),
        scheduledEnd: new Date(end).toISOString(),
      }),
    onSuccess: (shift) => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      router.replace(`/shifts/${(shift as { id: string }).id}`);
    },
  });

  const canSubmit = !createShift.isPending && !!title;
  // Shown as a hint only; the API is what enforces it (VALIDATION_FAILED).
  const endBeforeStart = !!start && !!end && new Date(end).getTime() <= new Date(start).getTime();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) createShift.mutate();
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="space-y-2">
        <Link href="/shifts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <ArrowStartIcon />
          {t("backToList")}
        </Link>
        <PageHeader title={t("form.title")} description={t("form.description")} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("form.cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="title">{t("form.fields.title")}</Label>
              <Input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("form.fields.titlePlaceholder")} />
            </div>

            <div>
              <Label htmlFor="type">{t("form.fields.shiftType")}</Label>
              <Select id="type" value={shiftType} onChange={(e) => setShiftType(e.target.value as ShiftType)}>
                {Object.values(ShiftType)
                  .filter((type) => type !== ShiftType.EMERGENCY_CALLOUT)
                  .map((type) => (
                    <option key={type} value={type}>
                      {enumLabel("ShiftType", type)}
                    </option>
                  ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="project">{t("form.fields.project")}</Label>
              <Select
                id="project"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setSiteId("");
                }}
              >
                <option value="">{t("form.fields.noProject")}</option>
                {(projectsQuery.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {projectsQuery.isError && <InlineQueryError error={projectsQuery.error} onRetry={() => void projectsQuery.refetch()} />}
            </div>

            {projectId && (
              <div>
                <Label htmlFor="site">{t("form.fields.site")}</Label>
                <Select id="site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">{t("form.fields.noSite")}</option>
                  {(sitesQuery.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                {sitesQuery.isLoading && (
                  <p role="status" className="mt-1 text-xs text-slate-500">
                    {t("form.hints.loadingSites")}
                  </p>
                )}
                {sitesQuery.isError && <InlineQueryError error={sitesQuery.error} onRetry={() => void sitesQuery.refetch()} />}
                {sitesQuery.isSuccess && sitesQuery.data.length === 0 && <p className="mt-1 text-xs text-slate-500">{t("form.hints.noSites")}</p>}
              </div>
            )}

            <div>
              <Label htmlFor="checkin">{t("form.fields.checkInMethod")}</Label>
              <Select id="checkin" value={checkInMethod} onChange={(e) => setCheckInMethod(e.target.value as CheckInMethod)}>
                <option value={CheckInMethod.GEOFENCED}>{enumLabel("CheckInMethod", CheckInMethod.GEOFENCED)}</option>
                <option value={CheckInMethod.FLEXI_CHECK}>{enumLabel("CheckInMethod", CheckInMethod.FLEXI_CHECK)}</option>
              </Select>
              {checkInMethod === CheckInMethod.GEOFENCED && siteId && !geofenceId && (
                <p className="mt-1 text-xs text-amber-700">{t("form.hints.noGeofence")}</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="start">{t("form.fields.start")}</Label>
                <Input id="start" type="datetime-local" dir="ltr" className="text-start" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="end">{t("form.fields.end")}</Label>
                <Input
                  id="end"
                  type="datetime-local"
                  dir="ltr"
                  className="text-start"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  aria-describedby={endBeforeStart ? "end-hint" : undefined}
                />
              </div>
            </div>
            <div aria-live="polite">
              {endBeforeStart && (
                <p id="end-hint" className="text-xs text-amber-700">
                  {t("form.hints.endBeforeStart")}
                </p>
              )}
            </div>

            {createShift.error ? (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage(createShift.error)}
              </p>
            ) : null}

            <Button type="submit" disabled={!canSubmit}>
              {createShift.isPending ? t("form.submitting") : t("form.submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
