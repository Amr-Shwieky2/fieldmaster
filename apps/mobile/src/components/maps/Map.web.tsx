import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslations } from "use-intl";
import { AppText } from "../AppText";
import { colors, spacing } from "../../lib/theme";

/**
 * The web build's stand-in for react-native-maps (it has no web version):
 * the screens stay usable in the browser for checks, with a note where the
 * map would be. The phone shows the real map (Map.tsx).
 */
export interface Region {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}
export interface LatLng {
  latitude: number;
  longitude: number;
}
export type MapPressEvent = { nativeEvent: { coordinate: LatLng } };
export type MarkerDragStartEndEvent = { nativeEvent: { coordinate: LatLng } };

export const MapView = forwardRef(function MapView({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode; [key: string]: unknown }, ref) {
  const t = useTranslations("maps");
  useImperativeHandle(ref, () => ({ animateToRegion: () => undefined }));
  return (
    <View style={[styles.box, style]}>
      <AppText color={colors.muted}>{t("webUnavailable")}</AppText>
      {children}
    </View>
  );
});

export function Marker(_props: { [key: string]: unknown }) {
  return null;
}
export function Circle(_props: { [key: string]: unknown }) {
  return null;
}
export function Callout(_props: { [key: string]: unknown }) {
  return null;
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center", backgroundColor: colors.border, padding: spacing.lg },
});
