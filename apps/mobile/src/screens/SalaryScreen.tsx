import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import * as Crypto from "expo-crypto";
import type { CurrentSalaryEstimate, FieldMasterClient, MySalaryStatements, ReportDownload, SalaryStatement } from "@fieldmaster/api-client";
import { getErrorCode } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useCodeMessage, useEnumLabel, useErrorMessage, useFormat } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Salary">;

/** How the statement PDF is waited for (tests shorten it). */
export const statementPolling = { intervalMs: 1500, maxAttempts: 80 };

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The first and last business day of a month: `2026-02` -> 2026-02-01 .. 2026-02-28. */
export function monthRange(yearMonth: string): { fromDate: string; toDate: string } | null {
  const match = YEAR_MONTH.exec(yearMonth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { fromDate: `${match[1]}-${match[2]}-01`, toDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, "0")}` };
}

type EstimateState = { status: "loaded"; estimate: CurrentSalaryEstimate } | { status: "finalized" } | { status: "failed"; cause: unknown } | { status: "none" };

/** Nothing at all yet in a month: no approved shift, none waiting, no adjustment or deduction, no amount. */
export function isEmptyMonth(statement: SalaryStatement): boolean {
  return (
    (statement.approvedShifts ?? 0) === 0 &&
    (statement.pendingEntries ?? 0) === 0 &&
    statement.regularMinutes === 0 &&
    statement.overtimeMinutes === 0 &&
    statement.standardDaysCredited === 0 &&
    statement.grossAgorot === 0 &&
    statement.adjustmentsAgorot === 0 &&
    statement.forgottenStampDeductionsAgorot === 0 &&
    statement.netPayableAgorot === 0
  );
}

/**
 * "My salary": only the caller's own money, from /me routes only.
 * - The current month: GET /payroll-statements/me/current, labelled
 *   «تقدير — غير نهائي», from approved entries only, with the entries still
 *   waiting for approval. A 409 PAYROLL_PERIOD_FINALIZED means the month is
 *   already final (it is then among the finalized months). A month with
 *   nothing in it yet reads «لا يوجد راتب لهذا الشهر بعد» (never a card of
 *   zeros, never an error).
 * - Other open months: the estimates of GET /payroll-statements/me.
 * - Finalized months: only `statements` of GET /payroll-statements/me, each
 *   with its PDF statement (the worker's own attendance ledger for the month,
 *   a Step 8 report).
 * Only a member who clocks in themselves has a salary here (the home offers
 * «راتبي» to them only); anyone else gets NO_WORKER_PROFILE, said plainly.
 */
export function SalaryScreen({ navigation, route }: Props) {
  const t = useTranslations("salary");
  const errorMessage = useErrorMessage();
  const { client, session } = useAuth();
  const focusMonth = route.params?.yearMonth ?? null;

  const [statements, setStatements] = useState<MySalaryStatements | null>(null);
  const [estimate, setEstimate] = useState<EstimateState>({ status: "none" });
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scrollView = useRef<ScrollView>(null);
  const scrolled = useRef(false);

  /** A month opened from a notification: scroll to it once, when its card is laid out. */
  const scrollTo = useCallback((y: number) => {
    if (scrolled.current) return;
    scrolled.current = true;
    scrollView.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const [mine, current] = await Promise.allSettled([client.getMySalaryStatements(), client.getMyCurrentSalaryEstimate()]);
    if (current.status === "fulfilled") setEstimate({ status: "loaded", estimate: current.value });
    else if (getErrorCode(current.reason) === "PAYROLL_PERIOD_FINALIZED") setEstimate({ status: "finalized" });
    else setEstimate({ status: "failed", cause: current.reason });
    if (mine.status === "fulfilled") setStatements(mine.value);
    else setError(mine.reason ?? new Error());
    setRefreshing(false);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;
  const banner = <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />;

  if (!statements && !error) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        <LoadingView />
      </SafeAreaView>
    );
  }

  // No worker profile (an Owner or a manager who does not clock in): there is no salary to show, and retrying will not change it.
  if (error && getErrorCode(error) === "NO_WORKER_PROFILE") {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        <View testID="salary-unavailable">
          <EmptyView title={t("unavailable")} hint={errorMessage(error)} />
        </View>
      </SafeAreaView>
    );
  }

  const currentMonth = estimate.status === "loaded" ? estimate.estimate.yearMonth : null;
  const otherEstimates = (statements?.estimates ?? []).filter((s) => s.yearMonth !== currentMonth).sort(newestMonthFirst);
  const finalized = [...(statements?.statements ?? [])].sort(newestMonthFirst);
  const nothing = statements !== null && estimate.status !== "loaded" && otherEstimates.length === 0 && finalized.length === 0;
  const currentEmpty = estimate.status === "loaded" && isEmptyMonth(estimate.estimate);
  // Nothing this month and no other month yet: one plain sentence, nothing else.
  const nothingYet = statements !== null && currentEmpty && otherEstimates.length === 0 && finalized.length === 0;

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      {banner}
      <ScrollView
        ref={scrollView}
        testID="salary"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRefresh} /> : null}

        {nothingYet ? (
          <View testID="salary-nothing-yet">
            <EmptyView title={t("noSalaryYet")} hint={t("emptyHint")} />
          </View>
        ) : null}

        {!nothingYet && (estimate.status === "loaded" || estimate.status === "finalized" || (estimate.status === "failed" && statements)) ? (
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("currentMonth")}
          </AppText>
        ) : null}
        {estimate.status === "loaded" && currentEmpty && !nothingYet ? (
          <AppText testID="salary-current-empty" color={colors.muted}>
            {t("noSalaryYet")}
          </AppText>
        ) : null}
        {estimate.status === "loaded" && !currentEmpty ? (
          <MonthCard statement={estimate.estimate} highlighted={focusMonth === estimate.estimate.yearMonth} onHighlightedLayout={scrollTo} />
        ) : null}
        {estimate.status === "finalized" ? <AppText color={colors.muted}>{t("currentFinalized")}</AppText> : null}
        {estimate.status === "failed" && statements ? <ErrorView message={`${t("estimateLoadError")}\n${errorMessage(estimate.cause)}`} onRetry={onRefresh} /> : null}

        {otherEstimates.length > 0 ? (
          <>
            <AppText accessibilityRole="header" weight="bold" size="large">
              {t("openMonths")}
            </AppText>
            {otherEstimates.map((statement) => (
              <MonthCard key={`estimate-${statement.yearMonth}`} statement={statement} highlighted={focusMonth === statement.yearMonth} onHighlightedLayout={scrollTo} />
            ))}
          </>
        ) : null}

        {statements && !nothingYet ? (
          <>
            <AppText accessibilityRole="header" weight="bold" size="large">
              {t("finalizedMonths")}
            </AppText>
            {finalized.length === 0 ? <AppText color={colors.muted}>{t("noFinalized")}</AppText> : null}
            {finalized.map((statement) => (
              <MonthCard
                key={`final-${statement.yearMonth}`}
                statement={statement}
                highlighted={focusMonth === statement.yearMonth}
                onHighlightedLayout={scrollTo}
                download={session?.workerProfileId ? <StatementDownload client={client} workerProfileId={session.workerProfileId} yearMonth={statement.yearMonth} /> : null}
              />
            ))}
          </>
        ) : null}

        {nothing ? <EmptyView title={t("empty")} hint={t("emptyHint")} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const newestMonthFirst = (a: SalaryStatement, b: SalaryStatement) => b.yearMonth.localeCompare(a.yearMonth);

function MonthCard({
  statement,
  highlighted,
  download,
  onHighlightedLayout,
}: {
  statement: SalaryStatement;
  highlighted: boolean;
  download?: ReactNode;
  /** The highlighted month reports where it is, so the screen can scroll to it. */
  onHighlightedLayout?: (y: number) => void;
}) {
  const t = useTranslations("salary");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const money = (agorot: number) => isolateLtr(format.money(agorot));
  const final = statement.status === "FINALIZED" && !statement.isEstimate;
  return (
    <View
      testID={`salary-month-${statement.yearMonth}`}
      style={[styles.card, highlighted && styles.cardHighlighted]}
      onLayout={highlighted && onHighlightedLayout ? (event) => onHighlightedLayout(event.nativeEvent.layout.y) : undefined}
    >
      <View style={styles.titleRow}>
        <AppText weight="bold" size="large" style={styles.flexShrink}>
          {format.month(statement.yearMonth)}
        </AppText>
        <Badge label={final ? t("finalLabel") : t("estimateLabel")} color={final ? colors.success : colors.warning} />
      </View>
      {final ? null : <AppText color={colors.warning}>{t("estimateBasis")}</AppText>}
      <AppText weight="bold" size="large">
        {t("net", { amount: money(statement.netPayableAgorot) })}
      </AppText>
      <AppText>{t("gross", { amount: money(statement.grossAgorot) })}</AppText>
      <AppText>{t("base", { amount: money(statement.baseAgorot) })}</AppText>
      <AppText>{t("overtime", { amount: money(statement.overtimeAgorot) })}</AppText>
      <AppText>{t("adjustments", { amount: money(statement.adjustmentsAgorot) })}</AppText>
      <AppText>{t("forgottenStamps", { amount: money(statement.forgottenStampDeductionsAgorot) })}</AppText>
      <AppText color={colors.muted}>{t("regularHours", { duration: format.minutes(statement.regularMinutes) })}</AppText>
      <AppText color={colors.muted}>{t("overtimeHours", { duration: format.minutes(statement.overtimeMinutes) })}</AppText>
      {statement.approvedShifts !== null ? <AppText color={colors.muted}>{t("approvedShifts", { count: format.number(statement.approvedShifts) })}</AppText> : null}
      <AppText color={colors.muted}>{t("daysCredited", { count: format.number(statement.standardDaysCredited) })}</AppText>
      <AppText color={colors.muted}>{t("status", { status: enumLabel("SalaryStatementStatus", statement.status) })}</AppText>
      {final && statement.version !== null ? <AppText color={colors.muted}>{t("version", { version: format.number(statement.version) })}</AppText> : null}
      {final && statement.finalizedAt ? <AppText color={colors.muted}>{t("finalizedAt", { date: format.date(statement.finalizedAt) })}</AppText> : null}
      {!final && statement.pendingEntries !== null && statement.pendingEntries > 0 ? (
        <AppText weight="semibold" color={colors.warning}>
          {t("pendingEntries", { count: format.number(statement.pendingEntries) })}
        </AppText>
      ) : null}
      {download}
    </View>
  );
}

type DownloadState =
  | { status: "idle" }
  | { status: "preparing"; progress: number | null }
  | { status: "ready"; download: ReportDownload; fetchedAt: number }
  | { status: "failed"; reason: { code: string } | { cause: unknown } | "timeout" };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A fresh Idempotency-Key part: each press asks for a new statement (the API answers the same report for the same key). */
const randomHex = () => Array.from(Crypto.getRandomBytes(12), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The month's statement as a PDF: the worker's own attendance ledger (Step
 * 8 report) for that month. Generated by a background job: created with an
 * Idempotency-Key, polled until READY or FAILED, then opened through a
 * short-lived signed URL. On the web the file opens from a press (a link
 * opened after a wait could be blocked as a popup).
 */
function StatementDownload({ client, workerProfileId, yearMonth }: { client: FieldMasterClient; workerProfileId: string; yearMonth: string }) {
  const t = useTranslations("salary");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const [openFailed, setOpenFailed] = useState(false);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const openUrl = useCallback(async (url: string) => {
    setOpenFailed(false);
    try {
      await Linking.openURL(url);
    } catch {
      if (alive.current) setOpenFailed(true);
    }
  }, []);

  async function generate() {
    const range = monthRange(yearMonth);
    if (!range) return;
    setOpenFailed(false);
    setState({ status: "preparing", progress: null });
    try {
      let report = await client.createReport(
        { reportType: "WORKER_ATTENDANCE_LEDGER", filters: { workerProfileId, fromDate: range.fromDate, toDate: range.toDate } },
        `statement-${yearMonth}-${randomHex()}`,
      );
      for (let attempt = 0; report.status !== "READY" && report.status !== "FAILED"; attempt++) {
        if (attempt >= statementPolling.maxAttempts) {
          if (alive.current) setState({ status: "failed", reason: "timeout" });
          return;
        }
        if (alive.current) setState({ status: "preparing", progress: report.progress ?? null });
        await wait(statementPolling.intervalMs);
        if (!alive.current) return;
        report = await client.getReport(report.id);
      }
      if (report.status === "FAILED") {
        if (alive.current) setState({ status: "failed", reason: { code: report.errorCode ?? "" } });
        return;
      }
      const download = await client.getReportDownloadUrl(report.id, "pdf");
      if (!alive.current) return;
      setState({ status: "ready", download, fetchedAt: Date.now() });
      // Native apps open it right away; the web waits for a press (see above).
      if (Platform.OS !== "web") void openUrl(download.downloadUrl);
    } catch (cause) {
      if (alive.current) setState({ status: "failed", reason: { cause } });
    }
  }

  function openAgain() {
    if (state.status !== "ready") return;
    const expired = Date.now() - state.fetchedAt > (state.download.expiresInSeconds - 15) * 1000;
    // An expired link would fail: prepare it again (the report itself is reused by a new request).
    if (expired) void generate();
    else void openUrl(state.download.downloadUrl);
  }

  const failure =
    state.status === "failed"
      ? state.reason === "timeout"
        ? t("timeout")
        : "code" in state.reason
          ? `${t("failed")}${state.reason.code && codeMessage(state.reason.code) ? `\n${codeMessage(state.reason.code)}` : ""}`
          : `${t("failed")}\n${errorMessage(state.reason.cause)}`
      : null;

  return (
    <View style={styles.download}>
      {state.status === "ready" ? (
        <>
          <AppText weight="semibold" color={colors.success}>
            {t("ready")}
          </AppText>
          <Button label={t("open")} onPress={openAgain} />
        </>
      ) : (
        <Button
          label={t("download")}
          accessibilityHint={t("downloadLabel", { month: format.month(yearMonth) })}
          variant="secondary"
          busy={state.status === "preparing"}
          busyLabel={state.status === "preparing" && state.progress !== null ? t("progress", { progress: format.number(state.progress) }) : t("preparing")}
          onPress={() => void generate()}
        />
      )}
      {failure ? (
        <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {failure}
        </AppText>
      ) : null}
      {openFailed ? (
        <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {t("openFailed")}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  cardHighlighted: { borderColor: colors.primary, borderWidth: 2 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  download: { marginTop: spacing.sm, gap: spacing.xs },
});
