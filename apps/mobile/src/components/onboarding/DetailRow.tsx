import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";

/** One fact of an application: its label, then its value (already isolated by the caller when it is user data or a number). */
export function DetailRow({ label, value, testID, children }: { label: string; value?: string; testID?: string; children?: ReactNode }) {
  return (
    <View style={styles.row} testID={testID}>
      <AppText color={colors.muted}>{label}</AppText>
      {value !== undefined ? <AppText weight="semibold">{value}</AppText> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2, paddingVertical: spacing.xs },
});
