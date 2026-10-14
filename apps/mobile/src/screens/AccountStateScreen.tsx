import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { useFormat } from "../i18n/hooks";
import type { AccountStateKind } from "../lib/account-state";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";

/** The API's Arabic message for each state (shared @fieldmaster/i18n errors). */
const MESSAGE_CODE: Record<AccountStateKind, "ACCOUNT_PENDING_APPROVAL" | "ACCOUNT_REJECTED" | "ACCOUNT_SUSPENDED" | "DEVICE_KEY_REVOKED"> = {
  PENDING_APPROVAL: "ACCOUNT_PENDING_APPROVAL",
  REJECTED: "ACCOUNT_REJECTED",
  SUSPENDED: "ACCOUNT_SUSPENDED",
  DEVICE_KEY_REVOKED: "DEVICE_KEY_REVOKED",
};

const TONE: Record<AccountStateKind, { color: string; background: string }> = {
  PENDING_APPROVAL: { color: colors.warning, background: colors.warningSoft },
  REJECTED: { color: colors.danger, background: colors.dangerSoft },
  SUSPENDED: { color: colors.danger, background: colors.dangerSoft },
  DEVICE_KEY_REVOKED: { color: colors.warning, background: colors.warningSoft },
};

/**
 * The only screen while the account cannot use the app: the application is
 * pending approval or was rejected, the account is suspended, or an Owner
 * revoked this phone's key. No other screen is mounted (RootNavigator). The
 * session is already cleared; the one action goes back to the sign-in screen.
 */
export function AccountStateScreen() {
  const t = useTranslations("account");
  const tErrors = useTranslations("errors");
  const tc = useTranslations("common");
  const tApp = useTranslations("app");
  const format = useFormat();
  const { accountState, dismissAccountState } = useAuth();
  const kind: AccountStateKind = accountState?.kind ?? "SUSPENDED";
  const tone = TONE[kind];
  const dropped = kind === "DEVICE_KEY_REVOKED" ? (accountState?.droppedEvents ?? 0) : 0;

  const actionLabel = kind === "SUSPENDED" ? tc("signOut") : kind === "DEVICE_KEY_REVOKED" ? t("signInAgain") : t("backToLogin");

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <AppText weight="bold" size="hero" align="center">
          {tApp("brand")}
        </AppText>
        <View style={[styles.card, { backgroundColor: tone.background, borderColor: tone.color }]} accessible accessibilityRole="alert">
          <AppText accessibilityRole="header" weight="bold" size="title" color={tone.color}>
            {t(`title.${kind}`)}
          </AppText>
          <AppText size="large">{tErrors(MESSAGE_CODE[kind])}</AppText>
          <AppText color={colors.muted}>{t(`hint.${kind}`)}</AppText>
          {dropped > 0 ? (
            <AppText weight="semibold" color={colors.danger}>
              {t("droppedEvents", { count: format.number(dropped) })}
            </AppText>
          ) : null}
        </View>
        <Button label={actionLabel} onPress={dismissAccountState} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  card: { borderWidth: 1, borderRadius: 16, padding: spacing.lg, gap: spacing.sm },
});
