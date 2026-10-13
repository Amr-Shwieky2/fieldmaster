import { act, screen } from "@testing-library/react-native";
import { webViewMock } from "../../../jest/react-native-webview-mock";
import ar from "../../i18n/messages";
import { useOfflineSync } from "../../lib/offline-sync-context";
import { injectedMessage, placesMessage, type SiteMapData } from "../../lib/site-map-html";
import { expectArabicOnly, inArabic, renderInArabic } from "../../screens/__tests__/clock-screens-test-utils";
import { SiteMap, mapBaseUrl } from "../SiteMap";

jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: jest.fn() }));

const GEOFENCE = { latitude: 32.0853, longitude: 34.7818, radiusMeters: 150 };
const POINT = { name: "نقطة تجمّع الطاقم", latitude: 32.0863, longitude: 34.7828, radiusMeters: 100 };

let online = true;

beforeEach(() => {
  online = true;
  webViewMock.reset();
  jest.mocked(useOfflineSync).mockImplementation(() => ({ isOnline: online, pendingCount: 0, queue: [], queueOfflineEvent: jest.fn(), syncNow: jest.fn() }) as unknown as ReturnType<typeof useOfflineSync>);
});

type WebViewProps = {
  source: { html: string; baseUrl: string };
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  onShouldStartLoadWithRequest: (request: { url: string }) => boolean;
};
const webView = () => screen.getByTestId("site-map").props as WebViewProps;

/** The map data the page was built with. */
function pageData(): SiteMapData {
  const match = /window\.__FM_MAP__ = (.*);<\/script>/.exec(webView().source.html);
  if (!match) throw new Error("no map data");
  return JSON.parse(match[1]) as SiteMapData;
}

describe("SiteMap (native WebView)", () => {
  it("draws the geofence circle and the active temporary points, with Arabic labels", async () => {
    await renderInArabic(<SiteMap geofence={GEOFENCE} points={[POINT]} worker={null} />);

    const data = pageData();
    expect(data.geofence).toEqual(GEOFENCE);
    expect(data.points).toEqual([POINT]);
    expect(data.worker).toBeNull();
    expect(data.labels).toEqual({
      zoomIn: ar.location.mapZoomIn,
      zoomOut: ar.location.mapZoomOut,
      attribution: ar.location.mapAttribution,
      site: ar.location.mapSite,
      worker: ar.location.mapWorker,
    });
    expect(screen.getByLabelText(ar.location.mapLabel)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("gives the page the API's origin (OpenStreetMap's tiles need a Referer) and keeps it from navigating away", async () => {
    await renderInArabic(<SiteMap geofence={GEOFENCE} points={[]} worker={null} />);

    expect(webView().source.baseUrl).toBe(mapBaseUrl());
    expect(mapBaseUrl("https://fieldmaster-api.onrender.com/api/v1")).toBe("https://fieldmaster-api.onrender.com/");
    expect(mapBaseUrl("http://192.168.1.20:3010/api/v1")).toBe("http://192.168.1.20:3010/");
    expect(webView().onShouldStartLoadWithRequest({ url: "about:blank" })).toBe(true);
    expect(webView().onShouldStartLoadWithRequest({ url: mapBaseUrl() })).toBe(true);
    expect(webView().onShouldStartLoadWithRequest({ url: "https://www.openstreetmap.org/copyright" })).toBe(false);
  });

  it("moves the worker's marker inside the page instead of reloading it", async () => {
    const view = await renderInArabic(<SiteMap geofence={GEOFENCE} points={[]} worker={null} />);
    const html = webView().source.html;

    await view.rerender(inArabic(<SiteMap geofence={GEOFENCE} points={[]} worker={{ latitude: 32.0855, longitude: 34.782, accuracy: 9 }} />));

    expect(webView().source.html).toBe(html);
    expect(webViewMock.injected.at(-1)).toBe('window.fmReceive && window.fmReceive({"type":"worker","worker":{"latitude":32.0855,"longitude":34.782,"accuracy":9}}); true;');
  });

  it("draws a newly opened temporary point in the loaded page: the same page, never re-created (regression: the redraw crash)", async () => {
    const view = await renderInArabic(<SiteMap geofence={GEOFENCE} points={[]} worker={null} />);
    const html = webView().source.html;
    webViewMock.reset();

    await view.rerender(inArabic(<SiteMap geofence={GEOFENCE} points={[POINT]} worker={null} />));

    // The WebView's source is untouched (no reload, no new Leaflet map); the points go in as a message.
    expect(webView().source.html).toBe(html);
    expect(pageData().points).toEqual([]);
    expect(webViewMock.injected).toEqual([
      injectedMessage(placesMessage({ center: { latitude: GEOFENCE.latitude, longitude: GEOFENCE.longitude }, geofence: GEOFENCE, points: [POINT] })),
    ]);
    expect(webViewMock.injected[0]).toMatch(/^window\.fmReceive && window\.fmReceive\(\{"type":"data"/);

    // The same points again (new arrays, same values): nothing is sent.
    webViewMock.reset();
    await view.rerender(inArabic(<SiteMap geofence={GEOFENCE} points={[{ ...POINT }]} worker={null} />));
    expect(webViewMock.injected).toEqual([]);
  });

  it("brings a (re)loaded page up to date: the latest places and worker on «map-ready»", async () => {
    const view = await renderInArabic(<SiteMap geofence={GEOFENCE} points={[]} worker={null} />);
    await view.rerender(inArabic(<SiteMap geofence={GEOFENCE} points={[POINT]} worker={{ latitude: 32.0855, longitude: 34.782, accuracy: 9 }} />));
    webViewMock.reset();

    await act(async () => webView().onMessage({ nativeEvent: { data: "map-ready" } }));

    expect(webViewMock.injected).toHaveLength(2);
    expect(webViewMock.injected[0]).toContain('"type":"data"');
    expect(webViewMock.injected[0]).toContain('"name":"نقطة تجمّع الطاقم"');
    expect(webViewMock.injected[1]).toBe('window.fmReceive && window.fmReceive({"type":"worker","worker":{"latitude":32.0855,"longitude":34.782,"accuracy":9}}); true;');
  });

  it("offline: shows «الخريطة غير متاحة دون اتصال» instead of the map", async () => {
    online = false;
    await renderInArabic(<SiteMap geofence={GEOFENCE} points={[POINT]} worker={null} />);

    expect(screen.getByText(ar.location.mapOffline)).toBeOnTheScreen();
    expect(screen.getByText("الخريطة غير متاحة دون اتصال")).toBeOnTheScreen();
    expect(screen.queryByTestId("site-map")).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("says when the shift has no site, and when the map could not load", async () => {
    const view = await renderInArabic(<SiteMap geofence={null} points={[]} worker={null} />);
    expect(screen.getByText(ar.location.mapNoSite)).toBeOnTheScreen();

    await view.rerender(inArabic(<SiteMap geofence={GEOFENCE} points={[]} worker={null} />));
    await act(async () => webView().onMessage({ nativeEvent: { data: "map-failed" } }));
    expect(screen.getByText(ar.location.mapFailed)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows the site itself (no circle) when it has no geofence radius", async () => {
    await renderInArabic(<SiteMap geofence={{ ...GEOFENCE, radiusMeters: 0 }} points={[]} worker={null} />);
    expect(pageData().geofence).toBeNull();
    expect(pageData().center).toEqual({ latitude: GEOFENCE.latitude, longitude: GEOFENCE.longitude });
  });
});
