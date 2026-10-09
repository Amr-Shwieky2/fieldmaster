import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import { AppText } from "./AppText";

type Variant = "primary" | "danger" | "secondary" | "link";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  variant?: Variant;
  /** Shows a spinner next to the label and disables the button. */
  busy?: boolean;
  busyLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Large, worker-friendly button (at least 56 points high). Always announced as a button. */
export function Button({ label, variant = "primary", busy = false, busyLabel, disabled, style, ...props }: ButtonProps) {
  const isDisabled = disabled || busy;
  const text = busy && busyLabel ? busyLabel : label;
  const textColor = variant === "primary" || variant === "danger" ? colors.primaryText : variant === "link" ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={{ disabled: isDisabled, busy }}
      disabled={isDisabled}
      style={({ pressed }) => [styles.base, styles[variant], isDisabled && styles.disabled, pressed && !isDisabled && styles.pressed, style]}
      {...props}
    >
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={textColor} /> : null}
        <AppText weight="semibold" size="large" color={textColor} align="center">
          {text}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: TOUCH_TARGET, borderRadius: 14, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  primary: { backgroundColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  link: { backgroundColor: "transparent" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
