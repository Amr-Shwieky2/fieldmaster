import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "use-intl";
import { buildSiteMapHtml, placesMessage, workerMessage, type MapCircle, type MapPlaces, type MapPoint, type MapWorker, type SiteMapMessage } from "../lib/site-map-html";

export interface SiteMapProps {
  /** The geofence circle (or, without one, the site itself with a radius of 0). Null: the shift has no site. */
  geofence: MapCircle | null;
  /** Active temporary check-in points. */
  points: MapPoint[];
  /** The worker's live position, when known. */
  worker: MapWorker | null;
  height?: number;
  testID?: string;
}

/**
 * The page for SiteMap (native WebView) and SiteMap.web (iframe), and the
 * messages that keep it current. The page is built once, from the data the
 * map first had, so its source never changes and it never reloads; every
 * later change (the site, a temporary point, the worker) is sent to the
 * loaded page with `send`, which draws it in place on the same Leaflet map.
 * Null html: the shift has no site (no map).
 */
export function useSiteMapPage(geofence: MapCircle | null, points: MapPoint[], worker: MapWorker | null, send: (message: SiteMapMessage) => void) {
  const t = useTranslations("location");
  const geofenceKey = geofence ? `${geofence.latitude},${geofence.longitude},${geofence.radiusMeters}` : "";
  const pointsKey = JSON.stringify(points.map((p) => [p.latitude, p.longitude, p.radiusMeters, p.name]));
  const places = useMemo<MapPlaces | null>(
    () =>
      geofence
        ? { center: { latitude: geofence.latitude, longitude: geofence.longitude }, geofence: geofence.radiusMeters > 0 ? geofence : null, points }
        : null,
    // The keys stand for the geofence and the points (new objects on every render).
    [geofenceKey, pointsKey],
  );

  const html = useRef<string | null>(null);
  if (html.current === null && places) {
    html.current = buildSiteMapHtml({
      ...places,
      worker,
      labels: { zoomIn: t("mapZoomIn"), zoomOut: t("mapZoomOut"), attribution: t("mapAttribution"), site: t("mapSite"), worker: t("mapWorker") },
    });
  }

  // The latest data, for a page that (re)loads after a change ("map-ready" sends it again).
  const latest = useRef({ places, worker });
  latest.current = { places, worker };
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (places) sendRef.current(placesMessage(places));
  }, [places]);

  useEffect(() => {
    sendRef.current(workerMessage(latest.current.worker));
  }, [worker?.latitude, worker?.longitude, worker?.accuracy]);

  /** The page loaded (or loaded again): bring it up to date. */
  const onReady = () => {
    if (latest.current.places) sendRef.current(placesMessage(latest.current.places));
    sendRef.current(workerMessage(latest.current.worker));
  };

  return { html: html.current, hasSite: places !== null, onReady };
}

/** The Arabic notice shown instead of the map, or null when the map can be shown. */
export function useSiteMapNotice(hasSite: boolean, isOnline: boolean, failed: boolean): string | null {
  const t = useTranslations("location");
  if (!hasSite) return t("mapNoSite");
  if (!isOnline) return t("mapOffline");
  return failed ? t("mapFailed") : null;
}
