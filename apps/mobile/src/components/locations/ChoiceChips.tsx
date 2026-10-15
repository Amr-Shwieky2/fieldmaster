import { Pressable, StyleSheet, View } from "react-native";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** One choice among a few (shift type, check-in method, existing or new project), as large chips announced as a radio group. */
export function ChoiceChips<T extends string>({
  label,
  choices,
  value,
  onChange,
  disabled = false,
  testIDPrefix,
}: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  testIDPrefix?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <Pressable
            key={choice.value}
            testID={testIDPrefix ? `${testIDPrefix}-${choice.value}` : undefined}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ checked: selected, selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(choice.value)}
            style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabled]}
          >
            <AppText weight={selected ? "semibold" : "regular"} color={selected ? colors.primaryText : colors.text} align="center">
              {choice.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
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
  disabled: { opacity: 0.5 },
});
