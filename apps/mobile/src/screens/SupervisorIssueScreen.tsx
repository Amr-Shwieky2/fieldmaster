import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { ApiRequestError, type SupervisorIssue } from "@fieldmaster/api-client";
import { isNotFound } from "@fieldmaster/i18n";
import { Permission } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { AppTextInput } from "../components/AppTextInput";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "SupervisorIssue">;

type ResolveState = { status: "idle" | "saving" | "missing" } | { status: "failed"; cause: unknown };

/** 409: the report changed meanwhile (another manager resolved it). */
const isConflict = (cause: unknown) => cause instanceof ApiRequestError && cause.status === 409;

/**
 * A temporary supervisor's report about their shift (mobile manager mode,
 * VIEW_OPERATIONS): what they wrote and when, the shift, and «اتصل بالمشرف».
 * Once resolved it says who resolved it, when, and their note; until then
 * «تم الحل» with a required note settles it (the API audits it and tells the
 * supervisor).
 */
export function SupervisorIssueScreen({ navigation, route }: Props) {
  const { issueId } = route.params;
  const t = useTranslations("supervisorIssue");
  const tStates = useTranslations("states");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const { can } = useAccess();
  const allowed = can(Permission.VIEW_OPERATIONS);

  const [issue, setIssue] = useState<SupervisorIssue | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState("");
  const [resolveState, setResolveState] = useState<ResolveState>({ status: "idle" });
  const [callFailed, setCallFailed] = useState(false);
  const resolving = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setIssue(await client.getSupervisorIssue(issueId));
      setNotFound(false);
    } catch (cause) {
      if (isNotFound(cause)) {
        setNotFound(true);
        setIssue(null);
      } else {
        setError(cause ?? new Error());
      }
    } finally {
      setRefreshing(false);
    }
  }, [client, issueId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  async function resolve() {
    if (!issue || resolving.current) return;
    const text = note.trim();
    if (text === "") {
      setResolveState({ status: "missing" });
      return;
    }
    resolving.current = true;
    setResolveState({ status: "saving" });
    try {
      setIssue(await client.resolveSupervisorIssue(issueId, text));
      setResolveState({ status: "idle" });
      navigation.goBack();
    } catch (cause) {
      setResolveState({ status: "failed", cause });
      // Resolved by someone else meanwhile: show who did.
      if (isConflict(cause)) void load();
    } finally {
      resolving.current = false;
    }
  }

  async function callSupervisor(phoneNumber: string) {
    setCallFailed(false);
    try {
      await Linking.openURL(`tel:${phoneNumber.replace(/\s+/g, "")}`);
    } catch {
      setCallFailed(true);
    }
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;

  if (!allowed) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <View style={styles.content}>
          <View style={[styles.card, styles.warningCard]} accessible accessibilityRole="alert">
            <AppText weight="bold" size="large" color={colors.warning}>
              {tStates("accessDeniedTitle")}
            </AppText>
            <AppText>{tStates("accessDeniedDescription")}</AppText>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!issue && !error && !notFound) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <LoadingView />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />
      <ScrollView
        testID="supervisor-issue"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRefresh} /> : null}
        {notFound ? <EmptyView title={t("notFound")} /> : null}

        {issue ? (
          <>
            <View style={styles.card}>
              <AppText accessibilityRole="header" weight="bold" size="large">
                {t("report")}
              </AppText>
              <AppText size="large">{isolateAuto(issue.text)}</AppText>
              <AppText color={colors.muted}>{t("reportedAt", { time: format.dateTime(issue.reportedAt) })}</AppText>
            </View>

            <View style={styles.card}>
              <AppText accessibilityRole="header" weight="bold" size="large">
                {t("shift")}
              </AppText>
              <AppText weight="semibold">{isolateAuto(shiftTitle(issue.shift))}</AppText>
              {issue.shift.siteName ? <AppText>{t("site", { name: isolateAuto(issue.shift.siteName) })}</AppText> : null}
              <AppText>{t("shiftTimes", { start: format.dateTime(issue.shift.scheduledStart), end: format.dateTime(issue.shift.scheduledEnd) })}</AppText>
            </View>

            <View style={styles.card}>
              <AppText accessibilityRole="header" weight="bold" size="large">
                {t("supervisor")}
              </AppText>
              <AppText weight="semibold">{isolateAuto(issue.supervisor.fullLegalName)}</AppText>
              <Button label={t("call")} accessibilityHint={t("callHint")} variant="secondary" onPress={() => void callSupervisor(issue.supervisor.phoneNumber)} />
              {callFailed ? (
                <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                  {t("callFailed", { phone: isolateLtr(issue.supervisor.phoneNumber) })}
                </AppText>
              ) : null}
            </View>

            {issue.resolved ? (
              <View style={[styles.card, styles.resolvedCard]} testID="supervisor-issue-resolved">
                <AppText weight="bold" color={colors.success}>
                  {t("resolvedBy", { name: isolateAuto(issue.resolved.by.fullLegalName), time: format.dateTime(issue.resolved.at) })}
                </AppText>
                <AppText>{t("resolvedNote", { note: isolateAuto(issue.resolved.note) })}</AppText>
              </View>
            ) : (
              <View style={styles.card}>
                <AppText accessibilityRole="header" weight="bold" size="large">
                  {t("resolveTitle")}
                </AppText>
                <AppText color={colors.muted}>{t("resolveHint")}</AppText>
                <AppTextInput
                  multiline
                  accessibilityLabel={t("noteLabel")}
                  placeholder={t("notePlaceholder")}
                  value={note}
                  onChangeText={(value) => {
                    setNote(value);
                    if (resolveState.status === "missing") setResolveState({ status: "idle" });
                  }}
                  editable={resolveState.status !== "saving"}
                />
                <Button label={t("resolve")} busy={resolveState.status === "saving"} busyLabel={t("resolving")} onPress={() => void resolve()} />
                {resolveState.status === "missing" ? (
                  <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                    {t("noteRequired")}
                  </AppText>
                ) : null}
                {resolveState.status === "failed" ? (
                  <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                    {errorMessage(resolveState.cause)}
                  </AppText>
                ) : null}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  warningCard: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  resolvedCard: { backgroundColor: colors.successSoft, borderColor: colors.success },
});
