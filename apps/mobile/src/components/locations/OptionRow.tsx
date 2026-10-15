import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";

/**
 * A large tappable card in a list to pick from: one of many ("radio": a
 * site, a project) or any number ("checkbox": the shift's workers). The mark
 * is drawn on the start edge; `tone` "warning" outlines a row that needs the
 * manager's attention (a worker with an overlapping shift).
 */
export function OptionRow({
  role,
  selected,
  onPress,
  disabled = false,
  tone = "normal",
  testID,
  children,
}: {
  role: "radio" | "checkbox";
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  tone?: "normal" | "warning" | "danger";
  testID?: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.selected,
        tone === "warning" && styles.warning,
        tone === "danger" && styles.danger,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {role === "radio" ? <RadioMark selected={selected} /> : <CheckMark checked={selected} />}
      <View style={styles.body}>{children}</View>
    </Pressable>
  );
}

function RadioMark({ selected }: { selected: boolean }) {
  return <View style={[styles.radio, selected && styles.markOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>;
}

function CheckMark({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? <View style={styles.tick} /> : null}
    </View>
  );
}

const MARK = 26;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: TOUCH_TARGET + spacing.sm,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  selected: { borderColor: colors.primary, borderWidth: 2 },
  warning: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  danger: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  body: { flex: 1, gap: 2 },
  radio: { width: MARK, height: MARK, borderRadius: MARK / 2, borderWidth: 2, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  markOn: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  checkbox: { width: MARK, height: MARK, borderRadius: 6, borderWidth: 2, borderColor: colors.muted, alignItems: "center", justifyContent: "center" },
  checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  // A drawing (a tick), not text direction: the same shape in both directions.
  tick: { width: 12, height: 7, borderLeftWidth: 3, borderBottomWidth: 3, borderColor: colors.primaryText, transform: [{ rotate: "-45deg" }], marginTop: -3 }, // rtl-ok
});
