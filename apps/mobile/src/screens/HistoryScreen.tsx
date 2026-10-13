import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { TimeEntry } from "@fieldmaster/api-client";
import { toBusinessDay } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { isolateAuto } from "../components/LtrText";
import { Badge } from "../components/Badge";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "History">;

/** Badge colour per TimeEntryStatus; anything else is grey. */
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: colors.primary,
  PENDING_APPROVAL: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.danger,
  CORRECTION_REQUESTED: colors.warning,
};

const timeOf = (value: string | null) => (value ? new Date(value).getTime() : 0);

/** Newest first: by business day, then by clock-in time within the same day. */
function newestFirst(a: TimeEntry, b: TimeEntry): number {
  const byDay = new Date(b.businessDate).getTime() - new Date(a.businessDate).getTime();
  return byDay !== 0 ? byDay : timeOf(b.clockInAt) - timeOf(a.clockInAt);
}

/** `YYYY-MM` of a business date (already an Asia/Jerusalem calendar day). */
const monthOf = (entry: TimeEntry) => entry.businessDate.slice(0, 7);

type Row = { kind: "month"; yearMonth: string } | { kind: "entry"; entry: TimeEntry };

/** `count` months back from this one (Asia/Jerusalem), newest first: ["2026-10", "2026-09", ...]. */
export function lastMonths(count: number, now: Date = new Date()): string[] {
  const today = toBusinessDay(now) ?? now.toISOString().slice(0, 10);
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return result;
}

const MANAGER_ROLES = new Set(["OWNER", "FIELD_MANAGER"]);

/**
 * The worker's own attendance, newest first and grouped by month, with a
 * month picker ("all months" or one month) and a status badge per entry.
 * Tapping an entry opens its details.
 *
 * Only the caller's own records: a worker's GET /time-entries is scoped to
 * them by the API; a manager who also tracks time asks for their own worker
 * profile only. The list is also filtered on the phone, so another worker's
 * record is never shown, whatever the API answers.
 */
export function HistoryScreen({ navigation }: Props) {
  const t = useTranslations("history");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client, session } = useAuth();
  const { queue } = useOfflineSync();
  const ownWorkerProfileId = session?.workerProfileId ?? null;
  const role = session?.role ?? null;

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  /** The last load failure (rendered in Arabic at render time, never the API's English text). */
  const [error, setError] = useState<unknown>(null);
  /** True once a load succeeded: a later failure keeps showing that data under the error. */
  const [loaded, setLoaded] = useState(false);
  /** The months that have records in the "every month" list (for the picker). */
  const [knownMonths, setKnownMonths] = useState<string[]>([]);
  /** null: every month (the newest records); otherwise one month, asked from the API with `month`. */
  const [selected, setSelected] = useState<string | null>(null);
  /** The month shown now (the list keeps the previous one while the next one loads). */
  const [shownMonth, setShownMonth] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  /** Only the latest request may change the list (a month picked while another one was still loading). */
  const latestRequest = useRef(0);

  const load = useCallback(
    async (month: string | null) => {
      const request = ++latestRequest.current;
      setError(null);
      try {
        // A worker's list is theirs already; a manager's would be everyone's, so they ask for their own profile only.
        const asManager = role !== null && MANAGER_ROLES.has(role);
        let items: TimeEntry[] = [];
        if (!asManager || ownWorkerProfileId) {
          const filters = { ...(asManager && ownWorkerProfileId ? { workerProfileId: ownWorkerProfileId } : {}), ...(month ? { month } : {}) };
          items = Object.keys(filters).length > 0 ? await client.listTimeEntries(filters) : await client.listTimeEntries();
        }
        if (request !== latestRequest.current) return;
        const own = items.filter(
          (item) => (!ownWorkerProfileId || item.workerProfileId === ownWorkerProfileId) && (month === null || monthOf(item) === month),
        );
        const sorted = [...own].sort(newestFirst);
        setEntries(sorted);
        setShownMonth(month);
        if (month === null) setKnownMonths([...new Set(sorted.map(monthOf))]);
        setLoaded(true);
      } catch (cause) {
        if (request === latestRequest.current) setError(cause ?? new Error());
      } finally {
        if (request === latestRequest.current) {
          setRefreshing(false);
          setSwitching(false);
        }
      }
    },
    [client, ownWorkerProfileId, role],
  );

  useEffect(() => {
    load(selected);
  }, [load, selected]);

  // A clock event saved on the phone appears in the history once it has synced: reload then.
  const waitingCount = queue.filter((e) => e.localStatus === "PENDING" || e.localStatus === "SYNCING").length;
  const previousWaitingCount = useRef(waitingCount);
  useEffect(() => {
    const synced = waitingCount < previousWaitingCount.current;
    previousWaitingCount.current = waitingCount;
    if (!synced) return;
    if (loaded) setRefreshing(true);
    load(selected);
  }, [waitingCount, loaded, load, selected]);

  /** The months offered: the last twelve (this one first), and any older month the list has. */
  const months = useMemo(() => {
    const recent = lastMonths(12);
    return [...new Set([...recent, ...knownMonths])].sort((a, b) => b.localeCompare(a));
  }, [knownMonths]);

  function choose(month: string | null) {
    if (month === selected) return;
    setSwitching(true);
    setSelected(month);
  }

  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    let current: string | null = null;
    for (const entry of entries) {
      if (monthOf(entry) !== current) {
        current = monthOf(entry);
        result.push({ kind: "month", yearMonth: current });
      }
      result.push({ kind: "entry", entry });
    }
    return result;
  }, [entries]);

  function onRefresh() {
    setRefreshing(true);
    load(selected);
  }

  function onRetry() {
    // Without data, clearing the error brings back the full loading state; with data the list stays and the spinner shows on top.
    if (loaded) setRefreshing(true);
    load(selected);
  }

  const errorView = error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRetry} /> : null;
  // No picker before anything was recorded at all.
  const picker =
    loaded && (knownMonths.length > 0 || selected !== null) ? (
      <ScrollView
        horizontal
        accessibilityRole="tablist"
        accessibilityLabel={t("monthPickerLabel")}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.picker}
      >
        <MonthChip label={t("allMonths")} selected={selected === null} onPress={() => choose(null)} />
        {months.map((value) => (
          <MonthChip key={value} label={format.month(value)} selected={selected === value} onPress={() => choose(value)} />
        ))}
      </ScrollView>
    ) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />

      {!loaded && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="history-list"
          data={loaded && !switching ? rows : []}
          keyExtractor={(row) => (row.kind === "month" ? `month-${row.yearMonth}` : row.entry.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListHeaderComponent={
            <>
              {errorView}
              {picker}
              {switching ? <LoadingView /> : null}
            </>
          }
          ListEmptyComponent={loaded && !switching ? <EmptyView title={shownMonth ? t("monthEmpty") : t("empty")} /> : null}
          renderItem={({ item: row }) => {
            if (row.kind === "month") {
              return (
                <AppText accessibilityRole="header" weight="bold" color={colors.muted} style={styles.monthHeader}>
                  {format.month(row.yearMonth)}
                </AppText>
              );
            }
            const item = row.entry;
            const running = item.status === "ACTIVE";
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityHint={t("openDetailsHint")}
                onPress={() => navigation.navigate("HistoryDetail", { timeEntryId: item.id })}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.cardRow}>
                  <AppText weight="bold" size="large" style={styles.cardTitle}>
                    {isolateAuto(shiftTitle(item.shift))}
                  </AppText>
                  <Badge label={enumLabel("TimeEntryStatus", item.status)} color={STATUS_COLORS[item.status] ?? colors.muted} />
                </View>
                <AppText>{format.businessDate(item.businessDate)}</AppText>
                <AppText>
                  {running && !item.clockOutAt
                    ? t("hoursOpen", { start: format.time(item.clockInAt) })
                    : t("hours", { start: format.time(item.clockInAt), end: format.time(item.clockOutAt) })}
                </AppText>
                {running ? null : <AppText weight="semibold">{t("worked", { duration: format.minutes(item.rawDurationMinutes) })}</AppText>}
                {item.dailySummary?.text ? (
                  <View style={styles.summary}>
                    <AppText>{t("summary", { text: isolateAuto(item.dailySummary.text) })}</AppText>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function MonthChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
    >
      <AppText weight="semibold" color={selected ? colors.primaryText : colors.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },
  picker: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.primary },
  monthHeader: { marginHorizontal: spacing.xl, marginBottom: spacing.sm, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cardTitle: { flexShrink: 1 },
  summary: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { opacity: 0.85 },
});
