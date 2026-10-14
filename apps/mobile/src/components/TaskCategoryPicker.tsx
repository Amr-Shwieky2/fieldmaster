import { Pressable, StyleSheet, View } from "react-native";
import { TaskCategory } from "@fieldmaster/shared-types";
import { useEnumLabel } from "../i18n/hooks";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import { AppText } from "./AppText";

const TASK_CATEGORIES = Object.values(TaskCategory);

/** The kind of work done (one choice), as large chips: used by the clock-out and the emergency call-out end. */
export function TaskCategoryPicker({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const enumLabel = useEnumLabel();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.grid}>
      {TASK_CATEGORIES.map((category) => {
        const selected = value === category;
        const text = enumLabel("TaskCategory", category);
        return (
          <Pressable
            key={category}
            accessibilityRole="radio"
            accessibilityLabel={text}
            accessibilityState={{ checked: selected, selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(category)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <AppText weight={selected ? "semibold" : "regular"} color={selected ? colors.primaryText : colors.text} align="center">
              {text}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: TOUCH_TARGET,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
});
