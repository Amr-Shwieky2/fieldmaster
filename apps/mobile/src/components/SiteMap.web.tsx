import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { useOfflineSync } from "../lib/offline-sync-context";
import type { SiteMapMessage } from "../lib/site-map-html";
import { colors, spacing } from "../lib/theme";
import { AppText } from "./AppText";
import { useSiteMapNotice, useSiteMapPage, type SiteMapProps } from "./useSiteMapPage";

export type { SiteMapProps } from "./useSiteMapPage";

/**
 * Web target: react-native-webview has no web support, so the same page is
 * shown in a sandboxed <iframe srcDoc> (scripts only: no access to the app's
 * page, cookies or storage). Its srcDoc never changes after the first render:
 * the site, the temporary points and the worker's position are posted into
 * it and drawn in place on the same Leaflet map (the same path as the native
 * WebView, which gets them injected).
 */
export function SiteMap({ geofence, points, worker, height = 260, testID = "site-map" }: SiteMapProps) {
  const t = useTranslations("location");
  const { isOnline } = useOfflineSync();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [failed, setFailed] = useState(false);
  // Before the page is ready the page ignores it ("map-ready" sends everything again); after unmount the ref is null.
  const send = (message: SiteMapMessage) => frame.current?.contentWindow?.postMessage(message, "*");
  const { html, hasSite, onReady } = useSiteMapPage(geofence, points, worker, send);
  const notice = useSiteMapNotice(hasSite, isOnline, failed);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let active = true;
    function onMessage(event: MessageEvent) {
      if (!active || !frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data as { source?: string; type?: string } | null;
      if (message?.source !== "fieldmaster-map") return;
      if (message.type === "map-ready") onReadyRef.current();
      else if (message.type === "map-failed") setFailed(true);
    }
    window.addEventListener("message", onMessage);
    return () => {
      active = false;
      window.removeEventListener("message", onMessage);
    };
  }, []);

  if (notice || !html) {
    return (
      <View testID={`${testID}-unavailable`} style={[styles.placeholder, { height }]}>
        <AppText weight="semibold" color={colors.muted} align="center">
          {notice}
        </AppText>
      </View>
    );
  }

  return (
    <View style={[styles.frame, { height }]} testID={testID}>
      <iframe
        ref={frame}
        srcDoc={html}
        title={t("mapLabel")}
        sandbox="allow-scripts"
        style={{ border: 0, width: "100%", height: "100%", display: "block" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.border },
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
