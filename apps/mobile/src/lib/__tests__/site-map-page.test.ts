import { SITE_MAP_PAGE_SCRIPT, type MapPlaces, type SiteMapData } from "../site-map-html";

/** Node's vm module (the app's TypeScript setup has no Node types). */
const vm = jest.requireActual("vm") as { createContext: (sandbox: object) => object; runInContext: (code: string, context: object) => unknown };

/**
 * The map page's own script, run against a fake Leaflet (Leaflet needs a real
 * DOM, which these tests do not have). The fake is stricter than Leaflet:
 * adding a layer before the map has a view, or asking a layer for its bounds,
 * throws the error the web map used to hit when it was redrawn
 * ("Cannot read properties of undefined (reading 'layerPointToLatLng')").
 */

const REDRAW_CRASH = "Cannot read properties of undefined (reading 'layerPointToLatLng')";

class FakeBounds {
  constructor(public readonly parts: string[]) {}
  extend(other: FakeBounds) {
    this.parts.push(...other.parts);
    return this;
  }
}

interface FakeLayer {
  kind: string;
  at: unknown;
  options: Record<string, unknown>;
  tooltip: { textContent: string } | null;
}

function createFakeLeaflet(initialSize: { x: number; y: number }) {
  const maps: ReturnType<typeof createMap>[] = [];

  function createMap() {
    const handlers: Record<string, (() => void)[]> = {};
    const map = {
      size: { ...initialSize },
      view: null as { center: unknown; zoom: number } | null,
      fits: [] as FakeBounds[],
      removed: false,
      invalidated: 0,
      layers: [] as unknown[],
      setView(center: unknown, zoom: number) {
        map.view = { center, zoom };
        return map;
      },
      getSize: () => map.size,
      fitBounds(bounds: FakeBounds) {
        if (map.removed || !map.view) throw new TypeError(REDRAW_CRASH);
        map.fits.push(bounds);
        return map;
      },
      on(event: string, handler: () => void) {
        (handlers[event] ??= []).push(handler);
        return map;
      },
      invalidateSize() {
        map.invalidated += 1;
        for (const handler of handlers.resize ?? []) handler();
        return map;
      },
      addLayer(layer: unknown) {
        if (map.removed || !map.view) throw new TypeError(REDRAW_CRASH);
        map.layers.push(layer);
        return map;
      },
      remove() {
        map.removed = true;
      },
    };
    return map;
  }

  function layer(kind: string, at: unknown, options: Record<string, unknown> = {}) {
    const created: FakeLayer & { bindTooltip: (content: { textContent: string }) => typeof created; addTo: (target: { addLayer: (l: unknown) => unknown }) => typeof created; getBounds: () => never } = {
      kind,
      at,
      options,
      tooltip: null,
      bindTooltip(content) {
        created.tooltip = content;
        return created;
      },
      addTo(target) {
        target.addLayer(created);
        return created;
      },
      getBounds() {
        throw new TypeError(REDRAW_CRASH);
      },
    };
    return created;
  }

  function layerGroup() {
    const group = {
      layers: [] as FakeLayer[],
      cleared: 0,
      map: null as ReturnType<typeof createMap> | null,
      addLayer(added: FakeLayer) {
        if (!group.map || group.map.removed) throw new TypeError(REDRAW_CRASH);
        group.layers.push(added);
        return group;
      },
      clearLayers() {
        group.layers = [];
        group.cleared += 1;
        return group;
      },
      addTo(map: ReturnType<typeof createMap>) {
        map.addLayer(group);
        group.map = map;
        return group;
      },
    };
    return group;
  }

  const groups: ReturnType<typeof layerGroup>[] = [];
  const attributionContainer = { textContent: "" };
  const api = {
    map: () => {
      const map = createMap();
      maps.push(map);
      return map;
    },
    control: {
      zoom: () => ({ addTo: (map: ReturnType<typeof createMap>) => map.addLayer("zoom") }),
      attribution: () => ({ addTo: (map: ReturnType<typeof createMap>) => map.addLayer("attribution"), getContainer: () => attributionContainer }),
    },
    tileLayer: (url: string) => ({ addTo: (map: ReturnType<typeof createMap>) => map.addLayer({ kind: "tiles", url }) }),
    layerGroup: () => {
      const group = layerGroup();
      groups.push(group);
      return group;
    },
    circle: (at: unknown, options: Record<string, unknown>) => layer("circle", at, options),
    circleMarker: (at: unknown, options: Record<string, unknown>) => layer("circleMarker", at, options),
    latLng: (lat: number, lng: number) => ({ toBounds: (size: number) => new FakeBounds([`${lat},${lng}/${size}`]) }),
  };
  return { api, maps, groups, attributionContainer };
}

const labels = { zoomIn: "تكبير", zoomOut: "تصغير", attribution: "Leaflet | © مساهمو OpenStreetMap", site: "نطاق الموقع", worker: "موقعك" };
const SITE = { latitude: 32.0853, longitude: 34.7818 };
const POINT = { name: "نقطة تجمّع الطاقم", latitude: 32.0863, longitude: 34.7828, radiusMeters: 100 };
const SECOND_POINT = { name: "نقطة المدخل الشمالي", latitude: 32.0873, longitude: 34.7838, radiusMeters: 80 };

function places(points = [POINT]): MapPlaces {
  return { center: SITE, geofence: { ...SITE, radiusMeters: 150 }, points };
}

type PageEvent = { source?: unknown; data: unknown };

/** Loads the page script as a browser (the web iframe) or a native WebView would. */
function loadPage(options: { data?: SiteMapData | null; size?: { x: number; y: number }; leaflet?: boolean; native?: boolean } = {}) {
  const leaflet = createFakeLeaflet(options.size ?? { x: 340, y: 260 });
  const windowListeners: Record<string, ((event: PageEvent) => void)[]> = {};
  const documentListeners: Record<string, ((event: PageEvent) => void)[]> = {};
  const posted: unknown[] = [];
  const timers: (() => void)[] = [];
  const parent = { postMessage: (message: unknown) => posted.push(message) };
  const page: Record<string, unknown> = {
    __FM_MAP__: options.data === undefined ? { ...places(), worker: null, labels } : options.data,
    parent,
    addEventListener: (type: string, handler: (event: PageEvent) => void) => (windowListeners[type] ??= []).push(handler),
  };
  if (options.native) page.ReactNativeWebView = { postMessage: (message: string) => posted.push(message) };
  const document = {
    addEventListener: (type: string, handler: (event: PageEvent) => void) => (documentListeners[type] ??= []).push(handler),
    createElement: () => ({ textContent: "" }),
  };
  const context = vm.createContext({
    window: page,
    document,
    setTimeout: (handler: () => void) => timers.push(handler),
    JSON,
    ...(options.leaflet === false ? {} : { L: leaflet.api }),
  });
  vm.runInContext(SITE_MAP_PAGE_SCRIPT, context);

  const map = () => leaflet.maps[0];
  return {
    leaflet,
    page,
    posted,
    map,
    places: () => leaflet.groups[0],
    worker: () => leaflet.groups[1],
    receive: (message: unknown) => (page.fmReceive as (message: unknown) => void)(message),
    windowEvent: (type: string, event: PageEvent = { data: null }) => (windowListeners[type] ?? []).forEach((handler) => handler(event)),
    documentEvent: (type: string, event: PageEvent) => (documentListeners[type] ?? []).forEach((handler) => handler(event)),
    runTimers: () => timers.splice(0).forEach((handler) => handler()),
  };
}

describe("map page (Leaflet in the WebView / iframe)", () => {
  it("creates one map with a view before any layer, draws the geofence and the points, and fits them", () => {
    const page = loadPage();

    expect(page.leaflet.maps).toHaveLength(1);
    expect(page.map().view).toEqual({ center: [SITE.latitude, SITE.longitude], zoom: 16 });
    expect(page.places().layers.map((l) => [l.kind, l.options.radius])).toEqual([
      ["circle", 150],
      ["circle", 100],
    ]);
    // Names are text, never markup.
    expect(page.places().layers[1].tooltip?.textContent).toBe("نقطة تجمّع الطاقم");
    expect(page.leaflet.attributionContainer.textContent).toBe(labels.attribution);
    expect(page.map().fits).toHaveLength(1);
    expect(page.posted).toEqual([{ source: "fieldmaster-map", type: "map-ready" }]);
  });

  it("draws a newly opened temporary point on the same map, without re-creating it (the redraw crash)", () => {
    const page = loadPage();

    expect(() => page.receive({ type: "data", data: places([POINT, SECOND_POINT]) })).not.toThrow();

    expect(page.leaflet.maps).toHaveLength(1);
    expect(page.places().cleared).toBe(2);
    expect(page.places().layers.map((l) => l.tooltip?.textContent)).toEqual([labels.site, POINT.name, SECOND_POINT.name]);
    // A change of place fits the view again.
    expect(page.map().fits).toHaveLength(2);
    expect(page.map().fits[1].parts).toEqual([`${SITE.latitude},${SITE.longitude}/1`, `${SITE.latitude},${SITE.longitude}/300`, "32.0863,34.7828/200", "32.0873,34.7838/160"]);
  });

  it("takes the update as the web iframe receives it (a message from the parent) and as Android's WebView does (a JSON string)", () => {
    const page = loadPage();
    page.windowEvent("message", { source: page.page.parent, data: { type: "data", data: places([]) } });
    expect(page.places().layers).toHaveLength(1);

    page.documentEvent("message", { data: JSON.stringify({ type: "data", data: places([POINT, SECOND_POINT]) }) });
    expect(page.places().layers).toHaveLength(3);
    expect(page.leaflet.maps).toHaveLength(1);
  });

  it("ignores messages from anything but the app", () => {
    const page = loadPage();
    page.windowEvent("message", { source: { other: "frame" }, data: { type: "data", data: places([]) } });
    page.documentEvent("message", { data: "not json" });
    expect(page.places().cleared).toBe(1);
    expect(page.places().layers).toHaveLength(2);
  });

  it("does not move the view when the same places are drawn again, or when the worker moves", () => {
    const page = loadPage();
    page.receive({ type: "data", data: places() });
    page.receive({ type: "worker", worker: { latitude: 32.0855, longitude: 34.782, accuracy: 12 } });

    expect(page.map().fits).toHaveLength(1);
    expect(page.worker().layers.map((l) => [l.kind, l.options.radius])).toEqual([
      ["circle", 12],
      ["circleMarker", 7],
    ]);
    expect(page.worker().layers[1].tooltip?.textContent).toBe(labels.worker);

    page.receive({ type: "worker", worker: null });
    expect(page.worker().layers).toEqual([]);
  });

  it("waits for the frame to have a size before fitting, then fits after layout", () => {
    const page = loadPage({ size: { x: 0, y: 0 } });
    expect(page.map().fits).toHaveLength(0);

    page.map().size = { x: 340, y: 260 };
    page.runTimers();
    expect(page.map().invalidated).toBe(1);
    expect(page.map().fits).toHaveLength(1);

    // A later resize of the frame measures the map again.
    page.windowEvent("resize");
    expect(page.map().invalidated).toBe(2);
    expect(page.map().fits).toHaveLength(1);
  });

  it("removes the map when the page goes away, and ignores late messages", () => {
    const page = loadPage();
    page.windowEvent("pagehide");
    expect(page.map().removed).toBe(true);

    expect(() => {
      page.receive({ type: "data", data: places([POINT, SECOND_POINT]) });
      page.receive({ type: "worker", worker: { latitude: 1, longitude: 2, accuracy: 3 } });
      page.windowEvent("resize");
      page.runTimers();
    }).not.toThrow();
    expect(page.places().cleared).toBe(1);
    expect(page.map().fits).toHaveLength(1);
  });

  it("shows the site as a dot when it has no radius", () => {
    const page = loadPage({ data: { center: SITE, geofence: null, points: [], worker: null, labels } });
    expect(page.places().layers.map((l) => l.kind)).toEqual(["circleMarker"]);
  });

  it("tells the app when Leaflet could not load (the Arabic notice replaces the map)", () => {
    const browser = loadPage({ leaflet: false });
    expect(browser.posted).toEqual([{ source: "fieldmaster-map", type: "map-failed" }]);
    expect(browser.leaflet.maps).toHaveLength(0);

    const native = loadPage({ leaflet: false, native: true });
    expect(native.posted).toEqual(["map-failed"]);
  });

  it("talks to the native WebView with plain strings", () => {
    const page = loadPage({ native: true });
    expect(page.posted).toEqual(["map-ready"]);
  });
});
