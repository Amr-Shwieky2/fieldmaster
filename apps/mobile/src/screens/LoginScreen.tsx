import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { DevLoginUser } from "@fieldmaster/api-client";
import { getErrorCode, isNetworkError, isNotFound } from "@fieldmaster/i18n";
import { OrgRole } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { AppTextInput } from "../components/AppTextInput";
import { Button } from "../components/Button";
import { LtrText } from "../components/LtrText";
import { useEnumLabel, useErrorMessage } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { getDeviceId } from "../lib/device-id";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";

type Step = "phone" | "code";

interface OrgOption {
  organizationId: string;
  role: string;
  /** Not sent by the API yet; shown as the card's main line once it is. */
  organizationName?: string;
}

/**
 * Why the last attempt failed, translated while rendering (the API's English
 * message is never shown): the thrown error, an empty field, or an
 * organization choice the app could not read.
 */
type Failure = { cause: unknown } | { missing: "phoneRequired" | "codeRequired" } | { unexpected: true };

const ROLE_GROUPS: { role: OrgRole; titleKey: "groupOwners" | "groupFieldManagers" | "groupWorkers" }[] = [
  { role: OrgRole.OWNER, titleKey: "groupOwners" },
  { role: OrgRole.FIELD_MANAGER, titleKey: "groupFieldManagers" },
  { role: OrgRole.WORKER, titleKey: "groupWorkers" },
];

/** The fixed verification code the API accepts while dev login (test) mode is on. */
const DEV_FIXED_CODE = "123456";

/** On the organization step these mean the code can no longer be used: the worker goes back to the code step. */
const CODE_UNUSABLE = new Set(["OTP_INVALID_OR_EXPIRED", "OTP_MAX_ATTEMPTS_EXCEEDED"]);

function currentPlatform(): "IOS" | "ANDROID" | "WEB" {
  return Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB";
}

/** The organizations listed in an ORGANIZATION_SELECTION_REQUIRED error; malformed entries are dropped. */
function organizationsFrom(error: unknown): OrgOption[] {
  const details = (error as { body?: { details?: { organizations?: unknown } | null } } | null)?.body?.details;
  const list = details?.organizations;
  if (!Array.isArray(list)) return [];
  const options: OrgOption[] = [];
  for (const entry of list as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { organizationId, role, organizationName } = entry as Record<string, unknown>;
    if (typeof organizationId !== "string" || organizationId === "" || typeof role !== "string") continue;
    options.push({ organizationId, role, organizationName: typeof organizationName === "string" && organizationName !== "" ? organizationName : undefined });
  }
  return options;
}

export function LoginScreen() {
  const { client, login } = useAuth();
  const { isOnline } = useOfflineSync();
  const t = useTranslations("auth");
  const tApp = useTranslations("app");
  const tDev = useTranslations("devLogin");
  const tErrors = useTranslations("errors");
  const tConnection = useTranslations("connection");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<OrgOption[] | null>(null);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  // Non-null only while the API runs in dev login (test) mode -- it answers
  // 404 otherwise and every test option stays hidden.
  const [devUsers, setDevUsers] = useState<DevLoginUser[] | null>(null);
  const [quickLoginId, setQuickLoginId] = useState<string | null>(null);
  const [quickLoginFailure, setQuickLoginFailure] = useState<{ cause: unknown } | null>(null);
  const devMode = devUsers !== null;

  function failureMessage(f: Failure): string {
    if ("missing" in f) return t(f.missing);
    if ("unexpected" in f) return tErrors("unknown");
    // verifyOtp answers 404 when no active account uses this number (often a
    // local "05..." number): say so instead of the generic "item not found".
    if (step === "code" && isNotFound(f.cause)) return t("noAccount");
    return errorMessage(f.cause);
  }

  const error = failure ? failureMessage(failure) : null;
  // "Is the API running?" only when it really could not be reached; anything else gets its own Arabic message.
  const quickLoginError = quickLoginFailure ? (isNetworkError(quickLoginFailure.cause) ? tDev("failed") : errorMessage(quickLoginFailure.cause)) : null;

  useEffect(() => {
    let cancelled = false;
    client
      .listDevLoginUsers()
      .then((users) => {
        if (!cancelled) setDevUsers(users);
      })
      .catch(() => {
        // API unreachable: the normal phone form surfaces connection errors.
        if (!cancelled) setDevUsers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function handleQuickLogin(user: DevLoginUser) {
    setQuickLoginFailure(null);
    setQuickLoginId(user.membershipId);
    try {
      const deviceId = await getDeviceId();
      const session = await client.devLogin({ membershipId: user.membershipId, deviceId, platform: currentPlatform() });
      await login(session);
    } catch (err) {
      setQuickLoginFailure({ cause: err });
      setQuickLoginId(null);
    }
  }

  async function handleRequestOtp() {
    if (submitting) return;
    if (phoneNumber.trim() === "") {
      setFailure({ missing: "phoneRequired" });
      return;
    }
    setFailure(null);
    setSubmitting(true);
    try {
      await client.requestOtp(phoneNumber.trim());
      setStep("code");
    } catch (err) {
      setFailure({ cause: err });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(organizationId?: string) {
    if (submitting) return;
    if (code.trim() === "") {
      setFailure({ missing: "codeRequired" });
      return;
    }
    setFailure(null);
    setSubmitting(true);
    setSelectedOrganizationId(organizationId ?? null);
    try {
      const deviceId = await getDeviceId();
      const session = await client.verifyOtp({
        phoneNumber: phoneNumber.trim(),
        code: code.trim(),
        deviceId,
        platform: currentPlatform(),
        organizationId,
      });
      await login(session);
    } catch (err) {
      const errorCode = getErrorCode(err);
      if (errorCode === "ORGANIZATION_SELECTION_REQUIRED") {
        const options = organizationsFrom(err);
        if (options.length > 0) {
          setOrganizations(options);
        } else {
          // Nothing to choose from: stay on the code step instead of an empty list.
          setFailure({ unexpected: true });
        }
        return;
      }
      if (organizationId !== undefined && errorCode !== null && CODE_UNUSABLE.has(errorCode)) {
        // The code is used up or expired: back to the code step, where the worker can act.
        setOrganizations(null);
        setCode("");
      }
      setFailure({ cause: err });
    } finally {
      setSubmitting(false);
      setSelectedOrganizationId(null);
    }
  }

  function changePhoneNumber(value: string) {
    setPhoneNumber(value);
    if (failure && "missing" in failure) setFailure(null);
  }

  function changeCode(value: string) {
    setCode(value);
    if (failure && "missing" in failure) setFailure(null);
  }

  function backToPhoneStep() {
    setStep("phone");
    setCode("");
    setOrganizations(null);
    setFailure(null);
  }

  // Press handlers return nothing: the async work reports its own result through state.
  const sendCode = () => {
    void handleRequestOtp();
  };
  const verify = (organizationId?: string) => {
    void handleVerify(organizationId);
  };

  const errorBox = error ? <ErrorMessage message={error} /> : null;
  // The input carries the same label for screen readers, so the visible one is not read twice
  // (aria-hidden: accessibilityElementsHidden on iOS, importantForAccessibility "no-hide-descendants" on Android).
  const visualOnly = { "aria-hidden": true } as const;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {devMode && (
            <View style={styles.notice} accessible accessibilityRole="alert">
              <AppText weight="bold" color={colors.warning}>
                {tDev("bannerTitle")}
              </AppText>
              <AppText size="small" color={colors.text}>
                {tDev("bannerBody")}
              </AppText>
            </View>
          )}

          <View style={styles.header}>
            <AppText accessibilityRole="header" weight="bold" size="hero" align="center">
              {tApp("brand")}
            </AppText>
            <AppText size="large" color={colors.muted} align="center">
              {t("subtitle")}
            </AppText>
          </View>

          {!isOnline && (
            <View style={styles.notice} accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
              <AppText weight="bold" color={colors.warning}>
                {tConnection("offline")}
              </AppText>
              <AppText color={colors.text}>{t("offlineHint")}</AppText>
            </View>
          )}

          {step === "phone" && (
            <View style={styles.form}>
              <View style={styles.field}>
                <AppText weight="semibold" {...visualOnly}>
                  {t("phoneLabel")}
                </AppText>
                <AppTextInput
                  ltr
                  accessibilityLabel={t("phoneLabel")}
                  placeholder={t("phonePlaceholder")}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="send"
                  value={phoneNumber}
                  onChangeText={changePhoneNumber}
                  onSubmitEditing={sendCode}
                  editable={!submitting}
                />
              </View>
              {errorBox}
              <Button label={t("sendCode")} busy={submitting} busyLabel={t("sending")} onPress={sendCode} />
            </View>
          )}

          {step === "code" && !organizations && (
            <View style={styles.form}>
              <AppText color={colors.muted}>
                {t.rich("codeSentTo", {
                  phone: () => (
                    <LtrText weight="semibold" color={colors.text}>
                      {phoneNumber.trim()}
                    </LtrText>
                  ),
                })}
              </AppText>
              <View style={styles.field}>
                <AppText weight="semibold" {...visualOnly}>
                  {t("codeLabel")}
                </AppText>
                <AppTextInput
                  ltr
                  accessibilityLabel={t("codeLabel")}
                  keyboardType="number-pad"
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  autoCorrect={false}
                  returnKeyType="done"
                  value={code}
                  onChangeText={changeCode}
                  onSubmitEditing={() => verify()}
                  editable={!submitting}
                />
                {devMode && (
                  <AppText size="small" color={colors.warning}>
                    {t.rich("testModeCodeHint", {
                      code: () => (
                        <LtrText size="small" weight="bold" color={colors.warning}>
                          {DEV_FIXED_CODE}
                        </LtrText>
                      ),
                    })}
                  </AppText>
                )}
              </View>
              {errorBox}
              <Button label={t("verify")} busy={submitting} busyLabel={t("verifying")} onPress={() => verify()} />
              <Button label={t("useDifferentNumber")} variant="secondary" disabled={submitting} onPress={backToPhoneStep} />
            </View>
          )}

          {organizations && (
            <View style={styles.form}>
              <AppText>{t("chooseOrganization")}</AppText>
              {organizations.map((org) => {
                const selected = selectedOrganizationId === org.organizationId;
                const roleLabel = enumLabel("OrgRole", org.role);
                return (
                  <Pressable
                    key={org.organizationId}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: submitting, busy: selected }}
                    disabled={submitting}
                    onPress={() => verify(org.organizationId)}
                    style={({ pressed }) => [styles.option, submitting && !selected && styles.optionDisabled, pressed && styles.optionPressed]}
                  >
                    <View style={styles.optionRow}>
                      {selected ? <ActivityIndicator color={colors.primary} /> : null}
                      <AppText weight="semibold" size="large">
                        {selected ? t("verifying") : (org.organizationName ?? roleLabel)}
                      </AppText>
                    </View>
                    {org.organizationName ? (
                      <AppText color={colors.muted}>{roleLabel}</AppText>
                    ) : (
                      <LtrText size="small" color={colors.muted}>
                        {org.organizationId}
                      </LtrText>
                    )}
                  </Pressable>
                );
              })}
              {errorBox}
              <Button label={t("useDifferentNumber")} variant="secondary" disabled={submitting} onPress={backToPhoneStep} />
            </View>
          )}

          {devMode && devUsers && (
            <DevQuickLogin
              users={devUsers}
              pendingId={quickLoginId}
              error={quickLoginError}
              onSelect={(user) => {
                void handleQuickLogin(user);
              }}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Test mode only: one tap signs in as a seeded user, grouped by role. */
function DevQuickLogin({
  users,
  pendingId,
  error,
  onSelect,
}: {
  users: DevLoginUser[];
  pendingId: string | null;
  error: string | null;
  onSelect: (user: DevLoginUser) => void;
}) {
  const tDev = useTranslations("devLogin");
  const enumLabel = useEnumLabel();
  const showOrganization = new Set(users.map((u) => u.organizationId)).size > 1;

  return (
    <View style={styles.quickLogin}>
      <AppText accessibilityRole="header" weight="bold" size="title">
        {tDev("quickLoginTitle")}
      </AppText>
      <AppText color={colors.muted}>{tDev("quickLoginDescription")}</AppText>
      {users.length === 0 && <AppText color={colors.muted}>{tDev("noUsers")}</AppText>}
      {ROLE_GROUPS.map(({ role, titleKey }) => {
        const group = users.filter((u) => u.role === role);
        if (group.length === 0) return null;
        return (
          <View key={role} style={styles.group}>
            <AppText accessibilityRole="header" weight="bold" color={colors.muted}>
              {`${tDev(titleKey)} ${tDev("groupCount", { count: group.length })}`}
            </AppText>
            {group.map((user) => {
              const pending = pendingId === user.membershipId;
              const disabled = pendingId !== null;
              return (
                <Pressable
                  key={user.membershipId}
                  accessibilityRole="button"
                  accessibilityLabel={tDev("signInAs", { name: user.fullLegalName, role: enumLabel("OrgRole", user.role) })}
                  accessibilityState={{ disabled, busy: pending }}
                  disabled={disabled}
                  onPress={() => onSelect(user)}
                  style={({ pressed }) => [styles.option, disabled && !pending && styles.optionDisabled, pressed && styles.optionPressed]}
                >
                  <View style={styles.optionRow}>
                    {pending ? <ActivityIndicator color={colors.primary} /> : null}
                    <AppText weight="semibold" size="large">
                      {pending ? tDev("signingIn") : user.fullLegalName}
                    </AppText>
                  </View>
                  <LtrText color={colors.muted}>{user.phoneNumber}</LtrText>
                  {showOrganization && (
                    <AppText size="small" color={colors.muted}>
                      {user.organizationName}
                    </AppText>
                  )}
                </Pressable>
              );
            })}
          </View>
        );
      })}
      {error && <ErrorMessage message={error} />}
    </View>
  );
}

/** An error or validation message, announced to screen readers. */
function ErrorMessage({ message }: { message: string }) {
  return (
    <View style={styles.errorBox} accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
      <AppText weight="semibold" color={colors.danger}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  header: { gap: spacing.xs, marginBottom: spacing.md },
  form: { gap: spacing.md },
  field: { gap: spacing.xs },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: 12, padding: spacing.md },
  notice: { backgroundColor: colors.warningSoft, borderColor: colors.warning, borderWidth: 1, borderRadius: 14, padding: spacing.md, gap: spacing.xs },
  quickLogin: { marginTop: spacing.xl, gap: spacing.sm },
  group: { gap: spacing.sm, marginTop: spacing.md },
  option: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    justifyContent: "center",
    gap: 2,
  },
  optionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  optionDisabled: { opacity: 0.5 },
  optionPressed: { opacity: 0.85 },
});
