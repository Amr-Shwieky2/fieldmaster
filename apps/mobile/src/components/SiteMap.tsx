import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useTranslations } from "use-intl";
import { API_URL } from "../lib/api-url";
import { useOfflineSync } from "../lib/offline-sync-context";
import { injectedMessage, type SiteMapMessage } from "../lib/site-map-html";
import { colors, spacing } from "../lib/theme";
import { AppText } from "./AppText";
import { useSiteMapNotice, useSiteMapPage, type SiteMapProps } from "./useSiteMapPage";

export type { SiteMapProps } from "./useSiteMapPage";

/**
 * The page's origin. Leaflet and the tiles are fetched by the WebView; a
 * page loaded from a string has no origin, and OpenStreetMap's tile servers
 * refuse requests without a Referer, so the page gets the API's origin.
 */
export function mapBaseUrl(apiUrl: string = API_URL): string {
  const match = /^(https?:\/\/[^/]+)/.exec(apiUrl);
  return `${match?.[1] ?? "http://localhost"}/`;
}

/**
 * The map on the shift details screen (iOS / Android): the geofence circle,
 * the active temporary check-in points and the worker's position, in a
 * WebView with Leaflet and OpenStreetMap tiles. The WebView's page is loaded
 * once; changes are injected into it and drawn in place (the same path as
 * the web version, SiteMap.web.tsx, which posts them into an iframe:
 * react-native-webview has no web support). Without a connection the tiles
 * cannot load, so an Arabic notice takes the map's place.
 */
export function SiteMap({ geofence, points, worker, height = 260, testID = "site-map" }: SiteMapProps) {
  const t = useTranslations("location");
  const { isOnline } = useOfflineSync();
  const webView = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  // Before the page is ready the page ignores it ("map-ready" sends everything again); after unmount the ref is null.
  const send = (message: SiteMapMessage) => webView.current?.injectJavaScript(injectedMessage(message));
  const { html, hasSite, onReady } = useSiteMapPage(geofence, points, worker, send);
  const notice = useSiteMapNotice(hasSite, isOnline, failed);

  function onMessage(event: WebViewMessageEvent) {
    if (event.nativeEvent.data === "map-ready") onReady();
    else if (event.nativeEvent.data === "map-failed") setFailed(true);
  }

  if (notice || !html) {
    return (
      <View testID={`${testID}-unavailable`} style={[styles.placeholder, { height }]}>
        <AppText weight="semibold" color={colors.muted} align="center">
          {notice}
        </AppText>
      </View>
    );
  }

  const baseUrl = mapBaseUrl();
  return (
    <View style={[styles.frame, { height }]} accessible accessibilityLabel={t("mapLabel")}>
      <WebView
        ref={webView}
        testID={testID}
        source={{ html, baseUrl }}
        originWhitelist={["*"]}
        javaScriptEnabled
        // Nothing in the page may navigate away from it.
        onShouldStartLoadWithRequest={(request) => request.url === "about:blank" || request.url.startsWith(baseUrl)}
        setSupportMultipleWindows={false}
        onMessage={onMessage}
        onError={() => setFailed(true)}
        style={styles.webView}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.border },
  webView: { flex: 1, backgroundColor: colors.border },
  placeholder: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
});
