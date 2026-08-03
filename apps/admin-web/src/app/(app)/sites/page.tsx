"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";

// Leaflet touches `window` at import time, so it can only load client-side.
const GeofenceMapPicker = dynamic(() => import("@/components/geofence-map-picker").then((m) => m.GeofenceMapPicker), {
  ssr: false,
  loading: () => <div className="flex h-[280px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-sm text-slate-400">Loading map…</div>,
});

export default function SitesPage() {
  const { client, session } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = session?.role === "OWNER";

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: () => client.listProjects() });
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: () => client.listSites() });

  const [error, setError] = useState<string | null>(null);

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
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to create project."),
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
    onError: (err) => setError(err instanceof ApiRequestError ? err.body.message : "Failed to create site."),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Sites &amp; Projects</h1>
        <p className="text-sm text-slate-500">Projects, sites, and their geofences.</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {projectsQuery.isLoading && <LoadingState />}
            {projectsQuery.isError && <ErrorState message={(projectsQuery.error as Error).message} />}
            {projectsQuery.data && projectsQuery.data.length === 0 && <EmptyState title="No projects yet" />}
            {projectsQuery.data && projectsQuery.data.length > 0 && (
              <ul className="space-y-2 text-sm">
                {projectsQuery.data.map((p) => (
                  <li key={p.id} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
                    <div>
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.projectCode} {p.client ? `· ${p.client}` : ""}
                      </p>
                    </div>
                    {isOwner && p.budgetAgorot != null && (
                      <span className="text-xs text-slate-500">Budget ₪{(p.budgetAgorot / 100).toLocaleString()}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-700">New project</p>
              <Input placeholder="Name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              <Input placeholder="Client (optional)" value={projectClient} onChange={(e) => setProjectClient(e.target.value)} />
              <Input placeholder="Project code" value={projectCode} onChange={(e) => setProjectCode(e.target.value)} />
              <Button size="sm" onClick={() => createProject.mutate()} disabled={createProject.isPending || !projectName || !projectCode}>
                {createProject.isPending ? "Creating…" : "Create project"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sites</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sitesQuery.isLoading && <LoadingState />}
            {sitesQuery.isError && <ErrorState message={(sitesQuery.error as Error).message} />}
            {sitesQuery.data && sitesQuery.data.length === 0 && <EmptyState title="No sites yet" />}
            {sitesQuery.data && sitesQuery.data.length > 0 && (
              <ul className="space-y-2 text-sm">
                {sitesQuery.data.map((s) => (
                  <li key={s.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <p className="font-medium text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">
                      {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)} · {s.defaultGeofenceRadiusMeters}m radius
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-sm font-medium text-slate-700">New site</p>
              <div>
                <Label htmlFor="site-project">Project</Label>
                <Select id="site-project" value={siteProjectId} onChange={(e) => setSiteProjectId(e.target.value)}>
                  <option value="">Select a project…</option>
                  {(projectsQuery.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Input placeholder="Site name" value={siteName} onChange={(e) => setSiteName(e.target.value)} />

              <div>
                <Label>Geofence center (click the map or drag the pin)</Label>
                <GeofenceMapPicker
                  latitude={Number(siteLat) || 32.0853}
                  longitude={Number(siteLng) || 34.7818}
                  radiusMeters={Number(siteRadius) || 100}
                  onChange={(lat, lng) => {
                    setSiteLat(lat.toFixed(6));
                    setSiteLng(lng.toFixed(6));
                  }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="lat">Latitude</Label>
                  <Input id="lat" type="number" step="0.0001" value={siteLat} onChange={(e) => setSiteLat(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="lng">Longitude</Label>
                  <Input id="lng" type="number" step="0.0001" value={siteLng} onChange={(e) => setSiteLng(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="radius">Radius (m)</Label>
                  <Input id="radius" type="number" value={siteRadius} onChange={(e) => setSiteRadius(e.target.value)} />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => createSite.mutate()}
                disabled={createSite.isPending || !siteProjectId || !siteName}
              >
                {createSite.isPending ? "Creating…" : "Create site + geofence"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
