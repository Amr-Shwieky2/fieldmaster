import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { ManualCorrectionInput, NotificationSubject, TimeEntryEvidence } from "@fieldmaster/api-client";
import { Permission, TimeEntryStatus } from "@fieldmaster/shared-types";
import { isForbidden, isNotFound } from "@fieldmaster/i18n";
import { splitWorkedMinutes } from "@fieldmaster/shared-validation";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { ErrorView, LoadingView } from "../components/StateViews";
import { CorrectionForm, type CorrectionEntry } from "../components/review/CorrectionForm";
import { EntryCostCard } from "../components/review/EntryCostCard";
import { EntryPhotos } from "../components/review/EntryPhotos";
import { EvidenceMapCard } from "../components/review/EvidenceMapCard";
import { DurationCard, EmergencyCard, HistoryCard, SummaryCard, TimesCard } from "../components/review/EvidenceSections";
import { ReasonForm } from "../components/review/ReasonForm";
import { ReviewCard } from "../components/review/ReviewCard";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { useNow } from "../lib/elapsed";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "AttendanceReview">;

/** How long the success message stays before the screen goes back (tests shorten it). */
export const reviewTiming = { backDelayMs: 1500 };

/** Actions that need a written reason before they are sent (stored and shown to people). */
type ReasonAction = "reject" | "fullDayCredit" | "requestCorrection";
type BusyAction = "approve" | ReasonAction | "correct" | "followUp";
type SuccessKey = "approved" | "rejected" | "fullDayCreditApplied" | "correctionRequested" | "corrected" | "followedUp";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: colors.primary,
  PENDING_APPROVAL: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.danger,
  CORRECTION_REQUESTED: colors.warning,
};

const FLAG_COLORS: Record<string, string> = {
  OUTSIDE_GEOFENCE_ATTEMPT: colors.danger,
  SUSPICIOUS_LOCATION: colors.danger,
  OFFLINE: colors.primary,
  FLEXI_CHECK: colors.primary,
  TEMPORARY_POINT: colors.primary,
  EMERGENCY: colors.warning,
  DEV_REWOUND: colors.warning,
};

/** An API answer that means the entry changed under us (decided by someone else, month finalized, removed): show it as it is now. */
function isStale(error: unknown): boolean {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return status === 404 || status === 409;
}

/**
 * Where a manager settles one attendance entry (mobile manager mode), opened
 * from the approvals list, the live operations screen or a notification
 * (`subjectId`). The same API and rules as the admin web's attendance
 * detail: the evidence (times, location map with refused attempts, minutes
 * split with the day rules of the entry's own date, daily summary, photos,
 * history) and the decisions. Each action shows only when the entry allows it
 * now (`allowedActions`) AND the member holds its permission. Money (the
 * estimated cost) only for VIEW_FINANCIALS with VIEW_COMPENSATION, and only
 * then asked for. An open entry (e.g. from an overtime alert) shows how long
 * it has been open, «اتصل بالعامل» and the manual correction to set its
 * clock-out; from a notification, «تمت المتابعة» settles the alert. A
 * subject another manager already settled shows who did what, so nobody acts
 * twice by mistake.
 */
export function AttendanceReviewScreen({ navigation, route }: Props) {
  const { timeEntryId, subjectId } = route.params;
  const t = useTranslations("review");
  const tc = useTranslations("common");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const { can } = useAccess();

  const [evidence, setEvidence] = useState<TimeEntryEvidence | null>(null);
  const [loadError, setLoadError] = useState<{ cause: unknown } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [subject, setSubject] = useState<NotificationSubject | null>(null);
  const [subjectError, setSubjectError] = useState<{ cause: unknown } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [costKey, setCostKey] = useState(0);

  const [prompt, setPrompt] = useState<{ action: ReasonAction; text: string; invalid: boolean } | null>(null);
  /** The «تمت المتابعة» note while its form is open (null: closed). */
  const [followUpNote, setFollowUpNote] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [actionError, setActionError] = useState<{ cause: unknown } | null>(null);
  const [success, setSuccess] = useState<{ key: SuccessKey; name: string } | null>(null);
  const [callFailed, setCallFailed] = useState(false);

  const inFlight = useRef(false);
  const mounted = useRef(true);
  const backTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollView = useRef<ScrollView>(null);
  const latestEvidence = useRef(0);
  const latestSubject = useRef(0);

  const loadEvidence = useCallback(async () => {
    const call = ++latestEvidence.current;
    try {
      const next = await client.getTimeEntryEvidence(timeEntryId);
      if (call !== latestEvidence.current) return;
      setEvidence(next);
      setNotFound(false);
      setLoadError(null);
    } catch (cause) {
      if (call !== latestEvidence.current) return;
      if (isNotFound(cause) || isForbidden(cause)) {
        // Removed, or outside the member's projects: never shown.
        setEvidence(null);
        setNotFound(true);
        setLoadError(null);
      } else {
        setLoadError({ cause });
      }
    }
  }, [client, timeEntryId]);

  /** Who settled what the notification is about (shared by every manager's copy). */
  const loadSubject = useCallback(async () => {
    if (!subjectId) return;
    const call = ++latestSubject.current;
    try {
      const next = await client.getNotificationSubject(subjectId);
      if (call !== latestSubject.current) return;
      setSubject(next);
      setSubjectError(null);
    } catch (cause) {
      if (call !== latestSubject.current) return;
      setSubjectError({ cause });
    }
  }, [client, subjectId]);

  const reload = useCallback(async () => {
    await Promise.all([loadEvidence(), loadSubject()]);
  }, [loadEvidence, loadSubject]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Leaving before the success message ends: no late "go back" from this screen.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (backTimer.current) clearTimeout(backTimer.current);
    };
  }, []);

  const isOpen = evidence !== null && (evidence.status === TimeEntryStatus.ACTIVE || evidence.clockOutAt === null);
  const now = useNow(30_000, isOpen);

  async function onRefresh() {
    setRefreshing(true);
    // From the full error state, show the loading state again while retrying.
    if (!evidence) setLoadError(null);
    setCostKey((key) => key + 1);
    await reload();
    setRefreshing(false);
  }

  function goBackOrHome() {
    // Only from this screen while it is the one shown (never pops a screen the manager opened on top meanwhile).
    if (!mounted.current || !navigation.isFocused()) return;
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Main");
  }

  /** Runs one decision: on success a short message, the entry (and subject) read again, then back to where the manager came from. */
  async function perform(action: BusyAction, request: () => Promise<unknown>, successKey: SuccessKey) {
    if (inFlight.current || !evidence) return;
    inFlight.current = true;
    setBusy(action);
    setActionError(null);
    const name = evidence.worker.fullLegalName;
    try {
      await request();
    } catch (cause) {
      setActionError({ cause });
      inFlight.current = false;
      setBusy(null);
      // Another manager decided meanwhile, or the month was finalized: show the entry as it is now.
      if (isStale(cause)) void reload();
      return;
    }
    // Done: every action stays locked (inFlight is kept) until the screen goes back.
    setPrompt(null);
    setFollowUpNote(null);
    setCorrecting(false);
    setSuccess({ key: successKey, name });
    scrollView.current?.scrollTo({ y: 0, animated: true });
    setCostKey((key) => key + 1);
    await reload();
    if (!mounted.current) return;
    setBusy(null);
    backTimer.current = setTimeout(goBackOrHome, reviewTiming.backDelayMs);
  }

  function closeForms() {
    setActionError(null);
    setPrompt(null);
    setFollowUpNote(null);
    setCorrecting(false);
  }

  function openPrompt(action: ReasonAction) {
    closeForms();
    const defaults: Record<ReasonAction, string> = {
      reject: t("reasonPrompt.rejectDefault"),
      fullDayCredit: t("reasonPrompt.fullDayCreditDefault"),
      requestCorrection: t("reasonPrompt.requestCorrectionDefault"),
    };
    setPrompt({ action, text: defaults[action], invalid: false });
  }

  function submitPrompt(reason: string) {
    if (!prompt) return;
    // The reason is stored and shown to people: a blank one is refused before any request.
    if (reason.length === 0) {
      setPrompt({ ...prompt, invalid: true });
      return;
    }
    if (prompt.action === "reject") void perform("reject", () => client.rejectTimeEntry(timeEntryId, reason), "rejected");
    else if (prompt.action === "fullDayCredit") void perform("fullDayCredit", () => client.applyFullDayCredit(timeEntryId, reason), "fullDayCreditApplied");
    else void perform("requestCorrection", () => client.requestTimeEntryCorrection(timeEntryId, reason), "correctionRequested");
  }

  function submitFollowUp(note: string) {
    if (!subjectId) return;
    void perform("followUp", () => client.handleNotificationSubject(subjectId, note || undefined), "followedUp");
  }

  async function callWorker(phoneNumber: string) {
    setCallFailed(false);
    try {
      await Linking.openURL(`tel:${phoneNumber.replace(/[^\d+]/g, "")}`);
    } catch {
      setCallFailed(true);
    }
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;
  const banner = <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />;

  if (!evidence && !loadError && !notFound) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        <LoadingView />
      </SafeAreaView>
    );
  }

  const locked = busy !== null || success !== null;
  // What the entry allows now (the API) and what the member may do (their permissions), never a role's name.
  const allowed = evidence
    ? {
        approve: evidence.allowedActions.approve && can(Permission.APPROVE_ATTENDANCE),
        reject: evidence.allowedActions.reject && can(Permission.APPROVE_ATTENDANCE),
        requestCorrection: evidence.allowedActions.requestCorrection && can(Permission.APPROVE_ATTENDANCE),
        fullDayCredit: evidence.allowedActions.fullDayCredit && can(Permission.APPLY_FULL_DAY_CREDIT),
        correct: evidence.allowedActions.correct && can(Permission.CORRECT_TIME_ENTRIES),
      }
    : null;
  // «تمت المتابعة»: an open entry opened from a notification nobody has settled yet, by a member who may settle
  // attendance (the API's rule: approve or correct).
  const canFollowUp =
    Boolean(subjectId) && isOpen && subject !== null && subject.handled === null && (can(Permission.APPROVE_ATTENDANCE) || can(Permission.CORRECT_TIME_ENTRIES));
  const anyAction = allowed !== null && (Object.values(allowed).some(Boolean) || canFollowUp);
  // Money only with both permissions; without them the estimate is never even requested.
  const canSeeCost = can(Permission.VIEW_FINANCIALS) && can(Permission.VIEW_COMPENSATION);

  const openMinutes = isOpen && evidence?.clockInAt ? Math.max(0, Math.floor((now - Date.parse(evidence.clockInAt)) / 60_000)) : null;
  // The overtime so far, split with the day rules of the entry's own business date.
  const openSplit =
    evidence && openMinutes !== null
      ? splitWorkedMinutes(
          { rawDurationMinutes: openMinutes, unpaidBreakMinutes: evidence.duration.unpaidBreakMinutes, fullDayCredit: evidence.fullDayCredit.applied },
          evidence.dayRules,
        )
      : null;

  const correctionEntry: CorrectionEntry | null = evidence
    ? {
        id: evidence.id,
        status: evidence.status,
        businessDate: evidence.businessDate,
        clockInAt: evidence.clockInAt,
        clockOutAt: evidence.clockOutAt,
        rawDurationMinutes: evidence.duration.rawDurationMinutes,
        unpaidBreakMinutes: evidence.duration.unpaidBreakMinutes,
        fullDayCredit: evidence.fullDayCredit.applied,
        dayRules: evidence.dayRules,
      }
    : null;

  const promptTexts: Record<ReasonAction, { label: string; hint: string; submit: string; busy: string }> = {
    reject: { label: t("reasonPrompt.rejectLabel"), hint: t("reasonPrompt.rejectHint"), submit: t("actions.confirmReject"), busy: t("actions.rejecting") },
    fullDayCredit: {
      label: t("reasonPrompt.fullDayCreditLabel"),
      hint: t("reasonPrompt.fullDayCreditHint"),
      submit: t("actions.confirmFullDayCredit"),
      busy: t("actions.applyingFullDayCredit"),
    },
    requestCorrection: {
      label: t("reasonPrompt.requestCorrectionLabel"),
      hint: t("reasonPrompt.requestCorrectionHint"),
      submit: t("actions.confirmRequestCorrection"),
      busy: t("actions.requestingCorrection"),
    },
  };

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      {banner}
      <ScrollView
        ref={scrollView}
        testID="attendance-review"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {loadError ? <ErrorView message={`${t("loadError")}\n${errorMessage(loadError.cause)}`} onRetry={() => void onRefresh()} /> : null}
        {notFound ? (
          <View style={styles.dangerBox} accessible accessibilityRole="alert">
            <AppText weight="semibold" color={colors.danger}>
              {t("notFound")}
            </AppText>
          </View>
        ) : null}

        {success ? (
          <View style={styles.successBox} testID="review-success">
            <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" weight="semibold" color={colors.success}>
              {t(`messages.${success.key}`, { name: isolateAuto(success.name) })}
            </AppText>
          </View>
        ) : null}

        {subject?.handled ? (
          <View style={styles.handledBox} testID="handled-banner">
            <AppText weight="bold">{t("handled.title", { name: isolateAuto(subject.handled.by.fullLegalName), time: format.dateTime(subject.handled.at) })}</AppText>
            <AppText>{t("handled.outcome", { outcome: enumLabel("NotificationHandledOutcome", subject.handled.outcome) })}</AppText>
            {subject.handled.note ? <AppText>{t("handled.note", { note: isolateAuto(subject.handled.note) })}</AppText> : null}
          </View>
        ) : null}
        {subjectError ? (
          <View style={styles.warningBox}>
            <AppText color={colors.warning} weight="semibold">
              {t("handled.loadError")}
            </AppText>
            <Button label={tc("retry")} variant="secondary" onPress={() => void loadSubject()} />
          </View>
        ) : null}

        {evidence && allowed && correctionEntry ? (
          <>
            <ReviewCard testID="worker-card">
              <AppText accessibilityRole="header" weight="bold" size="title">
                {isolateAuto(evidence.worker.fullLegalName)}
              </AppText>
              <View style={styles.badges}>
                <Badge label={enumLabel("TimeEntryStatus", evidence.status)} color={STATUS_COLORS[evidence.status] ?? colors.muted} />
                {evidence.fullDayCredit.applied ? <Badge label={t("worker.fullDayCredit")} color={colors.primary} /> : null}
                {evidence.flags.map((flag) => (
                  <Badge key={flag} label={enumLabel("AttendanceFlag", flag)} color={FLAG_COLORS[flag] ?? colors.muted} />
                ))}
              </View>
              <AppText>{t("worker.businessDate", { date: format.businessDate(evidence.businessDate) })}</AppText>
              <AppText>{t("worker.shift", { title: isolateAuto(shiftTitle(evidence.shift)) })}</AppText>
              <AppText>{evidence.shift.project ? t("worker.project", { name: isolateAuto(evidence.shift.project.name) }) : t("worker.noProject")}</AppText>
              <AppText>{evidence.shift.site ? t("worker.site", { name: isolateAuto(evidence.shift.site.name) }) : t("worker.noSite")}</AppText>
              <AppText>{t("worker.scheduled", { start: format.dateTime(evidence.shift.scheduledStart), end: format.dateTime(evidence.shift.scheduledEnd) })}</AppText>
              <AppText color={colors.muted}>{t("worker.checkInMethod", { method: enumLabel("CheckInMethod", evidence.checkInMethod) })}</AppText>
              <AppText>{t("worker.phone", { phone: isolateLtr(evidence.worker.phoneNumber) })}</AppText>
              <Button label={t("worker.call")} variant={isOpen ? "primary" : "secondary"} onPress={() => void callWorker(evidence.worker.phoneNumber)} />
              {callFailed ? (
                <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                  {t("worker.callFailed", { phone: isolateLtr(evidence.worker.phoneNumber) })}
                </AppText>
              ) : null}
            </ReviewCard>

            {isOpen ? (
              <ReviewCard tone="warning" testID="open-entry">
                <AppText accessibilityRole="header" weight="bold" size="title" color={colors.warning}>
                  {t("open.title", { duration: format.minutes(openMinutes) })}
                </AppText>
                {evidence.clockInAt ? <AppText weight="semibold">{t("open.since", { time: format.dateTime(evidence.clockInAt) })}</AppText> : null}
                {openSplit && openSplit.overtimeMinutes > 0 ? (
                  <AppText weight="semibold" color={colors.danger}>
                    {t("open.overtime", { duration: format.minutes(openSplit.overtimeMinutes) })}
                  </AppText>
                ) : null}
                <AppText size="small">{t("open.threshold", { duration: format.minutes(evidence.dayRules.overtimeThresholdMinutes) })}</AppText>
                <AppText size="small" color={colors.muted}>
                  {t("open.hint")}
                </AppText>
              </ReviewCard>
            ) : null}

            <ReviewCard title={t("actions.title")} testID="actions">
              {evidence.rejectedReason ? <AppText>{t("actions.rejectedReason", { reason: isolateAuto(evidence.rejectedReason) })}</AppText> : null}
              {evidence.periodFinalized ? (
                <View style={styles.warningBox}>
                  <AppText weight="semibold" color={colors.warning}>
                    {t("actions.periodFinalized")}
                  </AppText>
                </View>
              ) : null}
              {anyAction ? (
                <View style={styles.buttons}>
                  {allowed.approve ? (
                    <Button
                      label={t("actions.approve")}
                      busy={busy === "approve"}
                      busyLabel={t("actions.approving")}
                      disabled={locked}
                      onPress={() => {
                        closeForms();
                        void perform("approve", () => client.approveTimeEntry(timeEntryId), "approved");
                      }}
                    />
                  ) : null}
                  {allowed.reject ? <Button label={tc("reject")} variant="danger" disabled={locked} onPress={() => openPrompt("reject")} /> : null}
                  {allowed.requestCorrection ? (
                    <Button label={t("actions.requestCorrection")} variant="secondary" disabled={locked} onPress={() => openPrompt("requestCorrection")} />
                  ) : null}
                  {allowed.fullDayCredit ? <Button label={tc("creditAsFullDay")} variant="secondary" disabled={locked} onPress={() => openPrompt("fullDayCredit")} /> : null}
                  {allowed.correct ? (
                    <Button
                      label={t("actions.manualCorrection")}
                      variant="secondary"
                      disabled={locked}
                      onPress={() => {
                        closeForms();
                        setCorrecting(true);
                      }}
                    />
                  ) : null}
                  {canFollowUp ? (
                    <Button
                      label={t("actions.followUp")}
                      variant="secondary"
                      disabled={locked}
                      onPress={() => {
                        closeForms();
                        setFollowUpNote("");
                      }}
                    />
                  ) : null}
                </View>
              ) : (
                <AppText color={colors.muted}>{t("actions.none")}</AppText>
              )}

              {prompt ? (
                <ReasonForm
                  testID="reason-form"
                  label={promptTexts[prompt.action].label}
                  hint={promptTexts[prompt.action].hint}
                  value={prompt.text}
                  error={prompt.invalid ? t("reasonPrompt.required") : null}
                  onChange={(text) => setPrompt({ ...prompt, text, invalid: false })}
                  onSubmit={submitPrompt}
                  onCancel={() => setPrompt(null)}
                  submitLabel={promptTexts[prompt.action].submit}
                  busyLabel={promptTexts[prompt.action].busy}
                  busy={busy === prompt.action}
                  disabled={locked}
                  variant={prompt.action === "reject" ? "danger" : "primary"}
                />
              ) : null}
              {followUpNote !== null ? (
                <ReasonForm
                  testID="follow-up-form"
                  label={t("followUp.label")}
                  hint={t("followUp.hint")}
                  placeholder={t("followUp.placeholder")}
                  value={followUpNote}
                  onChange={setFollowUpNote}
                  onSubmit={submitFollowUp}
                  onCancel={() => setFollowUpNote(null)}
                  submitLabel={t("actions.confirmFollowUp")}
                  busyLabel={t("actions.savingFollowUp")}
                  busy={busy === "followUp"}
                  disabled={locked}
                />
              ) : null}
              {correcting ? (
                <CorrectionForm
                  // A new form when the entry is closed or reopened meanwhile (the corrections that apply change).
                  key={isOpen ? "open" : "closed"}
                  entry={correctionEntry}
                  busy={busy === "correct"}
                  disabled={locked}
                  onSubmit={(input: ManualCorrectionInput) => void perform("correct", () => client.createManualCorrection(input), "corrected")}
                  onCancel={() => setCorrecting(false)}
                />
              ) : null}
              {actionError ? (
                <View style={styles.dangerBox}>
                  <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                    {errorMessage(actionError.cause)}
                  </AppText>
                </View>
              ) : null}
            </ReviewCard>

            <TimesCard evidence={evidence} />
            <DurationCard evidence={evidence} />
            {canSeeCost ? <EntryCostCard timeEntryId={evidence.id} reloadKey={costKey} /> : null}
            {evidence.emergency ? <EmergencyCard emergency={evidence.emergency} /> : null}
            <EvidenceMapCard evidence={evidence} />
            <SummaryCard summary={evidence.dailySummary} />
            <EntryPhotos timeEntryId={evidence.id} photos={evidence.photos ?? []} />
            <HistoryCard history={evidence.history} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.md },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginVertical: spacing.xs },
  buttons: { gap: spacing.sm },
  dangerBox: { backgroundColor: colors.dangerSoft, borderRadius: 12, padding: spacing.md },
  successBox: { backgroundColor: colors.successSoft, borderRadius: 12, padding: spacing.md },
  warningBox: { backgroundColor: colors.warningSoft, borderRadius: 12, padding: spacing.md, gap: spacing.sm },
  handledBox: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 2, borderColor: colors.success, padding: spacing.md, gap: 2 },
});
