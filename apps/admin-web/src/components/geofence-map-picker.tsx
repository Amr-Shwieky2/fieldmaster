"use client";

import { useEffect, useId, useRef } from "react";
import { AttributionControl, Circle, MapContainer, Marker, TileLayer, ZoomControl, useMapEvents } from "react-leaflet";
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

interface GeofenceMapPickerProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onChange: (lat: number, lng: number) => void;
  /** Id of a visible element naming the map; without it the map gets its own aria-label. */
  labelId?: string;
}

function ClickToMove({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onChange(e.latlng.lat, e.latlng.lng);
    },
  });
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
export function GeofenceMapPicker({ latitude, longitude, radiusMeters, onChange, labelId }: GeofenceMapPickerProps) {
  const t = useTranslations("geofenceMap");
  const format = useFormat();
  const helpId = useId();

  return (
    <div className="space-y-1">
      {/* Leaflet's internal layout is physical (left/right), so the map itself stays LTR. */}
      <div
        dir="ltr"
        role="group"
        aria-label={labelId ? undefined : t("label")}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        className="overflow-hidden rounded-md border border-slate-300"
      >
        <MapContainer
          center={[latitude, longitude]}
          zoom={16}
          zoomControl={false}
          attributionControl={false}
          style={{ height: "280px", width: "100%" }}
        >
          <TileLayer attribution={t.raw("attribution") as string} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ZoomControl position="topright" zoomInTitle={t("zoomIn")} zoomOutTitle={t("zoomOut")} />
          {/* No default prefix: it carries an English tooltip. The Leaflet credit is part of the Arabic attribution. */}
          <AttributionControl position="bottomleft" prefix={false} />
          <Marker
            position={[latitude, longitude]}
            icon={markerIcon}
            draggable
            alt={t("markerAlt")}
            title={t("markerTitle")}
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const pos = marker.getLatLng();
                onChange(pos.lat, pos.lng);
              },
            }}
          />
          <Circle center={[latitude, longitude]} radius={radiusMeters} pathOptions={{ color: "#2563eb", fillOpacity: 0.1 }} />
          <ClickToMove onChange={onChange} />
          <RecenterOnChange latitude={latitude} longitude={longitude} />
        </MapContainer>
      </div>
      <p id={helpId} className="text-xs text-slate-500">
        {t("help", { radius: format.number(radiusMeters) })}
      </p>
    </div>
  );
}
