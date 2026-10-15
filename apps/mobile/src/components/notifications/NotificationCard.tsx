import { Pressable, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { useEnumLabel, useFormat } from "../../i18n/hooks";
import { targetForInAppNotification } from "../../lib/linking";
import { renderNotificationAction, renderNotificationText } from "../../lib/notification-text";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";
import { Badge } from "../Badge";
import { HandledNote } from "./HandledNote";
import type { NotificationRow } from "./notification-rows";

/**
 * One row of the notifications list: the newest notification's Arabic text
 * (never the stored English) and time, «×N» when it stands for several about
 * the same subject, «غير مقروء», and for a manager's actionable row the
 * action it asks for -- or, once someone settled it, who did and how.
 */
export function NotificationCard({ row, onPress }: { row: NotificationRow; onPress: () => void }) {
  const t = useTranslations("notifications");
  const format = useFormat();
  const enumLabel = useEnumLabel();

  const { latest } = row;
  const rendered = renderNotificationText(t, format, enumLabel, latest);
  const actionText = row.handled ? null : renderNotificationAction(t, format, { action: row.action, dataJson: latest.dataJson });
  const leadsSomewhere = targetForInAppNotification({ type: latest.type, dataJson: latest.dataJson, subjectId: row.subjectId, action: row.action }).name !== "Notifications";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={leadsSomewhere ? t("openHint") : row.unread ? t("markReadHint") : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.card, row.unread && styles.cardUnread, pressed && styles.pressed]}
    >
      <View style={styles.cardRow}>
        <AppText weight={row.unread ? "bold" : "semibold"} size="large" style={styles.cardTitle}>
          {rendered.title}
        </AppText>
        <View style={styles.badges}>
          {row.count > 1 ? <Badge label={t("groupCount", { count: format.number(row.count) })} color={colors.muted} /> : null}
          {row.unread ? <Badge label={t("unread")} color={colors.primary} /> : null}
        </View>
      </View>
      <AppText>{rendered.body}</AppText>
      {actionText ? (
        <View style={styles.action}>
          <AppText weight="semibold" color={colors.warning}>
            {actionText}
          </AppText>
        </View>
      ) : null}
      {row.handled ? <HandledNote handled={row.handled} /> : null}
      <AppText size="small" color={colors.muted}>
        {format.dateTime(latest.createdAt)}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  cardUnread: { borderColor: colors.primary, borderWidth: 2 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cardTitle: { flexShrink: 1 },
  badges: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  action: { backgroundColor: colors.warningSoft, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.xs },
  pressed: { opacity: 0.85 },
});
