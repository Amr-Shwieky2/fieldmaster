import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import type { NotificationHandled } from "@fieldmaster/api-client";
import { useEnumLabel, useFormat } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { isolateAuto } from "../LtrText";

/**
 * Who settled the application a notification is about, and how: shared by
 * every manager's copy of the notification, so a second manager sees at once
 * that someone else already decided.
 */
export function HandledBanner({ handled }: { handled: NotificationHandled }) {
  const t = useTranslations("onboardingReview");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const rejected = handled.outcome === "WORKER_REJECTED" || handled.outcome === "REJECTED";
  return (
    <View testID="onboarding-handled" accessibilityRole="alert" style={[styles.banner, rejected ? styles.rejected : styles.approved]}>
      <AppText weight="bold">{t("handledBy", { name: isolateAuto(handled.by.fullLegalName), time: format.dateTime(handled.at) })}</AppText>
      <AppText weight="semibold" color={rejected ? colors.danger : colors.success}>
        {t("handledOutcome", { outcome: enumLabel("NotificationHandledOutcome", handled.outcome) })}
      </AppText>
      {handled.note ? <AppText color={colors.muted}>{t("handledNote", { note: isolateAuto(handled.note) })}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 16, padding: spacing.lg, gap: spacing.xs, borderWidth: 1 },
  approved: { backgroundColor: colors.successSoft, borderColor: colors.success },
  rejected: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
});
