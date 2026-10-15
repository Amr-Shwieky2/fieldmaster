import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { CompensationType } from "@fieldmaster/shared-types";
import { toBusinessDay } from "@fieldmaster/i18n";
import { useEnumLabel } from "../../i18n/hooks";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";
import { AppTextInput } from "../AppTextInput";
import { Button } from "../Button";
import { EffectiveDateField } from "./EffectiveDateField";
import { parseShekelsToAgorot, type ShekelsParseError } from "./shekels";

type RateType = typeof CompensationType.DAILY | typeof CompensationType.HOURLY;
const RATE_TYPES: readonly RateType[] = [CompensationType.DAILY, CompensationType.HOURLY];

/**
 * The worker's first compensation profile, exactly the fields of the API's
 * CreateCompensationProfileDto: a daily or an hourly base rate, the overtime
 * hourly rate (required for both), the effective start date and the reason
 * stored with it. Amounts are integer agorot.
 */
export type CompensationProfileInput =
  | { compensationType: typeof CompensationType.DAILY; dailyBaseRateAgorot: number; overtimeHourlyRateAgorot: number; effectiveStartDate: string; changeReason: string }
  | { compensationType: typeof CompensationType.HOURLY; baseHourlyRateAgorot: number; overtimeHourlyRateAgorot: number; effectiveStartDate: string; changeReason: string };

/** Today in Asia/Jerusalem (the admin web's approval uses the same day). */
function today(): string {
  return toBusinessDay(Date.now()) ?? new Date().toISOString().slice(0, 10);
}

function RateInput({
  testID,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  testID: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
}) {
  return (
    <View style={styles.input}>
      <AppText weight="semibold">{label}</AppText>
      <AppTextInput
        testID={testID}
        accessibilityLabel={label}
        ltr
        keyboardType="decimal-pad"
        autoComplete="off"
        autoCorrect={false}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        style={error ? styles.inputInvalid : null}
      />
      {error ? (
        <AppText testID={`${testID}-error`} accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * «اعتماد العامل»: the compensation the worker is approved with (only for a
 * member who may approve: APPROVE_ONBOARDING with MANAGE_COMPENSATION). The
 * amounts are typed in shekels and checked here with the admin web's rules
 * before anything is sent.
 */
export function ApproveWorkerForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (profile: CompensationProfileInput) => void; onCancel: () => void }) {
  const t = useTranslations("onboardingReview");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const [compensationType, setCompensationType] = useState<RateType>(CompensationType.DAILY);
  const [dailyRate, setDailyRate] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("");
  const [effectiveStartDate, setEffectiveStartDate] = useState(today);
  const [showErrors, setShowErrors] = useState(false);

  const daily = compensationType === CompensationType.DAILY;
  const base = parseShekelsToAgorot(daily ? dailyRate : hourlyRate);
  const overtime = parseShekelsToAgorot(overtimeRate);
  const errorText = (result: { ok: true } | { ok: false; error: ShekelsParseError }) => (showErrors && !result.ok ? t(`rateErrors.${result.error}`) : null);

  function submit() {
    if (busy) return;
    if (!base.ok || !overtime.ok) {
      setShowErrors(true);
      return;
    }
    // Reasons are stored as sent and shown later in the audit log, so they are sent in Arabic (as the admin web does).
    const common = { overtimeHourlyRateAgorot: overtime.agorot, effectiveStartDate, changeReason: t("changeReason") };
    onSubmit(
      daily
        ? { compensationType: CompensationType.DAILY, dailyBaseRateAgorot: base.agorot, ...common }
        : { compensationType: CompensationType.HOURLY, baseHourlyRateAgorot: base.agorot, ...common },
    );
  }

  return (
    <View style={styles.card} testID="approve-form">
      <AppText accessibilityRole="header" weight="bold" size="large">
        {t("approveTitle")}
      </AppText>
      <AppText color={colors.muted}>{t("approveHelp")}</AppText>

      <AppText weight="semibold">{t("compensationType")}</AppText>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("compensationType")} style={styles.choices}>
        {RATE_TYPES.map((type) => {
          const selected = compensationType === type;
          const text = enumLabel("CompensationType", type);
          return (
            <Pressable
              key={type}
              accessibilityRole="radio"
              accessibilityLabel={text}
              accessibilityState={{ checked: selected, selected, disabled: busy }}
              disabled={busy}
              onPress={() => setCompensationType(type)}
              style={[styles.choice, selected && styles.choiceSelected]}
            >
              <AppText weight={selected ? "semibold" : "regular"} color={selected ? colors.primaryText : colors.text} align="center">
                {text}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {daily ? (
        <RateInput testID="approve-base-rate" label={t("dailyRate")} value={dailyRate} onChange={setDailyRate} error={errorText(base)} disabled={busy} />
      ) : (
        <RateInput testID="approve-base-rate" label={t("hourlyRate")} value={hourlyRate} onChange={setHourlyRate} error={errorText(base)} disabled={busy} />
      )}
      <RateInput testID="approve-overtime-rate" label={t("overtimeRate")} value={overtimeRate} onChange={setOvertimeRate} error={errorText(overtime)} disabled={busy} />
      <AppText size="small" color={colors.muted}>
        {t("ratesHint")}
      </AppText>

      <EffectiveDateField value={effectiveStartDate} onChange={setEffectiveStartDate} disabled={busy} />

      <Button testID="approve-confirm" label={t("confirmApprove")} busy={busy} busyLabel={t("approving")} onPress={submit} />
      <Button label={tc("cancel")} variant="secondary" disabled={busy} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.primary, padding: spacing.lg, gap: spacing.md },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: {
    minHeight: TOUCH_TARGET,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    backgroundColor: colors.card,
  },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  input: { gap: spacing.xs },
  inputInvalid: { borderColor: colors.danger, borderWidth: 2 },
});
