/**
 * The shift details map: one self-contained HTML page with Leaflet and
 * OpenStreetMap tiles (free, no API key; the admin web uses the same), shown
 * in a WebView on iOS/Android and in an <iframe srcDoc> on the web target.
 *
 * - Leaflet comes from unpkg with Subresource Integrity (the hashes of the
 *   official 1.9.4 files), so a changed file is refused by the browser.
 * - Every value from the API (site and point names, coordinates) enters the
 *   page as JSON data, never as markup: names are set with `textContent`.
 * - Leaflet lays out tiles and controls with physical left/right, so the map
 *   itself stays left-to-right; the zoom control sits on the RTL page's start
 *   corner (top right) and the attribution opposite (bottom left), as in the
 *   admin web.
 * - One page, one Leaflet map per mounted WebView / iframe. The page is built
 *   once with the data of that moment; every later change (the site, a
 *   temporary point opened or closed, the worker's position) arrives as a
 *   message (`fmReceive`, or `postMessage` on the web) and is drawn in place:
 *   the map is never re-created and the page never reloads. Bounds are
 *   computed from the data, never asked from a layer (a layer's bounds need a
 *   map that already has a view and a size), and fitting waits until the frame
 *   has a size. After `pagehide` the map is removed and late messages are
 *   ignored.
 */

export const LEAFLET_VERSION = "1.9.4";
export const LEAFLET_CSS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
export const LEAFLET_JS_URL = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const LEAFLET_CSS_SRI = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_SRI = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Colors of the app theme: the geofence in primary blue, temporary points in warning amber, the worker in green. */
const GEOFENCE_COLOR = "#2563eb";
const POINT_COLOR = "#b45309";
const WORKER_COLOR = "#15803d";

export interface MapCircle {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface MapPoint extends MapCircle {
  name: string;
}

export interface MapWorker {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface MapLabels {
  zoomIn: string;
  zoomOut: string;
  attribution: string;
  site: string;
  worker: string;
}

/** What the map shows of the site: it changes while the screen is open (a temporary point opens or closes). */
export interface MapPlaces {
  /** Where the map opens (the geofence center, or the site). */
  center: { latitude: number; longitude: number };
  /** Null: the site has no radius (it is shown as a dot). */
  geofence: MapCircle | null;
  /** Active temporary check-in points. */
  points: MapPoint[];
}

/** Everything the page starts with. */
export interface SiteMapData extends MapPlaces {
  worker: MapWorker | null;
  labels: MapLabels;
}

/** What the app sends to a loaded page. */
export type SiteMapMessage = { type: "data"; data: MapPlaces } | { type: "worker"; worker: MapWorker | null };

/** JSON that is safe inside a <script> element (no "</script>", no line separators that end a JS string). */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The worker's position as a message for the page. */
export function workerMessage(worker: MapWorker | null): SiteMapMessage {
  return { type: "worker", worker };
}

/** The site and its points as a message for the page. */
export function placesMessage(data: MapPlaces): SiteMapMessage {
  return { type: "data", data };
}

/** The native WebView's way in: a script that hands the message to the page (ignored until the page is ready). */
export function injectedMessage(message: SiteMapMessage): string {
  return `window.fmReceive && window.fmReceive(${scriptJson(message)}); true;`;
}

/**
 * The page's script (plain ES5 for old WebViews). Exported for the tests,
 * which run it against a fake Leaflet.
 */
export const SITE_MAP_PAGE_SCRIPT = `
(function () {
  var map = null;
  var dataLayer = null;
  var workerLayer = null;
  var current = window.__FM_MAP__ || null;
  var worker = current ? current.worker : null;
  var fittedKey = null;
  var needsFit = false;

  function post(type) {
    try {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(type);
      else if (window.parent && window.parent !== window) window.parent.postMessage({ source: "fieldmaster-map", type: type }, "*");
    } catch (error) {}
  }
  function textNode(text) { var span = document.createElement("span"); span.textContent = text; return span; }
  function placesKey(data) { return JSON.stringify([data.center, data.geofence, data.points]); }

  /** The area to show, from the data alone (no layer is asked: its bounds would need a map with a view). */
  function boundsOf(data) {
    var bounds = L.latLng(data.center.latitude, data.center.longitude).toBounds(1);
    if (data.geofence) bounds.extend(L.latLng(data.geofence.latitude, data.geofence.longitude).toBounds(data.geofence.radiusMeters * 2));
    for (var i = 0; i < data.points.length; i++) {
      bounds.extend(L.latLng(data.points[i].latitude, data.points[i].longitude).toBounds(data.points[i].radiusMeters * 2));
    }
    return bounds;
  }

  /** Fits the site and its points, once the frame has a size (otherwise on the next resize). */
  function fit() {
    if (!map || !current) return;
    var size = map.getSize();
    if (!size.x || !size.y) { needsFit = true; return; }
    needsFit = false;
    map.fitBounds(boundsOf(current), { padding: [24, 24], maxZoom: 17 });
  }

  /** Redraws the site and its points in place (same map, same page). */
  function drawPlaces() {
    if (!map || !current) return;
    dataLayer.clearLayers();
    if (current.geofence) {
      L.circle([current.geofence.latitude, current.geofence.longitude], { radius: current.geofence.radiusMeters, color: "${GEOFENCE_COLOR}", weight: 2, fillOpacity: 0.12 })
        .bindTooltip(textNode(current.labels.site)).addTo(dataLayer);
    } else {
      L.circleMarker([current.center.latitude, current.center.longitude], { radius: 8, color: "${GEOFENCE_COLOR}", fillOpacity: 0.9 })
        .bindTooltip(textNode(current.labels.site)).addTo(dataLayer);
    }
    for (var i = 0; i < current.points.length; i++) {
      var point = current.points[i];
      L.circle([point.latitude, point.longitude], { radius: point.radiusMeters, color: "${POINT_COLOR}", weight: 2, dashArray: "6 6", fillOpacity: 0.1 })
        .bindTooltip(textNode(point.name)).addTo(dataLayer);
    }
    // Only a change of place moves the view (not every redraw).
    var key = placesKey(current);
    if (key !== fittedKey) { fittedKey = key; fit(); }
  }

  function drawWorker() {
    if (!map) return;
    workerLayer.clearLayers();
    if (!worker) return;
    var at = [worker.latitude, worker.longitude];
    if (worker.accuracy) L.circle(at, { radius: worker.accuracy, color: "${WORKER_COLOR}", weight: 1, fillOpacity: 0.08 }).addTo(workerLayer);
    L.circleMarker(at, { radius: 7, color: "#ffffff", weight: 2, fillColor: "${WORKER_COLOR}", fillOpacity: 1 })
      .bindTooltip(textNode(current.labels.worker)).addTo(workerLayer);
  }

  /** A message from the app. After teardown (or before the map exists) it is ignored. */
  function receive(message) {
    if (!map || !message) return;
    if (message.type === "data" && message.data) {
      current = { center: message.data.center, geofence: message.data.geofence, points: message.data.points || [], worker: worker, labels: current.labels };
      drawPlaces();
    } else if (message.type === "worker") {
      worker = message.worker || null;
      drawWorker();
    }
  }
  window.fmReceive = receive;

  function onMessage(event) {
    // Only the app: the parent frame on the web, or the native WebView (no source).
    if (event.source && event.source !== window.parent) return;
    var message = event.data;
    if (typeof message === "string") { try { message = JSON.parse(message); } catch (error) { return; } }
    receive(message);
  }

  if (typeof L === "undefined" || !current) { post("map-failed"); return; }

  // One map for the life of this page. A view first, so layers can be added at once.
  map = L.map("map", { zoomControl: false, attributionControl: false });
  map.setView([current.center.latitude, current.center.longitude], 16);
  L.control.zoom({ position: "topright", zoomInTitle: current.labels.zoomIn, zoomOutTitle: current.labels.zoomOut }).addTo(map);
  var attribution = L.control.attribution({ position: "bottomleft", prefix: false });
  attribution.addTo(map);
  attribution.getContainer().textContent = current.labels.attribution;
  L.tileLayer(${JSON.stringify(OSM_TILE_URL)}, { maxZoom: 19 }).addTo(map);
  dataLayer = L.layerGroup().addTo(map);
  workerLayer = L.layerGroup().addTo(map);

  map.on("resize", function () { if (needsFit) fit(); });
  window.addEventListener("resize", function () { if (map) map.invalidateSize(); });
  window.addEventListener("message", onMessage);
  document.addEventListener("message", onMessage);
  window.addEventListener("pagehide", function () {
    if (!map) return;
    map.remove();
    map = null;
  });

  drawPlaces();
  drawWorker();
  // The frame may have had no size yet when the map was created: measure again after layout.
  setTimeout(function () {
    if (!map) return;
    map.invalidateSize();
    if (needsFit) fit();
  }, 0);
  post("map-ready");
})();
`;

/** The whole page, starting with `data`. */
export function buildSiteMapHtml(data: SiteMapData): string {
  return `<!doctype html>
<html lang="ar">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="${LEAFLET_CSS_URL}" integrity="${LEAFLET_CSS_SRI}" crossorigin="">
<style>html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; } body { background: #e2e8f0; } .leaflet-container { font-family: sans-serif; }</style>
</head>
<body>
<div id="map" dir="ltr"></div>
<script>window.__FM_MAP__ = ${scriptJson(data)};</script>
<script src="${LEAFLET_JS_URL}" integrity="${LEAFLET_JS_SRI}" crossorigin=""></script>
<script>${SITE_MAP_PAGE_SCRIPT}</script>
</body>
</html>`;
}
