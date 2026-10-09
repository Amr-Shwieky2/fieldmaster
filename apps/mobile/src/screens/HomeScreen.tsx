import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { Shift, TimeEntry } from "@fieldmaster/api-client";
import { toBusinessDay } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { isolateAuto } from "../components/LtrText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import type { QueuedEvent } from "../lib/offline-queue";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const UPCOMING_STATUSES = new Set(["PUBLISHED", "OPEN", "ACTIVE"]);


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

  const [refreshing, setRefreshing] = useState(false);
  /** The last load failure (rendered in Arabic at render time, never the API's English text). */
  const [error, setError] = useState<unknown>(null);
  /** True once a load succeeded: a later failure keeps showing that data under the error. */
  const [loaded, setLoaded] = useState(false);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [active, allShifts] = await Promise.all([client.listTimeEntries({ status: "ACTIVE" }), client.listShifts()]);
      setActiveEntry(active[0] ?? null);
      setShifts(
        allShifts
          .filter((s) => UPCOMING_STATUSES.has(s.status))
          .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()),
      );
      setLoaded(true);
    } catch (cause) {
      setError(cause ?? new Error());
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
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
    if (loaded && activeEntry) {
      return (
        <View style={styles.activeCard}>
          <AppText weight="bold" color={colors.success}>
            {t("activeLabel")}
          </AppText>
          <AppText weight="bold" size="title">
            {isolateAuto(shiftTitle(activeEntry.shift))}
          </AppText>
          <AppText color={colors.text}>{startedText(activeEntry.clockInAt)}</AppText>
          {waitingClockOutNotice ?? (
            <Button label={tc("clockOut")} variant="danger" onPress={() => navigation.navigate("ClockOut")} style={styles.cardButton} />
          )}
        </View>
      );
    }
    if (waitingClockIn) {
      // Clocked in on the phone, not yet on the server: no second clock-in, but clock-out works (it queues too when offline).
      const queuedShift = shifts.find((s) => s.id === waitingClockIn.shiftId);
      return (
        <View style={styles.waitingCard}>
          <AppText weight="bold" color={colors.warning}>
            {t("pendingClockIn")}
          </AppText>
          <AppText weight="bold" size="title">
            {isolateAuto(shiftTitle(queuedShift))}
          </AppText>
          <AppText>{startedText(waitingClockIn.deviceTimestamp)}</AppText>
          <AppText size="small" color={colors.muted}>
            {t("pendingHint")}
          </AppText>
          <Button label={tc("clockOut")} variant="danger" onPress={() => navigation.navigate("ClockOut")} style={styles.cardButton} />
        </View>
      );
    }
    if (waitingClockOut) return <View style={styles.waitingCard}>{waitingClockOutNotice}</View>;
    if (loaded) {
      return (
        <View style={styles.noActiveCard}>
          <AppText size="large" color={colors.muted}>
            {t("noActive")}
          </AppText>
        </View>
      );
    }
    return null;
  }

  const canClockIn = loaded && !activeEntry && !waitingClockIn;
  const errorView = error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRetry} /> : null;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText accessibilityRole="header" weight="bold" size="title">
            {tApp("brand")}
          </AppText>
          {session?.role ? <AppText color={colors.muted}>{enumLabel("OrgRole", session.role)}</AppText> : null}
        </View>
        <Button label={tc("signOut")} variant="link" onPress={() => setConfirmingSignOut(true)} style={styles.signOut} />
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
              {loaded ? (
                <AppText accessibilityRole="header" weight="bold" size="large" style={styles.listHeader}>
                  {t("yourShifts")}
                </AppText>
              ) : null}
            </View>
          }
          ListEmptyComponent={loaded ? <EmptyView title={t("noShifts")} hint={t("noShiftsHint")} /> : null}
          renderItem={({ item }) => {
            const title = shiftTitle(item);
            return (
              <View style={styles.shiftCard}>
                <View style={styles.shiftCardBody}>
                  <AppText weight="bold" size="large">
                    {isolateAuto(title)}
                  </AppText>
                  <AppText color={colors.muted}>{item.site?.name ? isolateAuto(item.site.name) : t("noSite")}</AppText>
                  <AppText>{format.date(item.scheduledStart)}</AppText>
                  <AppText>{t("shiftHours", { start: format.time(item.scheduledStart), end: format.time(item.scheduledEnd) })}</AppText>
                </View>
                {canClockIn ? (
                  <Button
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
        <Button label={t("history")} variant="secondary" onPress={() => navigation.navigate("History")} />
      </View>
    </SafeAreaView>
  );
}

const card = { marginHorizontal: spacing.xl, marginBottom: spacing.lg, borderRadius: 16, padding: spacing.lg } as const;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerText: { flexShrink: 1 },
  signOut: { minHeight: TOUCH_TARGET },
  confirmCard: { ...card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.danger, gap: spacing.md },
  listContent: { paddingBottom: spacing.xl },
  activeCard: { ...card, backgroundColor: colors.successSoft, gap: spacing.xs },
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
  shiftCardBody: { gap: 2 },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
