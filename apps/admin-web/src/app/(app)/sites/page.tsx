"use client";

import { useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { LtrText, Money } from "@/components/formatted";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

function MapLoading() {
  const tMap = useTranslations("geofenceMap");
  return (
    <div role="status" className="flex h-[280px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-sm text-slate-500">
      {tMap("loading")}
    </div>
  );
}

// Leaflet touches `window` at import time, so it can only load client-side.
const GeofenceMapPicker = dynamic(() => import("@/components/geofence-map-picker").then((m) => m.GeofenceMapPicker), {
  ssr: false,
  loading: () => <MapLoading />,
});

const COORDINATE_FORMAT: Intl.NumberFormatOptions = { minimumFractionDigits: 4, maximumFractionDigits: 4, useGrouping: false };

/** Translated mutation outcome: the error (role="alert") or a success message. */
function MutationFeedback({ error, success }: { error: unknown; success: string | null }) {
  const errorMessage = useErrorMessage();
  return (
    <div aria-live="polite">
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage(error)}
        </p>
      ) : null}
      {!error && success ? <p className="text-sm text-emerald-700">{success}</p> : null}
    </div>
  );
}

export default function SitesPage() {
  const { client, session } = useAuth();
  const t = useTranslations("sites");
  const format = useFormat();
  const queryClient = useQueryClient();
  const isOwner = session?.role === "OWNER";

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => client.listProjects() });
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: () => client.listSites() });

  // Project form
  const [projectName, setProjectName] = useState("");
  const [projectClient, setProjectClient] = useState("");
  const [projectCode, setProjectCode] = useState("");

  const createProject = useMutation({
    mutationFn: () => client.createProject({ name: projectName, client: projectClient || undefined, projectCode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjectName("");
      setProjectClient("");
      setProjectCode("");
    },
  });

  // Site form
  const [siteProjectId, setSiteProjectId] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteLat, setSiteLat] = useState("32.0853");
  const [siteLng, setSiteLng] = useState("34.7818");
  const [siteRadius, setSiteRadius] = useState("100");

  const createSite = useMutation({
    mutationFn: async () => {
      const site = await client.createSite({
        projectId: siteProjectId,
        name: siteName,
        latitude: Number(siteLat),
        longitude: Number(siteLng),
        defaultGeofenceRadiusMeters: Number(siteRadius),
      });
      const created = site as { id: string };
      await client.createGeofence({
        siteId: created.id,
        centerLatitude: Number(siteLat),
        centerLongitude: Number(siteLng),
        radiusMeters: Number(siteRadius),
      });
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setSiteName("");
    },
  });

  const canCreateProject = !createProject.isPending && !!projectName && !!projectCode;
  const canCreateSite = !createSite.isPending && !!siteProjectId && !!siteName;

  function submitProject(event: FormEvent) {
    event.preventDefault();
    if (canCreateProject) createProject.mutate();
  }

  function submitSite(event: FormEvent) {
    event.preventDefault();
    if (canCreateSite) createSite.mutate();
  }

  const projects = projectsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("projects.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {projectsQuery.isLoading && <LoadingState />}
            {projectsQuery.isError && <ErrorState error={projectsQuery.error} onRetry={() => void projectsQuery.refetch()} />}
            {projectsQuery.data && projectsQuery.data.length === 0 && (
              <EmptyState title={t("projects.empty.title")} description={t("projects.empty.description")} />
            )}
            {projectsQuery.data && projectsQuery.data.length > 0 && (
              <ul aria-label={t("projects.listLabel")} className="space-y-2 text-sm">
                {projectsQuery.data.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        <LtrText>{p.projectCode}</LtrText>
                        {p.client ? <> · {t("projects.client", { client: p.client })}</> : null}
                      </p>
                    </div>
                    {/* Budgets are Owner-only: the API strips them for a Field Manager, and the UI also hides them. */}
                    {isOwner && p.budgetAgorot != null && (
                      <span className="text-xs text-slate-500">{t.rich("projects.budget", { money: () => <Money agorot={p.budgetAgorot} /> })}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <form noValidate onSubmit={submitProject} className="space-y-3 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-medium text-slate-700">{t("projects.form.title")}</h3>
              <div>
                <Label htmlFor="project-name">{t("projects.form.name")}</Label>
                <Input id="project-name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="project-client">{t("projects.form.client")}</Label>
                <Input id="project-client" value={projectClient} onChange={(e) => setProjectClient(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="project-code">{t("projects.form.code")}</Label>
                <Input id="project-code" dir="ltr" className="text-start" value={projectCode} onChange={(e) => setProjectCode(e.target.value)} />
              </div>
              <Button type="submit" size="sm" disabled={!canCreateProject}>
                {createProject.isPending ? t("projects.form.submitting") : t("projects.form.submit")}
              </Button>
              <MutationFeedback error={createProject.error} success={createProject.isSuccess ? t("projects.messages.created") : null} />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sites.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sitesQuery.isLoading && <LoadingState />}
            {sitesQuery.isError && <ErrorState error={sitesQuery.error} onRetry={() => void sitesQuery.refetch()} />}
            {sitesQuery.data && sitesQuery.data.length === 0 && (
              <EmptyState title={t("sites.empty.title")} description={t("sites.empty.description")} />
            )}
            {sitesQuery.data && sitesQuery.data.length > 0 && (
              <ul aria-label={t("sites.listLabel")} className="space-y-2 text-sm">
                {sitesQuery.data.map((s) => (
                  <li key={s.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <p className="font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      <LtrText>
                        {format.number(s.latitude, COORDINATE_FORMAT)}, {format.number(s.longitude, COORDINATE_FORMAT)}
                      </LtrText>{" "}
                      · {t("sites.radius", { radius: format.number(s.defaultGeofenceRadiusMeters) })}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <form noValidate onSubmit={submitSite} className="space-y-3 border-t border-slate-100 pt-4">
              <h3 className="text-sm font-medium text-slate-700">{t("sites.form.title")}</h3>
              <div>
                <Label htmlFor="site-project">{t("sites.form.project")}</Label>
                <Select id="site-project" value={siteProjectId} onChange={(e) => setSiteProjectId(e.target.value)}>
                  <option value="">{t("sites.form.projectPlaceholder")}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {projectsQuery.isSuccess && projects.length === 0 && <p className="mt-1 text-xs text-slate-500">{t("sites.form.noProjects")}</p>}
              </div>
              <div>
                <Label htmlFor="site-name">{t("sites.form.name")}</Label>
                <Input id="site-name" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
              </div>

              <div>
                <p id="site-map-label" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("sites.form.mapLabel")}
                </p>
                <GeofenceMapPicker
                  labelId="site-map-label"
                  latitude={Number(siteLat) || 32.0853}
                  longitude={Number(siteLng) || 34.7818}
                  radiusMeters={Number(siteRadius) || 100}
                  onChange={(lat, lng) => {
                    setSiteLat(lat.toFixed(6));
                    setSiteLng(lng.toFixed(6));
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lat">{t("sites.form.latitude")}</Label>
                  <Input id="lat" type="number" step="0.0001" dir="ltr" className="text-start" value={siteLat} onChange={(e) => setSiteLat(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="lng">{t("sites.form.longitude")}</Label>
                  <Input id="lng" type="number" step="0.0001" dir="ltr" className="text-start" value={siteLng} onChange={(e) => setSiteLng(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="radius">{t("sites.form.radius")}</Label>
                  <Input id="radius" type="number" dir="ltr" className="text-start" value={siteRadius} onChange={(e) => setSiteRadius(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-slate-500">{t("sites.form.coordinatesHint")}</p>
              <Button type="submit" size="sm" disabled={!canCreateSite}>
                {createSite.isPending ? t("sites.form.submitting") : t("sites.form.submit")}
              </Button>
              <MutationFeedback error={createSite.error} success={createSite.isSuccess ? t("sites.messages.created") : null} />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
