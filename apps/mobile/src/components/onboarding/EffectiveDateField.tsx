import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useTranslations } from "use-intl";
import { useFormat } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { Button } from "../Button";

const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad2 = (n: number) => String(n).padStart(2, "0");

function parts(businessDate: string): [number, number, number] {
  const match = BUSINESS_DATE.exec(businessDate);
  if (!match) throw new Error("not a business date");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * The picker works on the phone's own calendar days: a business date
 * (YYYY-MM-DD) is shown as that calendar day at noon (away from any
 * daylight-saving change) and read back from the day the person picked, so
 * the date sent never depends on the phone's time zone.
 */
export function businessDateToPickerDate(businessDate: string): Date {
  const [year, month, day] = parts(businessDate);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function pickerDateToBusinessDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** The business date `days` later (or earlier): calendar arithmetic, no time zone involved. */
export function addDays(businessDate: string, days: number): string {
  const [year, month, day] = parts(businessDate);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The date a compensation starts from (a business date). On iOS and Android
 * the system date picker opens on request; the web, where it does not exist,
 * moves a day at a time.
 */
export function EffectiveDateField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const t = useTranslations("onboardingReview");
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const native = Platform.OS === "ios" || Platform.OS === "android";

  return (
    <View style={styles.field}>
      <AppText weight="semibold">{t("effectiveDate")}</AppText>
      <AppText testID="approve-effective-date" weight="bold" size="large">
        {format.businessDate(value)}
      </AppText>
      {native ? (
        open ? null : <Button label={t("changeDate")} accessibilityHint={t("changeDateLabel")} variant="secondary" disabled={disabled} onPress={() => setOpen(true)} />
      ) : (
        <View style={styles.row}>
          <Button label={t("previousDay")} variant="secondary" disabled={disabled} onPress={() => onChange(addDays(value, -1))} style={styles.rowButton} />
          <Button label={t("nextDay")} variant="secondary" disabled={disabled} onPress={() => onChange(addDays(value, 1))} style={styles.rowButton} />
        </View>
      )}
      {native && open && !disabled ? (
        <>
          {/* Android opens its dialog while this is mounted (and closes it on a choice); iOS shows the calendar here. */}
          <DateTimePicker
            testID="approve-date-picker"
            value={businessDateToPickerDate(value)}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            accentColor={colors.primary}
            onValueChange={(_event, date) => {
              onChange(pickerDateToBusinessDate(date));
              if (Platform.OS === "android") setOpen(false);
            }}
            onDismiss={() => setOpen(false)}
          />
          {Platform.OS === "ios" ? <Button label={t("dateDone")} variant="secondary" onPress={() => setOpen(false)} /> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  row: { flexDirection: "row", gap: spacing.sm },
  rowButton: { flex: 1 },
});
