"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type { Shift, TemporaryCheckInPoint } from "@fieldmaster/api-client";
import { CheckInMethod } from "@fieldmaster/shared-types";
import { useFormat } from "@/lib/use-format";
import { relationToCircle } from "@/lib/worker-simulator/geo";
import { formatCoordinates } from "@/lib/worker-simulator/bidi";
import type { SimulatedDevice } from "@/lib/worker-simulator/device";
import type { MapCircle } from "@/components/geofence-map-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";

function MapLoading() {
  return <LoadingState />;
}

// Leaflet touches `window` at import time, so the map only loads in the browser (as on the sites page).
const GeofenceMapPicker = dynamic(() => import("@/components/geofence-map-picker").then((m) => m.GeofenceMapPicker), {
  ssr: false,
  loading: MapLoading,
});

const GEOFENCE_COLOR = "#2563eb";
const TEMPORARY_POINT_COLOR = "#16a34a";
const ACCURACY_COLOR = "#64748b";

/** A point a worker can use right now: active, not revoked, not past its expiry. */
export function isPointActive(point: TemporaryCheckInPoint, now: number = Date.now()): boolean {
  return point.status === "ACTIVE" && point.revokedAt === null && new Date(point.expiresAt).getTime() > now;
}

export function SimulatorMap({
  device,
  shift,
  placingPoint,
  onMapClick,
}: {
  device: SimulatedDevice;
  shift: Shift | undefined;
  placingPoint: boolean;
  onMapClick: (latitude: number, longitude: number) => void;
}) {
  const t = useTranslations("workerSimulator");
  const format = useFormat();
  const geofence = shift?.geofence ?? null;
  const points = (shift?.temporaryCheckInPoints ?? []).filter((p) => isPointActive(p));
  const circles: MapCircle[] = [
    ...(geofence
      ? [{ key: `geofence-${geofence.id}`, latitude: geofence.centerLatitude, longitude: geofence.centerLongitude, radiusMeters: geofence.radiusMeters, color: GEOFENCE_COLOR }]
      : []),
    ...points.map((p) => ({ key: `point-${p.id}`, latitude: p.latitude, longitude: p.longitude, radiusMeters: p.radiusMeters, color: TEMPORARY_POINT_COLOR })),
  ];
  const phone = { latitude: device.latitude, longitude: device.longitude };
  const meters = (value: number) => format.number(Math.round(value));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("map.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {placingPoint ? (
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 font-medium text-green-800">
            {t("map.placingPoint")}
          </p>
        ) : null}
        <GeofenceMapPicker
          latitude={device.latitude}
          longitude={device.longitude}
          radiusMeters={Math.max(1, device.accuracyMeters)}
          onChange={onMapClick}
          circles={circles}
          markerCircleColor={ACCURACY_COLOR}
          help={t("map.help")}
          markerLabel={t("map.marker")}
          heightPx={380}
        />
        <p className="text-slate-700">{t("map.location", { coordinates: formatCoordinates(device.latitude, device.longitude) })}</p>
        {!shift ? <p className="text-slate-500">{t("map.noShift")}</p> : null}
        {shift?.checkInMethod === CheckInMethod.FLEXI_CHECK ? <p className="text-blue-800">{t("map.flexi")}</p> : null}
        {geofence
          ? (() => {
              const rel = relationToCircle(phone, { latitude: geofence.centerLatitude, longitude: geofence.centerLongitude, radiusMeters: geofence.radiusMeters });
              return (
                <p className={rel.inside ? "font-medium text-green-800" : "font-medium text-red-700"} aria-live="polite">
                  {rel.inside
                    ? t("map.geofenceInside", { meters: meters(rel.toEdge), radius: meters(geofence.radiusMeters) })
                    : t("map.geofenceOutside", { meters: meters(rel.toEdge), distance: meters(rel.toCenter), radius: meters(geofence.radiusMeters) })}
                </p>
              );
            })()
          : null}
        {points.map((point) => {
          const rel = relationToCircle(phone, point);
          return (
            <p key={point.id} className={rel.inside ? "text-green-800" : "text-slate-600"}>
              {rel.inside ? t("map.pointInside", { name: point.name, meters: meters(rel.toEdge) }) : t("map.pointOutside", { name: point.name, meters: meters(rel.toEdge) })}
            </p>
          );
        })}
        {geofence || points.length > 0 ? <p className="text-xs text-slate-500">{t("map.approximate")}</p> : null}
      </CardContent>
    </Card>
  );
}
