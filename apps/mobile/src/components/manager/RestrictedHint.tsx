import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";

/**
 * «عرض مقيَّد بمشاريعك»: shown to a member restricted to some projects or
 * sites (useAccess().restricted). The API already filters every list and
 * counter to their places; this says so.
 */
export function RestrictedHint({ testID = "restricted-hint" }: { testID?: string }) {
  const t = useTranslations("managerHome");
  return (
    <View style={styles.hint} testID={testID}>
      <AppText size="small" weight="semibold" color={colors.muted}>
        {t("restricted")}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
});
