import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useTranslations } from "use-intl";
import { BUSINESS_TIME_ZONE, formatTime, israelOffsetMinutes, toBusinessDay } from "@fieldmaster/i18n";
import { useFormat } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { AppTextInput } from "../AppTextInput";
import { Button } from "../Button";

/** The iOS picker's language: Arabic with Western digits (the app never shows Arabic-Indic digits). */
const IOS_PICKER_LOCALE = "ar@numbers=latn";

/** A time is entered to the minute (like the admin web's date/time input). */
export function toMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

/** `2026-10-15 17:30`: an instant as Asia/Jerusalem wall-clock text (the web fallback's input). */
export function toJerusalemText(date: Date): string {
  return `${toBusinessDay(date) ?? ""} ${formatTime(date)}`;
}

/**
 * The instant of a `YYYY-MM-DD HH:mm` Asia/Jerusalem wall-clock text, or null
 * when it is malformed (the admin web's rule for its date/time input). A time
 * skipped by the spring DST change resolves to the standard-time reading.
 */
export function fromJerusalemText(value: string): Date | null {
  const match = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})\s*$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (hour > 23 || minute > 59) return null;
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wallClockAsUtc);
  // Date.UTC rolls 2026-02-30 over to March: not a real day.
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  for (const offset of [180, 120]) {
    const candidate = new Date(wallClockAsUtc - offset * 60_000);
    if (israelOffsetMinutes(candidate) === offset) return candidate;
  }
  return new Date(wallClockAsUtc - 120 * 60_000);
}

/**
 * A date and time entered in Asia/Jerusalem (the business time zone), whatever
 * the phone's own zone: the native pickers get `timeZoneName`, so the instant
 * they answer is the wall-clock time the manager chose in Jerusalem. The
 * chosen time is also shown as Arabic text. iOS: compact date and time
 * pickers; Android: buttons opening the system dialogs; web (checks only, no
 * native picker there): a `YYYY-MM-DD HH:mm` field read as Jerusalem time.
 */
export function JerusalemDateTimeField({
  label,
  value,
  onChange,
  error,
  disabled = false,
  testID = "correction-time",
}: {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  error?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTranslations("review.correction");
  const format = useFormat();

  if (Platform.OS === "web") {
    return <WebDateTimeField label={label} value={value} onChange={onChange} error={error} disabled={disabled} testID={testID} />;
  }

  const current = value ?? toMinute(new Date());
  const pick = (date: Date | undefined) => {
    if (date && !Number.isNaN(date.getTime())) onChange(toMinute(date));
  };
  const openAndroidPicker = (mode: "date" | "time") =>
    DateTimePickerAndroid.open({ value: current, mode, is24Hour: true, timeZoneName: BUSINESS_TIME_ZONE, onValueChange: (_event, date) => pick(date) });

  return (
    <View style={styles.field}>
      <AppText weight="semibold">{label}</AppText>
      <AppText size="large" weight="bold" testID={`${testID}-value`}>
        {format.dateTime(value)}
      </AppText>
      {Platform.OS === "ios" ? (
        <View style={styles.row}>
          <DateTimePicker
            testID={`${testID}-date`}
            accessibilityLabel={t("changeDate")}
            value={current}
            mode="date"
            display="compact"
            locale={IOS_PICKER_LOCALE}
            timeZoneName={BUSINESS_TIME_ZONE}
            disabled={disabled}
            onValueChange={(_event, date) => pick(date)}
          />
          <DateTimePicker
            testID={`${testID}-time`}
            accessibilityLabel={t("changeTime")}
            value={current}
            mode="time"
            display="compact"
            locale={IOS_PICKER_LOCALE}
            timeZoneName={BUSINESS_TIME_ZONE}
            disabled={disabled}
            onValueChange={(_event, date) => pick(date)}
          />
        </View>
      ) : (
        <View style={styles.buttons}>
          <Button label={t("changeDate")} variant="secondary" disabled={disabled} onPress={() => openAndroidPicker("date")} />
          <Button label={t("changeTime")} variant="secondary" disabled={disabled} onPress={() => openAndroidPicker("time")} />
        </View>
      )}
      {error ? (
        <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

function WebDateTimeField({
  label,
  value,
  onChange,
  error,
  disabled,
  testID,
}: {
  label: string;
  value: Date | null;
  onChange: (value: Date | null) => void;
  error?: string;
  disabled: boolean;
  testID: string;
}) {
  const t = useTranslations("review.correction");
  const format = useFormat();
  // Remounted by the form when the correction type changes, so the text starts from the new time.
  const [text, setText] = useState(() => (value ? toJerusalemText(value) : ""));
  return (
    <View style={styles.field}>
      <AppText weight="semibold">{label}</AppText>
      <AppTextInput
        testID={`${testID}-input`}
        ltr
        value={text}
        editable={!disabled}
        accessibilityLabel={t("timeInput")}
        accessibilityHint={t("timeInputHint")}
        onChangeText={(next) => {
          setText(next);
          onChange(fromJerusalemText(next));
        }}
      />
      <AppText size="small" color={colors.muted}>
        {t("timeInputHint")}
      </AppText>
      {value ? <AppText weight="semibold">{format.dateTime(value)}</AppText> : null}
      {error ? (
        <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  buttons: { gap: spacing.sm },
});
