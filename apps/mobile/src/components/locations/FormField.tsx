import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { AppTextInput, type AppTextInputProps } from "../AppTextInput";

/** A labelled text field with its validation message underneath (announced when it appears). */
export function FormField({ label, error, note, ...input }: AppTextInputProps & { label: string; error?: string | null; note?: ReactNode }) {
  return (
    <View style={styles.field}>
      <AppText weight="semibold">{label}</AppText>
      <AppTextInput accessibilityLabel={label} {...input} style={[input.style, error ? styles.invalid : null]} />
      {note}
      {error ? <FieldError message={error} /> : null}
    </View>
  );
}

/** A validation message under a field or a group of choices. */
export function FieldError({ message }: { message: string }) {
  return (
    <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" size="small" weight="semibold" color={colors.danger}>
      {message}
    </AppText>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  invalid: { borderColor: colors.danger, borderWidth: 2 },
});
