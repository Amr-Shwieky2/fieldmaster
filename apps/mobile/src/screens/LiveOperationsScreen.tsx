import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { OperationsSnapshot } from "@fieldmaster/api-client";
import { toBusinessDay } from "@fieldmaster/i18n";
import { Permission } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto } from "../components/LtrText";
import { LiveOperationsMap } from "../components/manager/LiveOperationsMap";
import { RestrictedHint } from "../components/manager/RestrictedHint";
import { useFocusedRefresh } from "../components/manager/useFocusedRefresh";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useCodeMessage, useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "LiveOperations">;

/** The snapshot is read again this often while the screen is on screen. */
export const LIVE_OPERATIONS_REFRESH_MS = 30_000;

type SegmentKey = "onShift" | "late" | "alerts";

type OnShiftItem = OperationsSnapshot["workersOnShift"][number];
type LateItem = OperationsSnapshot["lateWorkers"][number];
type RejectedItem = OperationsSnapshot["recentRejectedAttempts"][number];
type SuspiciousItem = OperationsSnapshot["suspiciousLocations"][number];

type AlertRow = { kind: "rejected"; key: string; at: number; item: RejectedItem } | { kind: "suspicious"; key: string; at: number; item: SuspiciousItem };
type Row = { kind: "onShift"; key: string; item: OnShiftItem } | { kind: "late"; key: string; item: LateItem } | AlertRow;

const SEGMENTS: readonly SegmentKey[] = ["onShift", "late", "alerts"];

const timestamp = (value: string) => Date.parse(value) || 0;

/** The rows of one segment; the site alerts (refused attempts and suspicious locations) newest first. */
function rowsFor(snapshot: OperationsSnapshot, segment: SegmentKey): Row[] {
  switch (segment) {
    case "onShift":
      return snapshot.workersOnShift.map((item) => ({ kind: "onShift", key: `on-shift-${item.timeEntryId}`, item }));
    case "late":
      return snapshot.lateWorkers.map((item) => ({ kind: "late", key: `late-${item.worker.id}-${item.shift.id}`, item }));
    case "alerts": {
      const alerts: AlertRow[] = [
        ...snapshot.recentRejectedAttempts.map((item) => ({ kind: "rejected" as const, key: `rejected-${item.id}`, at: timestamp(item.at), item })),
        ...snapshot.suspiciousLocations.map((item) => ({ kind: "suspicious" as const, key: `suspicious-${item.clockEventId}`, at: timestamp(item.at), item })),
      ];
      return alerts.sort((a, b) => b.at - a.at);
    }
  }
}

/**
 * The live operations of the mobile manager mode (VIEW_OPERATIONS, no money):
 * the map of the sites and the workers on shift, then three lists — who is on
 * shift now, who is late, and the site alerts (refused clock attempts with
 * the reason the worker saw, and suspicious locations). The `focus` param
 * picks the list shown first. Reloads on focus, on pull and every 30 seconds
 * while on screen; the API already limits everything to the member's
 * projects.
 */
export function LiveOperationsScreen({ navigation, route }: Props) {
  const t = useTranslations("liveOperations");
  const tc = useTranslations("common");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const { can, restricted } = useAccess();
  const canView = can(Permission.VIEW_OPERATIONS);
  // An entry's review needs the attendance evidence (VIEW_ATTENDANCE): without it the rows are not links.
  const canOpenEntries = can(Permission.VIEW_ATTENDANCE);
  const focus = route.params?.focus;

  const [segment, setSegment] = useState<SegmentKey>(focus ?? "onShift");
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  // Opened again with another focus (e.g. from a notification): show that list.
  useEffect(() => {
    if (focus) setSegment(focus);
  }, [focus]);

  const load = useCallback(async () => {
    if (!canView) return;
    const call = ++latest.current;
    try {
      const next = await client.getOperationsLive();
      if (call !== latest.current) return;
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      if (call === latest.current) setError(cause ?? new Error());
    }
  }, [client, canView]);

  const onFocus = useCallback(() => void load(), [load]);
  useFocusedRefresh(onFocus, { intervalMs: LIVE_OPERATIONS_REFRESH_MS });

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const openEntry = useCallback((timeEntryId: string) => navigation.navigate("AttendanceReview", { timeEntryId }), [navigation]);
  const rows = useMemo(() => (snapshot ? rowsFor(snapshot, segment) : []), [snapshot, segment]);

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;
  const banner = <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />;

  if (!canView) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <EmptyView title={t("noPermission")} />
      </SafeAreaView>
    );
  }

  if (!snapshot && !error) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        <LoadingView />
      </SafeAreaView>
    );
  }

  const today = toBusinessDay(Date.now());
  /** "10:30" today; with the date for another day (a night shift, an alert of yesterday). */
  const timeText = (value: string | null) => (value && toBusinessDay(value) !== today ? format.dateTime(value) : format.time(value));
  const segmentLabels: Record<SegmentKey, string> = { onShift: t("segmentOnShift"), late: t("segmentLate"), alerts: t("segmentAlerts") };
  const segmentCounts: Record<SegmentKey, number> = snapshot
    ? {
        onShift: snapshot.workersOnShift.length,
        late: snapshot.lateWorkers.length,
        alerts: snapshot.recentRejectedAttempts.length + snapshot.suspiciousLocations.length,
      }
    : { onShift: 0, late: 0, alerts: 0 };
  const emptyTitles: Record<SegmentKey, string> = { onShift: t("onShiftEmpty"), late: t("lateEmpty"), alerts: t("alertsEmpty") };

  function renderRow(row: Row) {
    const name = (person: { fullLegalName: string }) => (
      <AppText weight="bold" size="large" style={styles.flexShrink}>
        {isolateAuto(person.fullLegalName)}
      </AppText>
    );
    const shiftLine = (shift: { title: string; shiftType: string }) => <AppText>{t("shift", { shift: isolateAuto(shiftTitle(shift)) })}</AppText>;

    switch (row.kind) {
      case "onShift": {
        const { item } = row;
        const position = item.position;
        return (
          <RowCard testID={`live-on-shift-${item.timeEntryId}`} hint={t("openHint")} onPress={canOpenEntries ? () => openEntry(item.timeEntryId) : undefined}>
            <View style={styles.titleRow}>
              {name(item.worker)}
              {item.isEmergency ? <Badge label={tc("emergencyCallout")} color={colors.danger} /> : null}
            </View>
            {shiftLine(item.shift)}
            <AppText color={colors.muted}>{t("since", { time: timeText(item.clockInAt) })}</AppText>
            <AppText color={colors.muted}>{t("openFor", { duration: format.minutes(item.openMinutes) })}</AppText>
            {!position ? (
              <AppText size="small" color={colors.muted}>
                {t("noPosition")}
              </AppText>
            ) : position.locationValidationStatus !== "PASSED" ? (
              <AppText size="small" weight="semibold" color={colors.warning}>
                {t("positionStatus", { status: enumLabel("LocationValidationStatus", position.locationValidationStatus) })}
              </AppText>
            ) : null}
          </RowCard>
        );
      }
      case "late": {
        const { item } = row;
        return (
          <RowCard testID={`live-late-${item.worker.id}-${item.shift.id}`}>
            {name(item.worker)}
            {shiftLine(item.shift)}
            <AppText weight="semibold" color={colors.warning}>
              {t("lateBy", { duration: format.minutes(item.lateMinutes) })}
            </AppText>
            <AppText color={colors.muted}>{t("lateStart", { time: timeText(item.scheduledStart) })}</AppText>
          </RowCard>
        );
      }
      case "rejected": {
        const { item } = row;
        const timeEntryId = item.timeEntryId;
        // The message the worker saw for the code, with the distance / accuracy when the attempt has them.
        const reason = codeMessage(item.code, {
          distanceMeters: item.distanceMeters,
          allowedRadiusMeters: item.allowedRadiusMeters,
          accuracyMeters: item.accuracyMeters,
          requiredMeters: item.requiredAccuracyMeters,
        });
        return (
          <RowCard testID={`live-rejected-${item.id}`} hint={t("openHint")} onPress={canOpenEntries && timeEntryId ? () => openEntry(timeEntryId) : undefined}>
            <View style={styles.titleRow}>
              {name(item.worker)}
              <Badge label={t("rejectedBadge")} color={colors.warning} />
            </View>
            <AppText weight="semibold">{t("rejectedWhat", { event: enumLabel("ClockEventType", item.eventType) })}</AppText>
            <AppText>{reason ? t("rejectedReason", { reason }) : t("rejectedNoReason")}</AppText>
            {shiftLine(item.shift)}
            <AppText color={colors.muted}>{t("at", { time: timeText(item.at) })}</AppText>
          </RowCard>
        );
      }
      case "suspicious": {
        const { item } = row;
        const status = item.mockLocationSuspected ? t("mock") : enumLabel("LocationValidationStatus", item.locationValidationStatus);
        return (
          <RowCard testID={`live-suspicious-${item.clockEventId}`} hint={t("openHint")} onPress={canOpenEntries ? () => openEntry(item.timeEntryId) : undefined}>
            <View style={styles.titleRow}>
              {name(item.worker)}
              <Badge label={item.mockLocationSuspected ? t("mock") : t("suspiciousBadge")} color={colors.danger} />
            </View>
            <AppText weight="semibold">{t("suspiciousWhat", { event: enumLabel("ClockEventType", item.eventType), status })}</AppText>
            {shiftLine(item.shift)}
            <AppText color={colors.muted}>{t("suspiciousWhen", { origin: enumLabel("EventOrigin", item.origin), time: timeText(item.at) })}</AppText>
          </RowCard>
        );
      }
    }
  }

  return (
    <SafeAreaView style={styles.screen} testID="live-operations">
      {header}
      {banner}
      <FlatList
        testID="live-operations-list"
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {restricted ? (
              <View style={styles.inset}>
                <RestrictedHint />
              </View>
            ) : null}
            {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRefresh} /> : null}
            {snapshot ? <LiveOperationsMap snapshot={snapshot} onOpenEntry={canOpenEntries ? openEntry : undefined} /> : null}
            {snapshot ? (
              <AppText size="small" color={colors.muted} style={styles.inset}>
                {t("updatedAt", { time: format.time(snapshot.generatedAt) })}
              </AppText>
            ) : null}
            {snapshot ? (
              <View style={styles.segments} accessibilityRole="tablist" testID="live-segments">
                {SEGMENTS.map((key) => {
                  const selected = key === segment;
                  return (
                    <Pressable
                      key={key}
                      testID={`live-segment-${key}`}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      accessibilityLabel={t("segmentLabel", { label: segmentLabels[key], count: format.number(segmentCounts[key]) })}
                      onPress={() => setSegment(key)}
                      style={({ pressed }) => [styles.segment, selected && styles.segmentSelected, pressed && styles.pressed]}
                    >
                      <AppText weight="semibold" align="center" color={selected ? colors.primaryText : colors.text}>
                        {segmentLabels[key]}
                      </AppText>
                      <AppText weight="bold" align="center" color={selected ? colors.primaryText : colors.muted}>
                        {format.number(segmentCounts[key])}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={snapshot ? <EmptyView title={emptyTitles[segment]} /> : null}
        renderItem={({ item }) => renderRow(item)}
      />
    </SafeAreaView>
  );
}

/** A list row: a large button to the entry's review when `onPress` is given, plain text otherwise. */
function RowCard({ children, onPress, hint, testID }: { children: ReactNode; onPress?: () => void; hint?: string; testID?: string }) {
  if (!onPress) {
    return (
      <View style={styles.card} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityHint={hint} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl * 2 },
  listHeader: { gap: spacing.md, paddingBottom: spacing.md },
  inset: { marginHorizontal: spacing.xl },
  segments: { flexDirection: "row", gap: spacing.sm, marginHorizontal: spacing.xl },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  segmentSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.8 },
  card: {
    minHeight: TOUCH_TARGET,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
    padding: spacing.lg,
    gap: 2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
});
