import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppState, Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { NotificationSubject, OnboardingReview, OnboardingSummary } from "@fieldmaster/api-client";
import { AccountStatus } from "@fieldmaster/shared-types";
import { getErrorCode, isNotFound } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView, LoadingView } from "../components/StateViews";
import { ApproveWorkerForm, type CompensationProfileInput } from "../components/onboarding/ApproveWorkerForm";
import { DetailRow } from "../components/onboarding/DetailRow";
import { HandledBanner } from "../components/onboarding/HandledBanner";
import { RejectApplicationForm } from "../components/onboarding/RejectApplicationForm";
import { RevealedDetails } from "../components/onboarding/RevealedDetails";
import { useEnumLabel, useErrorMessage, useFormat } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "OnboardingReview">;

type Action = "approve" | "reject";

const STATUS_COLORS: Record<string, string> = {
  PENDING_APPROVAL: colors.warning,
  ACTIVE: colors.success,
  REJECTED: colors.danger,
};

/** The decisions a notification subject can record about an application. */
const DECIDED_OUTCOMES = new Set(["WORKER_APPROVED", "WORKER_REJECTED"]);

/** A secondary call's answer, or null when it failed (the banner is then left out). */
async function settle<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}

function Section({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={styles.card} testID={testID}>
      <AppText accessibilityRole="header" weight="bold" size="large">
        {title}
      </AppText>
      {children}
    </View>
  );
}

/**
 * One join application (APPROVE_ONBOARDING), from
 * `GET /workers/:id/onboarding-summary`: never a decrypted value. What the
 * member may do comes from the summary itself (decided by the API from their
 * permissions):
 * - `canRevealDetails` (VIEW_BANK_INFO): «عرض البيانات الكاملة» reads the
 *   ID number and the full bank account (an audited read), and only then
 *   «عرض صورة الهوية» asks for the image's signed URL (audited too). Both
 *   happen on a press only, stay in this screen's state, and are dropped
 *   when it loses focus or closes.
 * - `canApprove` (with MANAGE_COMPENSATION, a money permission): the
 *   compensation form, the only place with amounts (₪).
 * - `canReject`: rejection with a required reason.
 * Opened from a notification (`subjectId`), it shows who already settled it.
 */
export function OnboardingReviewScreen({ navigation, route }: Props) {
  const t = useTranslations("onboardingReview");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { workerProfileId, subjectId } = route.params;

  const [summary, setSummary] = useState<OnboardingSummary | null>(null);
  const [subject, setSubject] = useState<NotificationSubject | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [callFailed, setCallFailed] = useState(false);

  // Sensitive values: component state only (never stored), dropped on blur and unmount.
  const [review, setReview] = useState<OnboardingReview | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<unknown>(null);
  const sensitiveGeneration = useRef(0);
  const revealInFlight = useRef(false);

  const [open, setOpen] = useState<Action | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<{ action: Action; cause: unknown } | null>(null);
  const [done, setDone] = useState<Action | null>(null);
  const sendingRef = useRef(false);
  const latestLoad = useRef(0);

  /** Forgets every sensitive value (and drops an answer still on its way). */
  const forgetSensitive = useCallback(() => {
    sensitiveGeneration.current += 1;
    revealInFlight.current = false;
    setReview(null);
    setRevealing(false);
    setRevealError(null);
  }, []);

  // Leaving the screen (another screen on top, back, a tab change) or closing it drops the details and the image.
  useFocusEffect(useCallback(() => forgetSensitive, [forgetSensitive]));
  // So does the app leaving the foreground: the app switcher keeps a picture of the screen on the device (a call
  // from «اتصال» leaves too; seeing them again afterwards is a new, audited read).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") forgetSensitive();
    });
    return () => subscription.remove();
  }, [forgetSensitive]);

  const load = useCallback(async () => {
    const call = ++latestLoad.current;
    setLoadError(null);
    const subjectCall = subjectId ? settle(() => client.getNotificationSubject(subjectId)) : Promise.resolve(null);
    try {
      const next = await client.getOnboardingSummary(workerProfileId);
      if (call !== latestLoad.current) return;
      setSummary(next);
      if (!next.canRevealDetails) forgetSensitive();
    } catch (cause) {
      if (call !== latestLoad.current) return;
      setLoadError(cause ?? new Error());
    } finally {
      if (call === latestLoad.current) setRefreshing(false);
    }
    const nextSubject = await subjectCall;
    if (call === latestLoad.current) setSubject(nextSubject);
  }, [client, forgetSensitive, subjectId, workerProfileId]);

  useEffect(() => {
    void load();
  }, [load]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  function onRetry() {
    if (summary) setRefreshing(true);
    void load();
  }

  async function reveal() {
    if (revealInFlight.current) return;
    revealInFlight.current = true;
    const generation = sensitiveGeneration.current;
    setRevealing(true);
    setRevealError(null);
    try {
      const answer = await client.getOnboardingReview(workerProfileId);
      if (generation !== sensitiveGeneration.current) return;
      setReview(answer);
    } catch (cause) {
      if (generation !== sensitiveGeneration.current) return;
      setRevealError(cause ?? new Error());
    } finally {
      if (generation === sensitiveGeneration.current) {
        revealInFlight.current = false;
        setRevealing(false);
      }
    }
  }

  async function dial(phoneNumber: string) {
    setCallFailed(false);
    try {
      await Linking.openURL(`tel:${phoneNumber}`);
    } catch {
      setCallFailed(true);
    }
  }

  async function decide(action: Action, send: () => Promise<unknown>) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setFailure(null);
    try {
      await send();
      // The decision is made: nothing sensitive stays on screen.
      forgetSensitive();
      setOpen(null);
      setDone(action);
    } catch (cause) {
      setFailure({ action, cause: cause ?? new Error() });
      // Decided meanwhile (by another manager): read it again to show who and how.
      if (getErrorCode(cause) === "CONFLICT") void load();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  const approve = (profile: CompensationProfileInput) => decide("approve", () => client.approveWorker(workerProfileId, profile));
  const reject = (reason: string) => decide("reject", () => client.rejectWorker(workerProfileId, reason));

  const header = <ScreenHeader title={t("title")} onBack={sending ? undefined : () => navigation.goBack()} />;
  const banner = <ConnectionBanner disabled={sending} onPress={() => navigation.navigate("OfflineQueue")} />;

  // ── After a decision: the confirmation, then back ────────────────────────────
  if (done) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <View style={[styles.card, styles.doneCard]} testID="onboarding-decided" accessibilityRole="alert">
          <AppText weight="bold" size="large" color={done === "approve" ? colors.success : colors.danger}>
            {done === "approve" ? t("approved") : t("rejected")}
          </AppText>
          <Button testID="onboarding-back" label={t("backToList")} onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading / error ─────────────────────────────────────────────────────────
  if (!summary) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        {loadError ? (
          isNotFound(loadError) ? (
            <ErrorView message={t("notFound")} />
          ) : (
            <ErrorView message={`${t("loadError")}\n${errorMessage(loadError)}`} onRetry={onRetry} />
          )
        ) : (
          <LoadingView />
        )}
      </SafeAreaView>
    );
  }

  const handled = subject?.handled ?? null;
  // Already decided (by status, or by the shared subject when the status has not caught up yet): no actions.
  const decidedByStatus = summary.membershipStatus !== AccountStatus.PENDING_APPROVAL;
  const pending = !decidedByStatus && !(handled && DECIDED_OUTCOMES.has(handled.outcome));
  const bank = summary.bankAccount;
  const failureText = failure ? `${failure.action === "approve" ? t("approveFailed") : t("rejectFailed")}\n${errorMessage(failure.cause)}` : null;

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      {banner}
      <ScrollView
        testID="onboarding-review"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {loadError ? <ErrorView message={`${t("loadError")}\n${errorMessage(loadError)}`} onRetry={onRetry} /> : null}
        {handled ? <HandledBanner handled={handled} /> : null}

        <View style={styles.titleRow}>
          <AppText weight="bold" size="title" style={styles.flexShrink}>
            {isolateAuto(summary.fullLegalName)}
          </AppText>
          <Badge label={enumLabel("AccountStatus", summary.membershipStatus)} color={STATUS_COLORS[summary.membershipStatus] ?? colors.muted} />
        </View>

        <Section title={t("personalTitle")}>
          <DetailRow label={t("fullLegalName")} value={isolateAuto(summary.fullLegalName)} />
          {summary.preferredName ? <DetailRow label={t("preferredName")} value={isolateAuto(summary.preferredName)} /> : null}
          <DetailRow testID="onboarding-phone" label={t("phone")} value={isolateLtr(summary.phoneNumber)} />
          <Button
            testID="onboarding-call"
            label={t("call")}
            accessibilityLabel={t("callLabel", { name: summary.preferredName ?? summary.fullLegalName })}
            variant="secondary"
            onPress={() => void dial(summary.phoneNumber)}
          />
          {callFailed ? (
            <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
              {t("callFailed")}
            </AppText>
          ) : null}
          <DetailRow label={t("submittedAt")} value={format.dateTime(summary.submittedAt)} />
        </Section>

        <Section title={t("identityTitle")}>
          <DetailRow label={t("idType")} value={summary.governmentIdType ? enumLabel("GovernmentIdType", summary.governmentIdType) : t("idTypeMissing")} />
          <DetailRow testID="onboarding-id-document" label={t("idDocument")} value={summary.hasIdentityDocument ? t("uploaded") : t("notUploaded")} />
          <DetailRow testID="onboarding-photo" label={t("profilePhoto")} value={summary.hasProfilePhoto ? t("uploaded") : t("notUploaded")} />
        </Section>

        {/* The API sends the bank account (its last four digits) only to a member who may see bank details. */}
        {bank ? (
          <Section title={t("bankTitle")} testID="onboarding-bank">
            <DetailRow label={t("bankName")} value={isolateAuto(bank.bankName)} />
            <DetailRow label={t("branchNumber")} value={isolateLtr(bank.branchNumber)} />
            <DetailRow testID="onboarding-account-masked" label={t("accountNumber")} value={isolateLtr(t("accountMasked", { last4: bank.accountNumberLast4 }))} />
          </Section>
        ) : summary.canRevealDetails ? (
          <Section title={t("bankTitle")} testID="onboarding-bank">
            <AppText color={colors.muted}>{t("bankMissing")}</AppText>
          </Section>
        ) : null}

        {summary.canRevealDetails ? (
          review ? (
            <RevealedDetails review={review} client={client} onHide={forgetSensitive} />
          ) : (
            <View style={styles.revealBox}>
              <AppText color={colors.warning} weight="semibold">
                {t("auditNote")}
              </AppText>
              <Button testID="onboarding-reveal" label={t("reveal")} variant="secondary" busy={revealing} busyLabel={t("revealing")} onPress={() => void reveal()} />
              {revealError ? <ErrorView message={`${t("revealFailed")}\n${errorMessage(revealError)}`} /> : null}
            </View>
          )
        ) : null}

        {/* Outside the actions: still shown when a refusal (CONFLICT) reloads an application someone else just decided. */}
        {failureText ? <ErrorView message={failureText} /> : null}
        {pending ? (
          <View style={styles.actions}>
            {open === "approve" && summary.canApprove ? (
              <ApproveWorkerForm busy={sending} onSubmit={(profile) => void approve(profile)} onCancel={() => setOpen(null)} />
            ) : open === "reject" && summary.canReject ? (
              <RejectApplicationForm busy={sending} onSubmit={(reason) => void reject(reason)} onCancel={() => setOpen(null)} />
            ) : (
              <>
                {summary.canApprove ? (
                  <Button
                    testID="onboarding-approve"
                    label={t("approve")}
                    onPress={() => {
                      setFailure(null);
                      setOpen("approve");
                    }}
                  />
                ) : null}
                {summary.canReject ? (
                  <Button
                    testID="onboarding-reject"
                    label={t("reject")}
                    variant="danger"
                    onPress={() => {
                      setFailure(null);
                      setOpen("reject");
                    }}
                  />
                ) : null}
              </>
            )}
          </View>
        ) : decidedByStatus ? (
          <AppText testID="onboarding-decision-state" weight="semibold" style={styles.decided}>
            {t("decided", { status: enumLabel("AccountStatus", summary.membershipStatus) })}
          </AppText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.md },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  doneCard: { marginHorizontal: spacing.xl, gap: spacing.md },
  revealBox: { gap: spacing.sm },
  actions: { gap: spacing.md },
  decided: { paddingVertical: spacing.sm },
});
