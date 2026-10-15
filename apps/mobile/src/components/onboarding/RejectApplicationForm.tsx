import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { AppTextInput } from "../AppTextInput";
import { Button } from "../Button";

/**
 * «رفض الطلب» with its reason. The reason is stored with the decision and
 * shown to people later, so an empty or blank one is refused here, before
 * any request; `onSubmit` gets it trimmed.
 */
export function RejectApplicationForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const t = useTranslations("onboardingReview");
  const tc = useTranslations("common");
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);

  function submit() {
    if (busy) return;
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setMissing(true);
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <View style={styles.card} testID="reject-form">
      <AppText accessibilityRole="header" weight="bold" size="large">
        {t("rejectTitle")}
      </AppText>
      <AppText weight="semibold">{t("rejectReasonLabel")}</AppText>
      <AppTextInput
        testID="reject-reason"
        accessibilityLabel={t("rejectReasonLabel")}
        accessibilityHint={t("rejectReasonHint")}
        multiline
        numberOfLines={3}
        placeholder={t("rejectReasonPlaceholder")}
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          if (missing && text.trim().length > 0) setMissing(false);
        }}
        editable={!busy}
        style={missing ? styles.inputInvalid : null}
      />
      <AppText size="small" color={colors.muted}>
        {t("rejectReasonHint")}
      </AppText>
      {missing ? (
        <AppText testID="reject-reason-error" accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {t("rejectReasonRequired")}
        </AppText>
      ) : null}
      <Button testID="reject-confirm" label={t("confirmReject")} variant="danger" busy={busy} busyLabel={t("rejecting")} onPress={submit} />
      <Button label={tc("cancel")} variant="secondary" disabled={busy} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.danger, padding: spacing.lg, gap: spacing.md },
  inputInvalid: { borderColor: colors.danger, borderWidth: 2 },
});
