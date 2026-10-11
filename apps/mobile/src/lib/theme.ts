import { Platform, type TextStyle } from "react-native";

export const colors = {
  background: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#475569",
  primary: "#2563eb",
  primaryText: "#ffffff",
  danger: "#dc2626",
  dangerSoft: "#fef2f2",
  success: "#15803d",
  successSoft: "#dcfce7",
  warning: "#b45309",
  warningSoft: "#fef3c7",
};

/**
 * IBM Plex Sans Arabic, loaded at runtime in App.tsx (so it also works in
 * Expo Go). One family per weight: never combine a family with fontWeight
 * (Android would fall back to the system font for bold).
 */
export const fonts = {
  regular: "IBMPlexSansArabic_400Regular",
  semibold: "IBMPlexSansArabic_600SemiBold",
  bold: "IBMPlexSansArabic_700Bold",
} as const;

export type FontWeightName = keyof typeof fonts;

/** Large, worker-friendly sizes (field workers, outdoors, gloves). */
export const textSizes = {
  small: 15,
  body: 18,
  large: 20,
  title: 24,
  hero: 30,
} as const;

/**
 * Arabic needs room above and below the line: never less than 1.5x with this
 * font (Android clips descenders otherwise). 1.6x fits every basic letter.
 */
export function lineHeightFor(fontSize: number): number {
  return Math.ceil(fontSize * 1.6);
}

/**
 * Start-aligned text on every platform. Native has no textAlign "start", but
 * in RTL it flips "left" to the start (right) edge on iOS and Android; on web
 * react-native-web already defaults to `text-align: start`, and an explicit
 * "left" would stay physically left, so it is left unset there.
 */
export const textStart: TextStyle = Platform.select<TextStyle>({
  web: {},
  default: { textAlign: "left", writingDirection: "rtl" }, // rtl-ok: flipped to the start edge by native RTL
});

/** Minimum height for anything a worker taps. */
export const TOUCH_TARGET = 56;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
