import { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { IBMPlexSansArabic_400Regular } from "@expo-google-fonts/ibm-plex-sans-arabic/400Regular";
import { IBMPlexSansArabic_600SemiBold } from "@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold";
import { IBMPlexSansArabic_700Bold } from "@expo-google-fonts/ibm-plex-sans-arabic/700Bold";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { IntlRoot } from "./src/i18n/IntlRoot";
import { RtlRoot } from "./src/components/RtlRoot";
import { AuthProvider } from "./src/lib/auth-context";
import { OfflineSyncProvider } from "./src/lib/offline-sync-context";
import { ensureRtl } from "./src/lib/rtl";
import { RootNavigator } from "./src/navigation/RootNavigator";

// Keep the splash screen up until the Arabic font is loaded and RTL is confirmed,
// so the first frame a worker sees is already Arabic and right-to-left.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ IBMPlexSansArabic_400Regular, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold });
  const [rtlReady, setRtlReady] = useState(false);

  useEffect(() => {
    let active = true;
    ensureRtl()
      .catch(() => "unavailable" as const)
      .then((status) => {
        // "reloading": the app restarts in RTL; keep the splash screen until then.
        if (active && status !== "reloading") setRtlReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const ready = (fontsLoaded || fontError !== null) && rtlReady;
  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;

  return (
    <RtlRoot>
      <SafeAreaProvider>
        <IntlRoot>
          <AuthProvider>
            <OfflineSyncProvider>
              <RootNavigator />
              <StatusBar style="dark" />
            </OfflineSyncProvider>
          </AuthProvider>
        </IntlRoot>
      </SafeAreaProvider>
    </RtlRoot>
  );
}
