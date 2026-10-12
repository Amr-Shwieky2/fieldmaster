"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { MapCircle, MapPoint } from "@/components/geofence-map-picker";
import { LoadingState } from "@/components/ui/states";

function MapLoading() {
  return <LoadingState />;
}

// Leaflet touches `window` at import time, so the map only loads in the browser (as on the sites page).
const GeofenceMapPicker = dynamic(() => import("@/components/geofence-map-picker").then((m) => m.GeofenceMapPicker), {
  ssr: false,
  loading: MapLoading,
});

/** Colors shared by the map and its legend. */
export const EVIDENCE_COLORS = {
  geofence: "#2563eb",
  temporaryPoint: "#16a34a",
  clockIn: "#059669",
  clockOut: "#4f46e5",
  rejected: "#dc2626",
  start: "#ea580c",
  end: "#2563eb",
} as const;

export type EvidenceColor = keyof typeof EVIDENCE_COLORS;

export interface EvidenceArea {
  key: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  color: EvidenceColor;
  /** Legend text (Arabic). */
  label: string;
}

export interface EvidencePoint {
  key: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  color: EvidenceColor;
  /** Tooltip and legend text (Arabic). */
  label: string;
}

/**
 * Read-only map of where things happened (the existing Leaflet component in
 * its evidence mode): areas such as the geofence, and labelled points with
 * their GPS accuracy. Everything on the map is also listed in text below it.
 */
export function EvidenceMap({ areas, points, label, help }: { areas: EvidenceArea[]; points: EvidencePoint[]; label: string; help: string }) {
  const t = useTranslations("evidenceMap");
  const first = points[0] ?? areas[0];
  if (!first) return <p className="text-sm text-slate-500">{t("nothingToShow")}</p>;

  const circles: MapCircle[] = areas.map((area) => ({
    key: area.key,
    latitude: area.latitude,
    longitude: area.longitude,
    radiusMeters: area.radiusMeters,
    color: EVIDENCE_COLORS[area.color],
  }));
  const mapPoints: MapPoint[] = points.map((point) => ({
    key: point.key,
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: point.accuracyMeters,
    color: EVIDENCE_COLORS[point.color],
    label: point.label,
  }));

  return (
    <div className="space-y-3">
      <GeofenceMapPicker
        latitude={first.latitude}
        longitude={first.longitude}
        radiusMeters={1}
        readOnly
        circles={circles}
        points={mapPoints}
        help={help}
        ariaLabel={label}
        heightPx={360}
      />
      <div>
        <p className="text-sm font-medium text-slate-700">{t("legendTitle")}</p>
        <ul className="mt-1 space-y-1 text-sm text-slate-700" aria-label={t("legendTitle")}>
          {[...areas, ...points].map((item) => (
            <li key={item.key} className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: EVIDENCE_COLORS[item.color] }} />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
