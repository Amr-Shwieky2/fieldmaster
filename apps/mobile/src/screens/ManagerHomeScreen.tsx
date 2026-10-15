import { useCallback, useEffect, useRef, useState } from "react";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslations } from "use-intl";
import type { FinancialDashboard, OperationsSummary } from "@fieldmaster/api-client";
import { toBusinessDay } from "@fieldmaster/i18n";
import { OrgRole, Permission } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { RestrictedHint } from "../components/manager/RestrictedHint";
import { useFocusedRefresh } from "../components/manager/useFocusedRefresh";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { ManagerTabParamList, RootStackParamList } from "../navigation/types";

/** The «الإدارة» tab: a bottom-tab screen that opens the root stack's manager screens. */
type Props = CompositeScreenProps<BottomTabScreenProps<ManagerTabParamList, "ManageTab">, NativeStackScreenProps<RootStackParamList>>;

/** The counters are read again this often while the screen is on screen. */
export const MANAGER_HOME_REFRESH_MS = 60_000;

type CounterKey = Exclude<keyof OperationsSummary, "generatedAt">;
type ActionKey = "newWorkLocation" | "workLocations" | "newShift" | "approvals" | "liveOperations";
type IconName = keyof typeof Ionicons.glyphMap;

/** Each counter of GET /operations/summary and the permission that shows it (the API also leaves out what the caller may not see). */
const COUNTERS: readonly { key: CounterKey; permission: Permission }[] = [
  { key: "pendingApprovals", permission: Permission.APPROVE_ATTENDANCE },
  { key: "onShift", permission: Permission.VIEW_OPERATIONS },
  { key: "late", permission: Permission.VIEW_OPERATIONS },
  { key: "siteAlerts", permission: Permission.VIEW_OPERATIONS },
  { key: "onboardingRequests", permission: Permission.APPROVE_ONBOARDING },
];

/** The summary is asked for only by a member who holds one of these (an accountant's role has none). */
const SUMMARY_PERMISSIONS: readonly Permission[] = [Permission.APPROVE_ATTENDANCE, Permission.VIEW_OPERATIONS, Permission.APPROVE_ONBOARDING];

const ACTIONS: readonly { key: ActionKey; permission: Permission; icon: IconName }[] = [
  { key: "newWorkLocation", permission: Permission.MANAGE_SITES, icon: "add-circle-outline" },
  { key: "workLocations", permission: Permission.MANAGE_SITES, icon: "location-outline" },
  { key: "newShift", permission: Permission.MANAGE_SHIFTS, icon: "calendar-outline" },
  { key: "approvals", permission: Permission.APPROVE_ATTENDANCE, icon: "checkmark-done-outline" },
  { key: "liveOperations", permission: Permission.VIEW_OPERATIONS, icon: "pulse-outline" },
];

/** A count that asks for the manager's attention when above zero. */
const COUNTER_TONES: Record<CounterKey, string> = {
  pendingApprovals: colors.primary,
  onShift: colors.success,
  late: colors.warning,
  siteAlerts: colors.danger,
  onboardingRequests: colors.primary,
};

/**
 * The current payroll month (YYYY-MM) in Asia/Jerusalem: the same business
 * month as shared-validation's toBusinessYearMonth, through the shared
 * formatter that also works on Hermes (its Intl support varies).
 */
function currentBusinessMonth(): string {
  return (toBusinessDay(Date.now()) ?? "").slice(0, 7);
}

/**
 * The «الإدارة» tab of the mobile manager mode: the member's role, the
 * counters of what needs them now (each only with its permission and when
 * the API sends it), the quick actions their permissions allow, and the
 * month's payroll figures only with the financial dashboard permission (an
 * accountant's custom role sees just that). Never decided from a role's
 * name. The counters reload on focus and every minute while on screen.
 */
export function ManagerHomeScreen({ navigation }: Props) {
  const t = useTranslations("managerHome");
  const tHome = useTranslations("home");
  const tc = useTranslations("common");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client, logout, session } = useAuth();
  const { access, can, canAny, restricted } = useAccess();
  const { pendingCount } = useOfflineSync();

  const wantsSummary = canAny(SUMMARY_PERMISSIONS);
  // Money only with "رؤية المبالغ المالية" and the dashboard's own permission (which requires it).
  const canSeeMoney = can(Permission.VIEW_FINANCIALS) && can(Permission.VIEW_FINANCIAL_DASHBOARD);

  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<unknown>(null);
  const [dashboard, setDashboard] = useState<FinancialDashboard | null>(null);
  const [dashboardError, setDashboardError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const summaryCall = useRef(0);
  const dashboardCall = useRef(0);
  const scrollView = useRef<ScrollView>(null);

  // Only the latest answer counts: an older, slower one never overwrites it. Without the
  // permission(s) nothing is asked and nothing is kept (an answer still on its way is dropped).
  const loadSummary = useCallback(async () => {
    const call = ++summaryCall.current;
    if (!wantsSummary) {
      setSummary(null);
      setSummaryError(null);
      return;
    }
    try {
      const next = await client.getOperationsSummary();
      if (call !== summaryCall.current) return;
      setSummary(next);
      setSummaryError(null);
    } catch (cause) {
      if (call === summaryCall.current) setSummaryError(cause ?? new Error());
    }
  }, [client, wantsSummary]);

  const loadDashboard = useCallback(async () => {
    const call = ++dashboardCall.current;
    if (!canSeeMoney) {
      setDashboard(null);
      setDashboardError(null);
      return;
    }
    try {
      const next = await client.getFinancialDashboard(currentBusinessMonth());
      if (call !== dashboardCall.current) return;
      setDashboard(next);
      setDashboardError(null);
    } catch (cause) {
      if (call === dashboardCall.current) setDashboardError(cause ?? new Error());
    }
  }, [client, canSeeMoney]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadDashboard()]);
  }, [loadSummary, loadDashboard]);

  // Focus (and the app's return to the foreground) reloads everything; the interval only the counters.
  const onFocus = useCallback(() => void loadAll(), [loadAll]);
  const onInterval = useCallback(() => void loadSummary(), [loadSummary]);
  useFocusedRefresh(onFocus, { intervalMs: MANAGER_HOME_REFRESH_MS, onInterval });

  // The confirmation replaces the sign-out button at the bottom: bring it into view.
  useEffect(() => {
    if (confirmingSignOut) scrollView.current?.scrollToEnd({ animated: true });
  }, [confirmingSignOut]);

  async function onRefresh() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }

  function openCounter(key: CounterKey) {
    switch (key) {
      case "pendingApprovals":
        return navigation.navigate("Approvals");
      case "onShift":
        return navigation.navigate("LiveOperations", { focus: "onShift" });
      case "late":
        return navigation.navigate("LiveOperations", { focus: "late" });
      case "siteAlerts":
        return navigation.navigate("LiveOperations", { focus: "alerts" });
      case "onboardingRequests":
        return navigation.navigate("OnboardingRequests");
    }
  }

  function openAction(key: ActionKey) {
    switch (key) {
      case "newWorkLocation":
        return navigation.navigate("WorkLocationEditor");
      case "workLocations":
        return navigation.navigate("WorkLocations");
      case "newShift":
        return navigation.navigate("NewShift");
      case "approvals":
        return navigation.navigate("Approvals");
      case "liveOperations":
        return navigation.navigate("LiveOperations");
    }
  }

  const counterTitles: Record<CounterKey, string> = {
    pendingApprovals: tc("pendingApproval"),
    onShift: t("onShift"),
    late: t("late"),
    siteAlerts: t("siteAlerts"),
    onboardingRequests: t("onboardingRequests"),
  };
  const actionLabels: Record<ActionKey, string> = {
    newWorkLocation: t("newWorkLocation"),
    workLocations: t("workLocations"),
    newShift: t("newShift"),
    approvals: t("approvals"),
    liveOperations: t("liveOperations"),
  };

  // A custom role is shown by its own name; a built-in role by its Arabic label.
  const role = access?.role ?? session?.role ?? null;
  const roleLabel = role === OrgRole.CUSTOM && access?.roleName ? isolateAuto(access.roleName) : role ? enumLabel("OrgRole", role) : null;

  const counters = summary ? COUNTERS.filter(({ key, permission }) => can(permission) && typeof summary[key] === "number") : [];
  const actions = ACTIONS.filter(({ permission }) => can(permission));
  const noTools = !wantsSummary && actions.length === 0 && !canSeeMoney;
  const money = (agorot: number) => isolateLtr(format.money(agorot));

  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]} testID="manager-home">
      <View style={styles.header}>
        <AppText accessibilityRole="header" weight="bold" size="title">
          {t("title")}
        </AppText>
        {roleLabel ? (
          <AppText color={colors.muted} testID="manager-home-role">
            {roleLabel}
          </AppText>
        ) : null}
        {restricted ? <RestrictedHint /> : null}
      </View>

      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />

      <ScrollView
        ref={scrollView}
        testID="manager-home-scroll"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {wantsSummary ? (
          <View style={styles.section} testID="manager-counters">
            <View style={styles.sectionHeader}>
              <AppText accessibilityRole="header" weight="bold" size="large" style={styles.flexShrink}>
                {t("now")}
              </AppText>
              {summary ? (
                <AppText size="small" color={colors.muted}>
                  {t("updatedAt", { time: format.time(summary.generatedAt) })}
                </AppText>
              ) : null}
            </View>
            {summaryError ? <ErrorView message={`${t("loadError")}\n${errorMessage(summaryError)}`} onRetry={() => void loadSummary()} /> : null}
            {!summary && !summaryError ? <LoadingView /> : null}
            {counters.length > 0 ? (
              <View style={styles.grid}>
                {counters.map(({ key }) => {
                  const value = summary?.[key] ?? 0;
                  const tone = value > 0 ? COUNTER_TONES[key] : colors.text;
                  return (
                    <Pressable
                      key={key}
                      testID={`manager-counter-${key}`}
                      accessibilityRole="button"
                      accessibilityLabel={t("counterLabel", { label: counterTitles[key], count: format.number(value) })}
                      accessibilityHint={t("counterHint")}
                      onPress={() => openCounter(key)}
                      style={({ pressed }) => [styles.tile, value > 0 && { borderColor: tone }, pressed && styles.pressed]}
                    >
                      <AppText weight="bold" size="hero" color={tone}>
                        {format.number(value)}
                      </AppText>
                      <AppText weight="semibold">{counterTitles[key]}</AppText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {canSeeMoney ? (
          <View style={styles.moneyCard} testID="manager-money">
            <AppText accessibilityRole="header" weight="bold" size="large">
              {t("money", { month: format.month(dashboard?.yearMonth ?? currentBusinessMonth()) })}
            </AppText>
            {dashboard ? (
              <>
                <AppText color={colors.muted}>{t("netPayable")}</AppText>
                <AppText weight="bold" size="hero" testID="manager-money-net">
                  {money(dashboard.netPayableAgorot)}
                </AppText>
                <AppText testID="manager-money-labor">{t("laborCost", { amount: money(dashboard.laborCostAgorot) })}</AppText>
                <AppText size="small" color={colors.muted}>
                  {enumLabel("PayrollFigureSource", dashboard.source)}
                </AppText>
              </>
            ) : null}
            {dashboardError ? (
              <>
                <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                  {`${t("moneyLoadError")}\n${errorMessage(dashboardError)}`}
                </AppText>
                <Button label={tc("retry")} variant="secondary" onPress={() => void loadDashboard()} />
              </>
            ) : null}
            {!dashboard && !dashboardError ? <LoadingView /> : null}
          </View>
        ) : null}

        {actions.length > 0 ? (
          <View style={styles.section} testID="manager-actions">
            <AppText accessibilityRole="header" weight="bold" size="large" style={styles.sectionTitle}>
              {t("actions")}
            </AppText>
            <View style={styles.grid}>
              {actions.map(({ key, icon }) => (
                <Pressable
                  key={key}
                  testID={`manager-action-${key}`}
                  accessibilityRole="button"
                  accessibilityLabel={actionLabels[key]}
                  onPress={() => openAction(key)}
                  style={({ pressed }) => [styles.tile, styles.actionTile, pressed && styles.pressed]}
                >
                  <Ionicons name={icon} size={30} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  <AppText weight="semibold" align="center">
                    {actionLabels[key]}
                  </AppText>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {noTools ? <EmptyView title={t("webOnly")} hint={t("webOnlyHint")} /> : null}

        <View style={styles.footer}>
          <Button
            testID="manager-notification-settings"
            label={t("notificationSettings")}
            variant="secondary"
            onPress={() => navigation.navigate("NotificationPreferences")}
          />
          {confirmingSignOut ? (
            <View style={styles.confirmCard} accessibilityRole="alert" testID="manager-sign-out-confirm">
              <AppText weight="bold" size="large">
                {tHome("signOutConfirm")}
              </AppText>
              {pendingCount > 0 ? <AppText color={colors.warning}>{tHome("signOutPending", { count: pendingCount })}</AppText> : null}
              <Button label={tHome("signOutYes")} variant="danger" onPress={() => void logout()} />
              <Button label={tc("cancel")} variant="secondary" onPress={() => setConfirmingSignOut(false)} />
            </View>
          ) : (
            <Button testID="manager-sign-out" label={tc("signOut")} variant="secondary" onPress={() => setConfirmingSignOut(true)} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.xs },
  content: { paddingBottom: spacing.xl * 2, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.xl },
  sectionTitle: { marginHorizontal: spacing.xl },
  flexShrink: { flexShrink: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginHorizontal: spacing.xl },
  tile: {
    flexGrow: 1,
    flexBasis: "40%",
    minHeight: TOUCH_TARGET * 2,
    justifyContent: "center",
    gap: 2,
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  actionTile: { alignItems: "center", gap: spacing.sm },
  pressed: { opacity: 0.8 },
  moneyCard: {
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    gap: spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  footer: { marginHorizontal: spacing.xl, gap: spacing.md },
  confirmCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.danger, padding: spacing.lg, gap: spacing.md },
});
