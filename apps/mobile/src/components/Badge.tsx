import { StyleSheet, View } from "react-native";
import { AppText } from "./AppText";

/** Small coloured status label. */
export function Badge({ label, color, textColor = "#ffffff" }: { label: string; color: string; textColor?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <AppText size="small" weight="semibold" color={textColor} align="center">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 2, alignSelf: "flex-start" },
});
