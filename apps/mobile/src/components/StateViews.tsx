import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { colors, spacing } from "../lib/theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

/** Full-area loading state, announced to screen readers. */
export function LoadingView({ label }: { label?: string }) {
  const t = useTranslations("states");
  return (
    <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={label ?? t("loading")}>
      <ActivityIndicator size="large" color={colors.primary} />
      <AppText color={colors.muted} align="center">
        {label ?? t("loading")}
      </AppText>
    </View>
  );
}

/** Error message with a retry button. */
export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslations("states");
  return (
    <View style={[styles.box, styles.error]}>
      {/* The message itself is the alert, so the retry button stays a separate, tappable element. */}
      <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" weight="semibold" color={colors.danger}>
        {message}
      </AppText>
      {onRetry ? <Button label={t("retry")} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

/** Empty list state. */
export function EmptyView({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <AppText weight="semibold" align="center" color={colors.muted}>
        {title}
      </AppText>
      {hint ? (
        <AppText size="small" align="center" color={colors.muted}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  box: { borderRadius: 14, padding: spacing.lg, gap: spacing.md },
  error: { backgroundColor: colors.dangerSoft, marginHorizontal: spacing.xl, marginBottom: spacing.md },
  empty: { paddingVertical: spacing.xl * 2, paddingHorizontal: spacing.xl, gap: spacing.xs },
});
