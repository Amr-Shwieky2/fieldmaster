import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { EmergencyEligibility, MyTemporarySupervision, Shift, TimeEntry } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { toBusinessDay } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { isolateAuto } from "../components/LtrText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { formatElapsed, useNow } from "../lib/elapsed";
import { useNotifications } from "../lib/notifications-context";
import type { QueuedEvent } from "../lib/offline-queue";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const UPCOMING_STATUSES = new Set(["PUBLISHED", "OPEN", "ACTIVE"]);
/** Recent attendance on Home: the last few finished entries ("عرض الكل" opens the full history). */
const RECENT_ENTRIES = 3;

/** Badge colour per TimeEntryStatus; anything else is grey. */
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: colors.primary,
  PENDING_APPROVAL: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.danger,
  CORRECTION_REQUESTED: colors.warning,
};

/** Still on the phone: not yet accepted (or rejected) by the server. */
const isWaiting = (event: QueuedEvent) => event.localStatus === "PENDING" || event.localStatus === "SYNCING";

/** The latest clock-in / clock-out still waiting to sync, or null. */
function latestWaitingClockEvent(queue: QueuedEvent[]): QueuedEvent | null {
  let latest: QueuedEvent | null = null;
  for (const event of queue) {
    if (!isWaiting(event) || (event.eventType !== "CLOCK_IN" && event.eventType !== "CLOCK_OUT")) continue;
    if (!latest || new Date(event.deviceTimestamp).getTime() >= new Date(latest.deviceTimestamp).getTime()) latest = event;
  }
  return latest;
}

/** A secondary section's data, or null when its call failed (the section is then hidden: fail closed). */
async function settle<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}

const timeOf = (value: string | null | undefined) => (value ? Date.parse(value) : 0);

/** Newest first: by business day, then by clock-in time within the same day. */
function newestFirst(a: TimeEntry, b: TimeEntry): number {
  const byDay = timeOf(b.businessDate) - timeOf(a.businessDate);
  return byDay !== 0 ? byDay : timeOf(b.clockInAt) - timeOf(a.clockInAt);
}

/**
 * The worker's own records only. The API already scopes a Worker's lists to
 * them; a manager signed in to the app gets the organization's lists from
 * the same endpoints, so their own records are picked by their worker
 * profile (none without one). Never anyone else's.
 */
function ownership(session: { role?: string | null; workerProfileId?: string | null } | null) {
  const workerProfileId = session?.workerProfileId ?? null;
  const scopedByApi = session?.role === OrgRole.WORKER;
  return {
    entry: (entry: TimeEntry) => (workerProfileId ? entry.workerProfileId === workerProfileId : scopedByApi),
    shift: (shift: Shift) =>
      scopedByApi || (workerProfileId !== null && (shift.assignments ?? []).some((assignment) => assignment.workerProfileId === workerProfileId)),
  };
}

export function HomeScreen({ navigation }: Props) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const tApp = useTranslations("app");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client, logout, session } = useAuth();
  const { pendingCount, queue } = useOfflineSync();
  const { unreadCount, refresh: refreshNotifications } = useNotifications();

  const [refreshing, setRefreshing] = useState(false);
  /** The last load failure (rendered in Arabic at render time, never the API's English text). */
  const [error, setError] = useState<unknown>(null);
  /** True once a load succeeded: a later failure keeps showing that data under the error. */
  const [loaded, setLoaded] = useState(false);
  /** The worker's own entries, newest first as the API sends them (the open one included). */
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [eligibility, setEligibility] = useState<EmergencyEligibility | null>(null);
  const [supervisions, setSupervisions] = useState<MyTemporarySupervision[]>([]);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const role = session?.role ?? null;
  const workerProfileId = session?.workerProfileId ?? null;

  const load = useCallback(async () => {
    setError(null);
    const own = ownership({ role, workerProfileId });
    // Emergency eligibility and temporary supervision: shown when known, hidden when their call fails.
    const extras = Promise.all([settle(() => client.getEmergencyEligibility()), settle(() => client.myTemporarySupervisions())]);
    try {
      const [allEntries, allShifts] = await Promise.all([client.listTimeEntries(), client.listShifts()]);
      const now = Date.now();
      setEntries(allEntries.filter(own.entry));
      setShifts(
        allShifts
          // Upcoming: open for clock-in and not over yet (a shift the server still runs is always shown).
          .filter((s) => UPCOMING_STATUSES.has(s.status) && (s.status === "ACTIVE" || Date.parse(s.scheduledEnd) > now) && own.shift(s))
          .sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart)),
      );
      setLoaded(true);
    } catch (cause) {
      setError(cause ?? new Error());
    } finally {
      setRefreshing(false);
    }
    const [nextEligibility, nextSupervisions] = await extras;
    setEligibility(nextEligibility);
    setSupervisions(nextSupervisions ?? []);
  }, [client, role, workerProfileId]);

  useFocusEffect(
    useCallback(() => {
      load();
      void refreshNotifications();
    }, [load, refreshNotifications]),
  );

  // A clock event saved on the phone changes what the server will say: reload once it has synced.
  const waitingCount = useMemo(() => queue.filter(isWaiting).length, [queue]);
  const previousWaitingCount = useRef(waitingCount);
  useEffect(() => {
    const synced = waitingCount < previousWaitingCount.current;
    previousWaitingCount.current = waitingCount;
    if (!synced) return;
    if (loaded) setRefreshing(true);
    load();
  }, [waitingCount, loaded, load]);

  const waitingEvent = useMemo(() => latestWaitingClockEvent(queue), [queue]);
  const waitingClockIn = waitingEvent?.eventType === "CLOCK_IN" ? waitingEvent : null;
  const waitingClockOut = waitingEvent?.eventType === "CLOCK_OUT" ? waitingEvent : null;

  const activeEntry = loaded ? (entries.find((entry) => entry.status === "ACTIVE") ?? null) : null;
  const recentEntries = useMemo(() => entries.filter((entry) => entry.status !== "ACTIVE").sort(newestFirst).slice(0, RECENT_ENTRIES), [entries]);
  const activeCallout = eligibility?.activeCallout ?? null;
  const emergencyRunning = activeEntry !== null && (activeEntry.isEmergency === true || activeCallout?.timeEntryId === activeEntry.id);
  const now = useNow(1000, emergencyRunning && activeCallout !== null);

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  function onRetry() {
    // Without data, clearing the error brings back the full loading state; with data the list stays and the spinner shows on top.
    if (loaded) setRefreshing(true);
    load();
  }

  const today = toBusinessDay(Date.now());
  const isToday = (value: string | null) => !value || toBusinessDay(value) === today;
  /** "بدأت الساعة 10:30" today; with the date when it started on another day (forgotten clock-out, night shift). */
  const startedText = (value: string | null) =>
    isToday(value) ? t("activeSince", { time: format.time(value) }) : t("activeSinceDate", { dateTime: format.dateTime(value) });
  const endedText = (value: string | null) =>
    isToday(value) ? t("endedAt", { time: format.time(value) }) : t("endedAtDate", { dateTime: format.dateTime(value) });
  /** "من 22:00 إلى 06:00", with the dates when the range is not within one day. */
  const rangeText = (start: string, end: string) =>
    toBusinessDay(start) === toBusinessDay(end)
      ? t("turanHours", { start: format.time(start), end: format.time(end) })
      : t("turanHours", { start: format.dateTime(start), end: format.dateTime(end) });

  const waitingClockOutNotice = waitingClockOut ? (
    <View style={styles.waitingNotice}>
      <AppText weight="bold" color={colors.warning}>
        {t("pendingClockOut")}
      </AppText>
      <AppText>{endedText(waitingClockOut.deviceTimestamp)}</AppText>
      <AppText size="small" color={colors.muted}>
        {t("pendingHint")}
      </AppText>
    </View>
  ) : null;

  function statusCard() {
    if (activeEntry && emergencyRunning) {
      return (
        <View style={styles.emergencyCard} testID="home-status-emergency">
          <AppText weight="bold" size="large" color={colors.danger}>
            {t("emergencyRunning")}
          </AppText>
          {activeCallout ? (
            <AppText testID="home-emergency-timer" weight="semibold">
              {t("emergencyElapsed", { elapsed: formatElapsed(now - Date.parse(activeCallout.actualStartClick)) })}
            </AppText>
          ) : null}
          <AppText>{t("emergencyCompensatedFrom", { time: format.time(activeCallout?.compensatedStart ?? activeEntry.clockInAt) })}</AppText>
          <Button testID="home-emergency-end" label={t("emergencyEnd")} variant="danger" onPress={() => navigation.navigate("Emergency")} style={styles.cardButton} />
        </View>
      );
    }
    if (activeEntry) {
      const title = shiftTitle(activeEntry.shift);
      return (
        <View style={styles.activeCard} testID="home-status-on-shift">
          <AppText weight="bold" color={colors.success}>
            {t("activeLabel")}
          </AppText>
          <AppText weight="bold" size="title">
            {isolateAuto(title)}
          </AppText>
          <AppText color={colors.text}>{startedText(activeEntry.clockInAt)}</AppText>
          {waitingClockOutNotice ?? (
            <Button
              testID="home-clock-out"
              label={tc("clockOut")}
              variant="danger"
              onPress={() => navigation.navigate("ClockOut", { shiftTitle: title })}
              style={styles.cardButton}
            />
          )}
        </View>
      );
    }
    if (waitingClockIn) {
      // Clocked in on the phone, not yet on the server: no second clock-in, but clock-out works (it queues too when offline).
      const queuedShift = shifts.find((s) => s.id === waitingClockIn.shiftId);
      const title = shiftTitle(queuedShift);
      return (
        <View style={styles.waitingCard} testID="home-status-pending">
          <AppText weight="bold" color={colors.warning}>
            {t("pendingClockIn")}
          </AppText>
          <AppText weight="bold" size="title">
            {isolateAuto(title)}
          </AppText>
          <AppText>{startedText(waitingClockIn.deviceTimestamp)}</AppText>
          <AppText size="small" color={colors.muted}>
            {t("pendingHint")}
          </AppText>
          <Button
            testID="home-clock-out"
            label={tc("clockOut")}
            variant="danger"
            onPress={() => navigation.navigate("ClockOut", { shiftTitle: title })}
            style={styles.cardButton}
          />
        </View>
      );
    }
    if (waitingClockOut) return <View style={styles.waitingCard}>{waitingClockOutNotice}</View>;
    if (loaded) {
      return (
        <View style={styles.noActiveCard} testID="home-status-off-shift">
          <AppText size="large" color={colors.muted}>
            {t("noActive")}
          </AppText>
        </View>
      );
    }
    return null;
  }

  /** The Night Turan the API reports (current or next): its window. */
  function turanCard() {
    const turan = eligibility?.turanAssignment;
    if (!turan) return null;
    const nowMs = Date.now();
    const start = Date.parse(turan.startAt);
    const end = Date.parse(turan.endAt);
    if (!(end > nowMs)) return null;
    const label = start <= nowMs ? t("turanCurrent", { type: enumLabel("TuranType", turan.turanType) }) : t("turanUpcoming", { type: enumLabel("TuranType", turan.turanType) });
    return (
      <View style={styles.infoCard} testID="home-turan">
        <AppText weight="bold">{label}</AppText>
        <AppText>{rangeText(turan.startAt, turan.endAt)}</AppText>
      </View>
    );
  }

  /** Only when the API says a call-out may start now (and none is running). */
  function emergencyStartCard() {
    if (!eligibility?.eligible || activeCallout) return null;
    return (
      <View style={styles.emergencyStartCard}>
        <AppText>{t("emergencyAvailable")}</AppText>
        <Button testID="home-emergency-start" label={t("emergencyStart")} variant="danger" onPress={() => navigation.navigate("Emergency")} />
      </View>
    );
  }

  /** A card per ACTIVE temporary-supervisor assignment (none otherwise). */
  function supervisorCards() {
    const nowMs = Date.now();
    return supervisions
      .filter((assignment) => Date.parse(assignment.activatedAt) <= nowMs && nowMs < Date.parse(assignment.expiresAt))
      .map((assignment) => (
        <View key={assignment.id} style={styles.infoCard} testID="home-supervisor">
          <AppText weight="bold" color={colors.primary}>
            {t("supervisorTitle")}
          </AppText>
          <AppText>{t("supervisorShift", { shift: isolateAuto(shiftTitle(assignment.shift)) })}</AppText>
          <AppText color={colors.muted}>{t("supervisorUntil", { time: format.time(assignment.expiresAt) })}</AppText>
          <Button
            testID="home-supervisor-open"
            label={t("supervisorOpen")}
            variant="secondary"
            onPress={() => navigation.navigate("Supervisor", { assignmentId: assignment.id })}
          />
        </View>
      ));
  }

  function recentSection() {
    if (!loaded) return null;
    return (
      <View style={styles.recent} testID="home-recent">
        <View style={styles.recentHeader}>
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("recentTitle")}
          </AppText>
          <Button
            testID="home-recent-all"
            label={t("recentSeeAll")}
            accessibilityLabel={t("recentSeeAllLabel")}
            variant="link"
            onPress={() => navigation.navigate("History")}
          />
        </View>
        {recentEntries.length === 0 ? (
          <AppText color={colors.muted}>{t("recentEmpty")}</AppText>
        ) : (
          recentEntries.map((entry) => (
            <Pressable
              key={entry.id}
              testID="home-recent-entry"
              accessibilityRole="button"
              accessibilityHint={t("recentOpenHint")}
              onPress={() => navigation.navigate("HistoryDetail", { timeEntryId: entry.id })}
              style={({ pressed }) => [styles.recentCard, pressed && styles.pressed]}
            >
              <View style={styles.recentRow}>
                <AppText weight="semibold" style={styles.recentTitle}>
                  {isolateAuto(shiftTitle(entry.shift))}
                </AppText>
                <Badge label={enumLabel("TimeEntryStatus", entry.status)} color={STATUS_COLORS[entry.status] ?? colors.muted} />
              </View>
              <AppText color={colors.muted}>
                {`${format.businessDate(entry.businessDate)} · ${t("recentHours", { start: format.time(entry.clockInAt), end: format.time(entry.clockOutAt) })}`}
              </AppText>
            </Pressable>
          ))
        )}
      </View>
    );
  }

  const canClockIn = loaded && !activeEntry && !waitingClockIn;
  const errorView = error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRetry} /> : null;
  const unreadText = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <SafeAreaView style={styles.screen} testID="home-screen">
      {/* Two rows, so the brand never wraps on a narrow phone: brand and sign-out, then the role and the notifications. */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <AppText accessibilityRole="header" weight="bold" size="title" numberOfLines={1} style={styles.headerText}>
            {tApp("brand")}
          </AppText>
          <Button label={tc("signOut")} variant="link" onPress={() => setConfirmingSignOut(true)} style={styles.signOut} />
        </View>
        <View style={styles.headerRow}>
          {session?.role ? (
            <AppText color={colors.muted} style={styles.headerText}>
              {enumLabel("OrgRole", session.role)}
            </AppText>
          ) : (
            <View style={styles.headerText} />
          )}
          <Pressable
            testID="home-notifications"
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? t("notificationsUnread", { count: unreadCount }) : t("notifications")}
            onPress={() => navigation.navigate("Notifications")}
            style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
          >
            <AppText weight="semibold" color={colors.primary}>
              {t("notifications")}
            </AppText>
            {unreadCount > 0 ? (
              <View style={styles.unread} testID="home-unread-badge">
                <AppText size="small" weight="bold" color={colors.primaryText} align="center">
                  {unreadText}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {confirmingSignOut ? (
        <View style={styles.confirmCard} accessibilityRole="alert">
          <AppText weight="bold" size="large">
            {t("signOutConfirm")}
          </AppText>
          {pendingCount > 0 ? <AppText color={colors.warning}>{t("signOutPending", { count: pendingCount })}</AppText> : null}
          <Button label={t("signOutYes")} variant="danger" onPress={logout} />
          <Button label={tc("cancel")} variant="secondary" onPress={() => setConfirmingSignOut(false)} />
        </View>
      ) : null}

      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />

      {!loaded && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="home-shifts"
          data={loaded ? shifts : []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View>
              {errorView}
              {statusCard()}
              {emergencyStartCard()}
              {turanCard()}
              {supervisorCards()}
              {loaded ? (
                <AppText accessibilityRole="header" weight="bold" size="large" style={styles.listHeader}>
                  {t("yourShifts")}
                </AppText>
              ) : null}
            </View>
          }
          ListEmptyComponent={loaded ? <EmptyView title={t("noShifts")} hint={t("noShiftsHint")} /> : null}
          ListFooterComponent={recentSection()}
          renderItem={({ item, index }) => {
            const title = shiftTitle(item);
            const next = index === 0;
            return (
              <View style={[styles.shiftCard, next && styles.nextShiftCard]} testID={next ? "home-next-shift" : "home-shift"}>
                {next ? <Badge label={t("nextShift")} color={colors.primary} /> : null}
                <Pressable
                  testID={next ? "home-next-shift-details" : "home-shift-details"}
                  accessibilityRole="button"
                  accessibilityHint={t("shiftDetailsHint")}
                  onPress={() => navigation.navigate("ShiftDetails", { shiftId: item.id })}
                  style={({ pressed }) => [styles.shiftCardBody, pressed && styles.pressed]}
                >
                  <AppText weight="bold" size="large">
                    {isolateAuto(title)}
                  </AppText>
                  <AppText color={colors.muted}>{item.site?.name ? isolateAuto(item.site.name) : t("noSite")}</AppText>
                  <AppText>{format.date(item.scheduledStart)}</AppText>
                  <AppText>{t("shiftHours", { start: format.time(item.scheduledStart), end: format.time(item.scheduledEnd) })}</AppText>
                </Pressable>
                {canClockIn ? (
                  <Button
                    testID={next ? "home-next-shift-clock-in" : "home-shift-clock-in"}
                    label={tc("clockIn")}
                    accessibilityLabel={t("clockInFor", { shift: title })}
                    onPress={() => navigation.navigate("ClockIn", { shiftId: item.id, shiftTitle: title })}
                  />
                ) : null}
              </View>
            );
          }}
        />
      )}

      {/* Always reachable (loading, error, empty, loaded), and as large as every other button. */}
      <View style={styles.footer}>
        <Button testID="home-history" label={t("history")} variant="secondary" onPress={() => navigation.navigate("History")} style={styles.footerButton} />
        <Button testID="home-salary" label={t("salary")} variant="secondary" onPress={() => navigation.navigate("Salary")} style={styles.footerButton} />
      </View>
    </SafeAreaView>
  );
}

const card = { marginHorizontal: spacing.xl, marginBottom: spacing.lg, borderRadius: 16, padding: spacing.lg } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  headerText: { flexShrink: 1 },
  bell: { minHeight: TOUCH_TARGET, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  unread: { minWidth: 26, borderRadius: 13, paddingHorizontal: 6, backgroundColor: colors.danger, justifyContent: "center" },
  signOut: { minHeight: TOUCH_TARGET },
  pressed: { opacity: 0.8 },
  confirmCard: { ...card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger, gap: spacing.md },
  listContent: { paddingBottom: spacing.xl },
  activeCard: { ...card, backgroundColor: colors.successSoft, gap: spacing.xs },
  emergencyCard: { ...card, backgroundColor: colors.dangerSoft, gap: spacing.xs },
  emergencyStartCard: { ...card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger, gap: spacing.md },
  infoCard: { ...card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  waitingCard: { ...card, backgroundColor: colors.warningSoft, gap: spacing.xs },
  waitingNotice: { gap: spacing.xs, marginTop: spacing.sm },
  cardButton: { marginTop: spacing.md },
  noActiveCard: { ...card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  listHeader: { paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  shiftCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  nextShiftCard: { borderColor: colors.primary, borderWidth: 2 },
  shiftCardBody: { gap: 2 },
  recent: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  recentCard: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2, minHeight: TOUCH_TARGET },
  recentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  recentTitle: { flexShrink: 1 },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerButton: { flex: 1 },
});
