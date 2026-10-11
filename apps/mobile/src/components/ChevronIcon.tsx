import { StyleSheet, View } from "react-native";
import { isLayoutRTL } from "../lib/rtl";
import { colors } from "../lib/theme";

/**
 * A "back" chevron. It is drawn pointing left (the back direction in LTR) and
 * mirrored with scaleX -1 in RTL, so in the Arabic app it points right,
 * towards the start edge where the screen came from. Native RTL never
 * mirrors drawings or transforms by itself.
 */
export function ChevronIcon({ color = colors.primary, size = 12 }: { color?: string; size?: number }) {
  const mirrored = isLayoutRTL();
  return (
    <View testID="chevron-icon" style={[styles.box, { width: size * 1.5, height: size * 1.5 }, { transform: [{ scaleX: mirrored ? -1 : 1 }] }]}>
      <View
        style={[
          styles.chevron,
          { width: size, height: size, borderColor: color, transform: [{ rotate: "45deg" }] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", justifyContent: "center" },
  // Physical sides on purpose: this is a drawing (an arrow pointing left), mirrored above as a whole.
  chevron: { borderLeftWidth: 3, borderBottomWidth: 3, marginLeft: 4 }, // rtl-ok
});
