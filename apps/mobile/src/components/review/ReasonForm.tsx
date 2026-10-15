import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { AppTextInput } from "../AppTextInput";
import { Button } from "../Button";

/**
 * A written text before an action is sent: the reason of a rejection, a
 * full-day credit or a correction request (stored and shown to people, so the
 * caller refuses a blank one before any request), or the optional note of a
 * follow-up. `onSubmit` gets the trimmed text.
 */
export function ReasonForm({
  label,
  hint,
  value,
  error,
  placeholder,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busyLabel,
  busy,
  disabled = false,
  variant = "primary",
  testID,
}: {
  label: string;
  hint: string;
  value: string;
  /** Shown under the field (e.g. «اكتب السبب قبل المتابعة.»). */
  error?: string | null;
  placeholder?: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  submitLabel: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  variant?: "primary" | "danger";
  testID?: string;
}) {
  const tc = useTranslations("common");
  return (
    <View testID={testID} style={styles.form}>
      <AppText weight="semibold">{label}</AppText>
      <AppTextInput
        value={value}
        onChangeText={onChange}
        multiline
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholder={placeholder}
        editable={!busy}
      />
      <AppText size="small" color={colors.muted}>
        {hint}
      </AppText>
      {error ? (
        <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
      <View style={styles.buttons}>
        <Button label={submitLabel} busy={busy} busyLabel={busyLabel} variant={variant} disabled={disabled} onPress={() => onSubmit(value.trim())} />
        <Button label={tc("cancel")} variant="secondary" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.sm, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, padding: spacing.md },
  buttons: { gap: spacing.sm },
});
