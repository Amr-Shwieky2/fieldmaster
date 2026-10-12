"use client";

import { useEffect, useId, useRef } from "react";
import { AttributionControl, Circle, CircleMarker, MapContainer, Marker, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { useTranslations } from "next-intl";
import "leaflet/dist/leaflet.css";
import { useFormat } from "@/lib/use-format";

// Default Leaflet marker icons reference image URLs that bundlers don't
// resolve correctly out of the box; point them at the CDN-hosted assets
// instead (no API key needed -- OpenStreetMap tiles are free/open, unlike
// Google Maps, which the spec names but which would require a billing
// account this environment doesn't have -- see technical-decisions.md).
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

/** A fixed (not editable) circle drawn under the marker, e.g. a geofence or a temporary check-in point. */
export interface MapCircle {
  key: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  color: string;
}

/**
 * A labelled location drawn as a dot (e.g. a clock-in, or a refused attempt),
 * with its GPS accuracy as a dashed circle around it.
 */
export interface MapPoint {
  key: string;
  latitude: number;
  longitude: number;
  color: string;
  /** Shown when the dot is hovered or focused (Arabic text). */
  label: string;
  accuracyMeters?: number | null;
}

const GEOFENCE_BLUE = "#2563eb";

interface GeofenceMapPickerProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Required unless `readOnly`. */
  onChange?: (lat: number, lng: number) => void;
  /**
   * Evidence view (the attendance and emergency pages): no draggable marker,
   * clicks do nothing, and the map fits all `circles` and `points`.
   * `latitude`/`longitude` are only the initial center.
   */
  readOnly?: boolean;
  /** Labelled dots with optional accuracy circles. */
  points?: MapPoint[];
  /** Id of a visible element naming the map; without it the map gets its own aria-label. */
  labelId?: string;
  /** The map's own aria-label when there is no `labelId` (default: the geofence map's name). */
  ariaLabel?: string;
  /** Extra fixed circles (the worker simulator draws the shift's geofence and temporary points this way). */
  circles?: MapCircle[];
  /** Colour of the circle around the marker (default: the geofence blue). */
  markerCircleColor?: string;
  /** Replaces the default help text and marker label (both say the marker is the geofence center). */
  help?: string;
  markerLabel?: string;
  heightPx?: number;
}

function ClickToMove({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Fits the view to every circle and point once they are known. */
function FitToContent({ circles, points }: { circles: MapCircle[]; points: MapPoint[] }) {
  const map = useMap();
  const signature = JSON.stringify([
    circles.map((c) => [c.latitude, c.longitude, c.radiusMeters]),
    points.map((p) => [p.latitude, p.longitude, p.accuracyMeters ?? 0]),
  ]);
  useEffect(() => {
    const bounds = L.latLngBounds([]);
    for (const circle of circles) bounds.extend(L.latLng(circle.latitude, circle.longitude).toBounds(circle.radiusMeters * 2));
    for (const point of points) bounds.extend(L.latLng(point.latitude, point.longitude).toBounds(Math.max(20, (point.accuracyMeters ?? 0) * 2)));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });
    // Keyed on the signature: the arrays themselves are new on every render.
  }, [map, signature]);
  return null;
}

function RecenterOnChange({ latitude, longitude }: { latitude: number; longitude: number }) {
  const map = useMapEvents({});
  const lastRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    // Only recenter when the position jumped externally (e.g. typed
    // coordinates), not on every render triggered by our own map clicks.
    if (!lastRef.current || Math.abs(lastRef.current.lat - latitude) > 1e-6 || Math.abs(lastRef.current.lng - longitude) > 1e-6) {
      map.setView([latitude, longitude], map.getZoom());
    }
    lastRef.current = { lat: latitude, lng: longitude };
  }, [latitude, longitude, map]);
  return null;
}

/**
 * Interactive geofence editor using Leaflet + OpenStreetMap tiles (free,
 * no API key) instead of the spec-named Google Maps JS SDK, which needs a
 * billed Google Cloud project this environment doesn't have credentials
 * for. Click anywhere on the map, or drag the marker, to set the site's
 * center; the shaded circle shows the actual geofence radius workers must
 * be inside to clock in.
 *
 * RTL: Leaflet lays out tiles, panes and control corners with physical
 * left/right CSS, so the map container stays `dir="ltr"`. The controls are
 * placed for the Arabic (RTL) page instead: the zoom control sits on the
 * inline-start corner (top right) and the attribution on the opposite bottom
 * corner (bottom left).
 */
export function GeofenceMapPicker({
  latitude,
  longitude,
  radiusMeters,
  onChange,
  readOnly = false,
  points = [],
  labelId,
  ariaLabel,
  circles = [],
  markerCircleColor = GEOFENCE_BLUE,
  help,
  markerLabel,
  heightPx = 280,
}: GeofenceMapPickerProps) {
  const t = useTranslations("geofenceMap");
  const format = useFormat();
  const helpId = useId();

  return (
    <div className="space-y-1">
      {/* Leaflet's internal layout is physical (left/right), so the map itself stays LTR. */}
      <div
        dir="ltr"
        role="group"
        aria-label={labelId ? undefined : (ariaLabel ?? t("label"))}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        className="overflow-hidden rounded-md border border-slate-300"
      >
        <MapContainer
          center={[latitude, longitude]}
          zoom={16}
          zoomControl={false}
          attributionControl={false}
          style={{ height: `${heightPx}px`, width: "100%" }}
        >
          <TileLayer attribution={t.raw("attribution") as string} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ZoomControl position="topright" zoomInTitle={t("zoomIn")} zoomOutTitle={t("zoomOut")} />
          {/* No default prefix: it carries an English tooltip. The Leaflet credit is part of the Arabic attribution. */}
          <AttributionControl position="bottomleft" prefix={false} />
          {readOnly ? null : (
            <Marker
              position={[latitude, longitude]}
              icon={markerIcon}
              draggable
              alt={markerLabel ?? t("markerAlt")}
              title={markerLabel ?? t("markerTitle")}
              eventHandlers={{
                dragend: (e) => {
                  const marker = e.target as L.Marker;
                  const pos = marker.getLatLng();
                  onChange?.(pos.lat, pos.lng);
                },
              }}
            />
          )}
          {circles.map((circle) => (
            <Circle
              key={circle.key}
              center={[circle.latitude, circle.longitude]}
              radius={circle.radiusMeters}
              pathOptions={{ color: circle.color, fillOpacity: 0.1 }}
            />
          ))}
          {points.map((point) =>
            point.accuracyMeters ? (
              <Circle
                key={`${point.key}-accuracy`}
                center={[point.latitude, point.longitude]}
                radius={point.accuracyMeters}
                pathOptions={{ color: point.color, weight: 1, dashArray: "4 4", fillOpacity: 0.05 }}
              />
            ) : null,
          )}
          {points.map((point) => (
            <CircleMarker
              key={point.key}
              center={[point.latitude, point.longitude]}
              radius={7}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: point.color, fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -6]}>
                <span dir="rtl">{point.label}</span>
              </Tooltip>
            </CircleMarker>
          ))}
          {readOnly ? (
            <FitToContent circles={circles} points={points} />
          ) : (
            <>
              <Circle center={[latitude, longitude]} radius={radiusMeters} pathOptions={{ color: markerCircleColor, fillOpacity: 0.1 }} />
              <ClickToMove onChange={(lat, lng) => onChange?.(lat, lng)} />
              <RecenterOnChange latitude={latitude} longitude={longitude} />
            </>
          )}
        </MapContainer>
      </div>
      <p id={helpId} className="text-xs text-slate-500">
        {help ?? t("help", { radius: format.number(radiusMeters) })}
      </p>
    </div>
  );
}
