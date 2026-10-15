import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";

export type ReviewCardTone = "default" | "warning" | "success" | "danger";

const TONES: Record<ReviewCardTone, { backgroundColor: string; borderColor: string }> = {
  default: { backgroundColor: colors.card, borderColor: colors.border },
  warning: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  success: { backgroundColor: colors.successSoft, borderColor: colors.success },
  danger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
};

/** One card of the attendance review screen; its title is announced as a header. */
export function ReviewCard({ title, tone = "default", testID, children }: { title?: string; tone?: ReviewCardTone; testID?: string; children: ReactNode }) {
  return (
    <View testID={testID} style={[styles.card, TONES[tone]]}>
      {title ? (
        <AppText accessibilityRole="header" weight="bold" size="large">
          {title}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: spacing.lg, gap: spacing.xs },
});
