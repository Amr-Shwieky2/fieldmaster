import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import type { FieldMasterClient, OnboardingReview } from "@fieldmaster/api-client";
import { EM_DASH } from "@fieldmaster/i18n";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { Button } from "../Button";
import { isolateAuto, isolateLtr } from "../LtrText";
import { DetailRow } from "./DetailRow";
import { IdentityDocumentImage } from "./IdentityDocumentImage";

/**
 * The application's sensitive values after «عرض البيانات الكاملة» (an
 * audited read): the ID number, the full bank account and, on a further
 * press, the ID image. Held only by the screen's state while it is open.
 */
export function RevealedDetails({ review, client, onHide }: { review: OnboardingReview; client: FieldMasterClient; onHide: () => void }) {
  const t = useTranslations("onboardingReview");
  const bank = review.bankAccount;
  return (
    <View style={styles.card} testID="onboarding-full-details">
      <AppText accessibilityRole="header" weight="bold" size="large">
        {t("fullDetailsTitle")}
      </AppText>
      <DetailRow testID="onboarding-id-number" label={t("idNumber")} value={review.governmentIdNumber ? isolateLtr(review.governmentIdNumber) : EM_DASH} />
      {bank ? (
        <>
          <DetailRow label={t("bankName")} value={isolateAuto(bank.bankName)} />
          <DetailRow label={t("branchNumber")} value={isolateLtr(bank.branchNumber)} />
          <DetailRow testID="onboarding-account-number" label={t("accountNumber")} value={isolateLtr(bank.accountNumber)} />
          <DetailRow label={t("accountHolderName")} value={isolateAuto(bank.accountHolderName)} />
        </>
      ) : (
        <AppText color={colors.muted}>{t("bankMissing")}</AppText>
      )}
      <DetailRow label={t("idDocument")}>
        {review.identityDocument ? <IdentityDocumentImage client={client} document={review.identityDocument} /> : <AppText color={colors.muted}>{t("idDocumentMissing")}</AppText>}
      </DetailRow>
      <Button testID="onboarding-hide-details" label={t("hide")} variant="secondary" onPress={onHide} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.warning, padding: spacing.lg, gap: spacing.xs },
});
