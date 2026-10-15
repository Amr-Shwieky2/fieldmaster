import { Pressable, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { useFormat } from "../../i18n/hooks";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";
import { Badge } from "../Badge";

export type NotificationTab = "action" | "info";

/**
 * A manager's two lists (mobile manager mode): «تحتاج إجراء», with how many
 * are still open, and «للعلم». On the start edge first (the right in RTL).
 */
export function NotificationTabs({ selected, onSelect, openCount }: { selected: NotificationTab; onSelect: (tab: NotificationTab) => void; openCount: number }) {
  const t = useTranslations("notifications");
  const format = useFormat();
  const tabs: { key: NotificationTab; label: string; count: number }[] = [
    { key: "action", label: t("tabAction"), count: openCount },
    { key: "info", label: t("tabInfo"), count: 0 },
  ];
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map((tab) => {
        const isSelected = tab.key === selected;
        return (
          <Pressable
            key={tab.key}
            testID={`notifications-tab-${tab.key}`}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isSelected }}
            accessibilityValue={tab.count > 0 ? { text: t("openActionsCount", { count: format.number(tab.count) }) } : undefined}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [styles.tab, isSelected && styles.tabSelected, pressed && !isSelected && styles.pressed]}
          >
            <AppText weight="semibold" align="center" color={isSelected ? colors.primaryText : colors.text}>
              {tab.label}
            </AppText>
            {tab.count > 0 ? (
              <Badge label={format.number(tab.count)} color={isSelected ? colors.card : colors.warning} textColor={isSelected ? colors.primary : colors.primaryText} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.xs,
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: { flex: 1, minHeight: TOUCH_TARGET, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  tabSelected: { backgroundColor: colors.primary },
  pressed: { opacity: 0.85 },
});
