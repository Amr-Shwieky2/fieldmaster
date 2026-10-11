import { I18nManager, Platform } from "react-native";
import { isRunningInExpoGo, reloadAppAsync } from "expo";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The app is Arabic only and always right-to-left. How RTL is switched on
 * depends on where the app runs (details in docs/technical-decisions.md,
 * "Step 3: RTL on mobile"):
 *
 * - Development / production builds: the expo-localization config plugin
 *   (app.json, forcesRTL) forces RTL natively before React starts, so
 *   `I18nManager.isRTL` is already true on the first render.
 * - Expo Go: only `expo.extra.forcesRTL` in app.json counts; Expo Go applies
 *   it when the project opens and overwrites anything set from JS.
 * - Web: react-native-web ignores I18nManager; RTL comes from `dir="rtl"`
 *   (public/index.html and RtlRoot.web.tsx).
 *
 * `ensureRtl` is the safety net for a native build that somehow starts LTR
 * (e.g. the plugin was added without rebuilding): it forces RTL and reloads
 * once. A stored flag guarantees it can never loop.
 */
export const RTL_RELOAD_FLAG = "fieldmaster.rtlReloadAttempted";

export type RtlStatus = "ok" | "reloading" | "unavailable";

export interface RtlEnvironment {
  os: string;
  isRTL: boolean | undefined;
  inExpoGo: boolean;
  allowRTL: (allow: boolean) => void;
  forceRTL: (force: boolean) => void;
  reload: (reason: string) => Promise<void>;
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> };
}

function currentEnvironment(): RtlEnvironment {
  return {
    os: Platform.OS,
    isRTL: I18nManager.isRTL,
    inExpoGo: isRunningInExpoGo(),
    allowRTL: (allow) => I18nManager.allowRTL(allow),
    forceRTL: (force) => I18nManager.forceRTL(force),
    reload: (reason) => reloadAppAsync(reason),
    storage: AsyncStorage,
  };
}

export async function ensureRtl(env: RtlEnvironment = currentEnvironment()): Promise<RtlStatus> {
  if (env.os === "web") return "ok";
  if (env.isRTL) {
    await env.storage.removeItem(RTL_RELOAD_FLAG).catch(() => undefined);
    return "ok";
  }
  env.allowRTL(true);
  env.forceRTL(true);
  // Expo Go rewrites the RTL preference from app.json on every load; a JS reload would never stick.
  if (env.inExpoGo) return "unavailable";
  if (await env.storage.getItem(RTL_RELOAD_FLAG)) return "unavailable";
  await env.storage.setItem(RTL_RELOAD_FLAG, "1");
  await env.reload("FieldMaster: enable right-to-left layout");
  return "reloading";
}

/** Whether the current layout is right-to-left (always on web, where the root has dir="rtl"). Read it at render time. */
export function isLayoutRTL(): boolean {
  return Platform.OS === "web" ? true : I18nManager.isRTL;
}
