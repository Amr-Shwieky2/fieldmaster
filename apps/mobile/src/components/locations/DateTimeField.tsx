import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useTranslations } from "use-intl";
import { BUSINESS_TIME_ZONE } from "@fieldmaster/i18n";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";
import { AppTextInput } from "../AppTextInput";
import { Button } from "../Button";
import { businessDayOf, businessInstant, isBusinessDay, isWallTime, wallTimeOf } from "./business-time";

/** The iOS picker's month and period names in Arabic with Western digits (Android's dialog follows the app's language). */
const IOS_PICKER_LOCALE = "ar@numbers=latn";

/**
 * A business date or a wall-clock time (Asia/Jerusalem, whatever the
 * phone's zone), shown as the app formats it and changed with the native
 * picker: Android's dialog, or iOS's picker opened under the field. The web
 * build (checks only) types the value instead. `onChange` receives
 * "YYYY-MM-DD" (date) or "HH:mm" (time).
 */
export function DateTimeField({
  label,
  display,
  mode,
  day,
  time = "12:00",
  onChange,
  note,
  testID,
  disabled = false,
}: {
  label: string;
  /** The value as the app shows it: "16 أكتوبر 2026", "07:00". */
  display: string;
  mode: "date" | "time";
  /** The business day: the value itself (date), or the day the time is on (time). */
  day: string;
  /** The wall-clock time (time mode). */
  time?: string;
  onChange: (value: string) => void;
  /** A line under the value (e.g. "ends the next day"). */
  note?: string | null;
  testID: string;
  disabled?: boolean;
}) {
  const t = useTranslations("newShift");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(mode === "date" ? day : time);
  const value = businessInstant(day, mode === "date" ? "12:00" : time);
  const fromPicker = (picked: Date) => onChange(mode === "date" ? businessDayOf(picked) : wallTimeOf(picked));

  if (Platform.OS === "web") {
    return (
      <View style={styles.box}>
        <AppText weight="semibold">{label}</AppText>
        <AppTextInput
          ltr
          testID={testID}
          accessibilityLabel={label}
          value={draft}
          editable={!disabled}
          onChangeText={(text) => {
            setDraft(text);
            if (mode === "date" ? isBusinessDay(text) : isWallTime(text)) onChange(text);
          }}
        />
        {note ? (
          <AppText size="small" weight="semibold" color={colors.warning}>
            {note}
          </AppText>
        ) : null}
      </View>
    );
  }

  function press() {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        timeZoneName: BUSINESS_TIME_ZONE,
        onValueChange: (_event, picked) => fromPicker(picked),
        positiveButton: { label: tc("confirm") },
        negativeButton: { label: tc("cancel") },
      });
      return;
    }
    setOpen((current) => !current);
  }

  return (
    <View style={styles.box}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t("fieldValue", { label, value: display })}
        accessibilityHint={t("changeHint")}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={press}
        style={({ pressed }) => [styles.field, open && styles.fieldOpen, pressed && styles.pressed, disabled && styles.disabled]}
      >
        <AppText size="small" color={colors.muted}>
          {label}
        </AppText>
        <AppText size="large" weight="semibold">
          {display}
        </AppText>
        {note ? (
          <AppText size="small" weight="semibold" color={colors.warning}>
            {note}
          </AppText>
        ) : null}
      </Pressable>
      {open ? (
        <View style={styles.picker}>
          <DateTimePicker
            testID={`${testID}-picker`}
            value={value}
            mode={mode}
            display={mode === "date" ? "inline" : "spinner"}
            timeZoneName={BUSINESS_TIME_ZONE}
            locale={IOS_PICKER_LOCALE}
            onValueChange={(_event, picked) => fromPicker(picked)}
          />
          <Button label={tc("done")} variant="secondary" onPress={() => setOpen(false)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs },
  field: {
    minHeight: TOUCH_TARGET,
    justifyContent: "center",
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
  },
  fieldOpen: { borderColor: colors.primary, borderWidth: 2 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  picker: { gap: spacing.sm, padding: spacing.sm, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
});
