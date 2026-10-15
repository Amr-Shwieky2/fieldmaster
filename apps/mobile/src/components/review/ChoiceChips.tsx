import { Pressable, StyleSheet, View } from "react-native";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** One choice among a few, as large chips (a radio group for screen readers). */
export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  /** What is being chosen (read by screen readers). */
  label: string;
  options: readonly Choice<T>[];
  value: T | "";
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.grid}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <AppText weight={selected ? "semibold" : "regular"} color={selected ? colors.primaryText : colors.text} align="center">
              {option.label}
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
