import { Pressable, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { colors, spacing } from "../lib/theme";
import { AppText } from "./AppText";
import { ChevronIcon } from "./ChevronIcon";

/**
 * Title row for screens below Home. The back button sits on the start edge
 * (the right in RTL) with a mirrored chevron; the native stack header is off.
 */
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const tc = useTranslations("common");
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tc("back")} onPress={onBack} hitSlop={12} style={styles.back}>
          <ChevronIcon />
          <AppText weight="semibold" size="large" color={colors.primary}>
            {tc("back")}
          </AppText>
        </Pressable>
      ) : null}
      <AppText accessibilityRole="header" weight="bold" size="title">
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
  back: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: spacing.xs, minHeight: 44 },
});
