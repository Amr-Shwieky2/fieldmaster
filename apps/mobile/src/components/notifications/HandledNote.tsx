import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslations } from "use-intl";
import type { NotificationHandled } from "@fieldmaster/api-client";
import { useEnumLabel, useFormat } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { isolateAuto } from "../LtrText";

/**
 * Who settled what a notification is about (mobile manager mode), shared by
 * every manager's copy: «تمت المعالجة بواسطة … في …», the outcome and the
 * note. Shown in the notifications list and on the screens that settle a
 * subject.
 */
export function HandledNote({ handled, style, testID }: { handled: NotificationHandled; style?: StyleProp<ViewStyle>; testID?: string }) {
  const t = useTranslations("notifications");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  return (
    <View testID={testID} style={[styles.box, style]}>
      <AppText weight="semibold" color={colors.success}>
        {t("handledBy", { name: isolateAuto(handled.by.fullLegalName), time: format.dateTime(handled.at) })}
      </AppText>
      <AppText>{t("handledOutcome", { outcome: enumLabel("NotificationHandledOutcome", handled.outcome) })}</AppText>
      {handled.note ? <AppText color={colors.muted}>{t("handledNote", { note: isolateAuto(handled.note) })}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.successSoft, borderRadius: 12, padding: spacing.md, gap: 2 },
});
