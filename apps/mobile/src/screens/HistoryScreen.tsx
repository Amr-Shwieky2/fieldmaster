import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { TimeEntry } from "@fieldmaster/api-client";
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

export function HistoryScreen({ navigation }: Props) {
  const t = useTranslations("history");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const { queue } = useOfflineSync();

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  /** The last load failure (rendered in Arabic at render time, never the API's English text). */
  const [error, setError] = useState<unknown>(null);
  /** True once a load succeeded: a later failure keeps showing that data under the error. */
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const items = await client.listTimeEntries();
      setEntries([...items].sort(newestFirst));
      setLoaded(true);
    } catch (cause) {
      setError(cause ?? new Error());
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  // A clock event saved on the phone appears in the history once it has synced: reload then.
  const waitingCount = queue.filter((e) => e.localStatus === "PENDING" || e.localStatus === "SYNCING").length;
  const previousWaitingCount = useRef(waitingCount);
  useEffect(() => {
    const synced = waitingCount < previousWaitingCount.current;
    previousWaitingCount.current = waitingCount;
    if (!synced) return;
    if (loaded) setRefreshing(true);
    load();
  }, [waitingCount, loaded, load]);

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  function onRetry() {
    // Without data, clearing the error brings back the full loading state; with data the list stays and the spinner shows on top.
    if (loaded) setRefreshing(true);
    load();
  }

  const errorView = error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRetry} /> : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />

      {!loaded && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="history-list"
          data={loaded ? entries : []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListHeaderComponent={errorView}
          ListEmptyComponent={loaded ? <EmptyView title={t("empty")} /> : null}
          renderItem={({ item }) => {
            const running = item.status === "ACTIVE";
            return (
              <View style={styles.card}>
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
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },
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
});
