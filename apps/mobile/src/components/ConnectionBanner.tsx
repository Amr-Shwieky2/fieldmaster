import { Pressable, StyleSheet } from "react-native";
import { useTranslations } from "use-intl";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors, spacing } from "../lib/theme";
import { AppText } from "./AppText";

/**
 * Offline / pending-sync notice. Hidden while online with nothing waiting.
 * Tapping it opens the offline queue.
 */
export function ConnectionBanner({ onPress, disabled = false }: { onPress?: () => void; disabled?: boolean }) {
  const t = useTranslations("connection");
  const { isOnline, pendingCount } = useOfflineSync();
  if (isOnline && pendingCount === 0) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("openQueue")}
      accessibilityState={{ disabled: disabled || !onPress }}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={[styles.banner, { backgroundColor: isOnline ? colors.successSoft : colors.warningSoft }]}
    >
      <AppText weight="semibold" color={isOnline ? colors.success : colors.warning}>
        {isOnline ? t("syncing") : t("offline")}
      </AppText>
      {pendingCount > 0 ? <AppText color={colors.text}>{t("pending", { count: pendingCount })}</AppText> : null}
      {!isOnline ? (
        <AppText size="small" color={colors.muted}>
          {t("offlineHint")}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: spacing.xl, marginBottom: spacing.md, borderRadius: 14, padding: spacing.md, gap: 2 },
});
