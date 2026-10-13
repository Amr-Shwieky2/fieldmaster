import {
  LEAFLET_CSS_URL,
  LEAFLET_JS_URL,
  OSM_TILE_URL,
  SITE_MAP_PAGE_SCRIPT,
  buildSiteMapHtml,
  injectedMessage,
  placesMessage,
  scriptJson,
  workerMessage,
  type SiteMapData,
} from "../site-map-html";

const labels = { zoomIn: "تكبير", zoomOut: "تصغير", attribution: "Leaflet | © مساهمو OpenStreetMap", site: "نطاق الموقع", worker: "موقعك" };

function data(overrides: Partial<SiteMapData> = {}): SiteMapData {
  return {
    center: { latitude: 32.0853, longitude: 34.7818 },
    geofence: { latitude: 32.0853, longitude: 34.7818, radiusMeters: 150 },
    points: [],
    worker: null,
    labels,
    ...overrides,
  };
}

/** The data object the page reads (window.__FM_MAP__). */
function embedded(html: string): SiteMapData {
  const match = /window\.__FM_MAP__ = (.*);<\/script>/.exec(html);
  if (!match) throw new Error("no map data in the page");
  return JSON.parse(match[1]) as SiteMapData;
}

describe("site map page", () => {
  it("loads Leaflet 1.9.4 with Subresource Integrity and uses OpenStreetMap tiles", () => {
    const html = buildSiteMapHtml(data());
    expect(html).toContain(`<link rel="stylesheet" href="${LEAFLET_CSS_URL}" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">`);
    expect(html).toContain(`<script src="${LEAFLET_JS_URL}" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>`);
    expect(LEAFLET_JS_URL).toBe("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    expect(html).toContain(JSON.stringify(OSM_TILE_URL));
    expect(OSM_TILE_URL).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
  });

  it("keeps the map itself left-to-right inside the Arabic page, with the attribution in Arabic", () => {
    const html = buildSiteMapHtml(data());
    expect(html).toContain('<html lang="ar">');
    expect(html).toContain('<div id="map" dir="ltr"></div>');
    expect(embedded(html).labels.attribution).toBe("Leaflet | © مساهمو OpenStreetMap");
  });

  it("carries the geofence, the active temporary points and the worker's position as data", () => {
    const html = buildSiteMapHtml(
      data({
        points: [{ name: "نقطة تجمّع الطاقم", latitude: 32.0863, longitude: 34.7828, radiusMeters: 100 }],
        worker: { latitude: 32.0855, longitude: 34.782, accuracy: 12 },
      }),
    );
    expect(embedded(html)).toEqual(
      data({
        points: [{ name: "نقطة تجمّع الطاقم", latitude: 32.0863, longitude: 34.7828, radiusMeters: 100 }],
        worker: { latitude: 32.0855, longitude: 34.782, accuracy: 12 },
      }),
    );
  });

  it("never lets a name from the API become markup or end the script", () => {
    const hostile = '</script><script>alert("x")</script><img src=x onerror=alert(1)>';
    const html = buildSiteMapHtml(data({ points: [{ name: hostile, latitude: 32.08, longitude: 34.78, radiusMeters: 50 }] }));
    expect(html).not.toContain(hostile);
    expect(html).not.toContain("<img");
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(embedded(html).points[0].name).toBe(hostile);
    // Names are set as text in the page, never as HTML.
    expect(html).toContain("span.textContent = text");
  });

  it("escapes the characters that could break out of a script element", () => {
    expect(scriptJson({ text: "<b>&" })).toBe('{"text":"\\u003cb\\u003e\\u0026"}');
    expect(scriptJson({ text: String.fromCharCode(0x2028, 0x2029) })).toBe('{"text":"\\u2028\\u2029"}');
  });

  it("updates the page with small messages instead of reloading it", () => {
    expect(workerMessage({ latitude: 1, longitude: 2, accuracy: 3 })).toEqual({ type: "worker", worker: { latitude: 1, longitude: 2, accuracy: 3 } });
    expect(workerMessage(null)).toEqual({ type: "worker", worker: null });
    const places = { center: { latitude: 1, longitude: 2 }, geofence: null, points: [{ name: "<b>", latitude: 1, longitude: 2, radiusMeters: 50 }] };
    expect(placesMessage(places)).toEqual({ type: "data", data: places });
    // The native WebView gets it as a script, with the same escaping as the page's data.
    expect(injectedMessage(placesMessage(places))).toBe(`window.fmReceive && window.fmReceive(${scriptJson(placesMessage(places))}); true;`);
    expect(injectedMessage(placesMessage(places))).not.toContain("<b>");
  });

  it("runs the page script from the page", () => {
    expect(buildSiteMapHtml(data())).toContain(`<script>${SITE_MAP_PAGE_SCRIPT}</script>`);
  });
});
