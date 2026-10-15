import { useCallback, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { AttendanceListItem } from "@fieldmaster/api-client";
import { Permission, type AttendanceFlag } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto } from "../components/LtrText";
import { RestrictedHint } from "../components/manager/RestrictedHint";
import { useFocusedRefresh } from "../components/manager/useFocusedRefresh";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Approvals">;

/** Entries per page of GET /attendance/entries?tab=PENDING. */
export const APPROVALS_PAGE_SIZE = 20;

/** Badge colour per attendance flag; anything else is grey. */
const FLAG_COLORS: Partial<Record<AttendanceFlag, string>> = {
  OUTSIDE_GEOFENCE_ATTEMPT: colors.warning,
  SUSPICIOUS_LOCATION: colors.danger,
  EMERGENCY: colors.danger,
  FLEXI_CHECK: colors.primary,
  TEMPORARY_POINT: colors.primary,
};

/** The loaded rows followed by a new page's, without one already shown (rows move between pages when entries are decided meanwhile). */
function appendPage(current: AttendanceListItem[], page: AttendanceListItem[]): AttendanceListItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...page.filter((item) => !seen.has(item.id))];
}

/**
 * The entries waiting for a manager (APPROVE_ATTENDANCE; the API limits them
 * to the member's projects): who, when, which shift, the clock-in and
 * clock-out times and duration, and the entry's flags. Twenty at a time, the
 * next page loading at the end of the list; tapping one opens its review.
 * Reloads from the first page whenever the screen gains focus (after a
 * decision on the review screen).
 */
export function ApprovalsScreen({ navigation }: Props) {
  const t = useTranslations("approvals");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const { can, restricted } = useAccess();
  const canApprove = can(Permission.APPROVE_ATTENDANCE);

  const [items, setItems] = useState<AttendanceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  /** Bumped by every first-page load: a page asked for before it is dropped. */
  const generation = useRef(0);
  /** A first page or a next page is on its way: no second next page meanwhile. */
  const busy = useRef(false);
  const page = useRef(1);
  const rows = useRef<AttendanceListItem[]>([]);

  const loadFirst = useCallback(async () => {
    if (!canApprove) return;
    const call = ++generation.current;
    busy.current = true;
    setLoadingMore(false);
    try {
      const answer = await client.listAttendanceEntries({ tab: "PENDING", pageSize: APPROVALS_PAGE_SIZE, page: 1 });
      if (call !== generation.current) return;
      page.current = 1;
      rows.current = answer.items;
      setItems(answer.items);
      setTotal(answer.total);
      setHasMore(answer.items.length > 0 && answer.items.length < answer.total);
      setMoreError(null);
      setError(null);
      setLoaded(true);
    } catch (cause) {
      if (call === generation.current) setError(cause ?? new Error());
    } finally {
      if (call === generation.current) busy.current = false;
    }
  }, [client, canApprove]);

  const loadMore = useCallback(async () => {
    if (busy.current || !hasMore) return;
    const call = generation.current;
    const next = page.current + 1;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const answer = await client.listAttendanceEntries({ tab: "PENDING", pageSize: APPROVALS_PAGE_SIZE, page: next });
      if (call !== generation.current) return;
      page.current = next;
      const merged = appendPage(rows.current, answer.items);
      rows.current = merged;
      setItems(merged);
      setTotal(answer.total);
      // An empty page ends the list even if the total says more (entries were decided meanwhile).
      setHasMore(answer.items.length > 0 && merged.length < answer.total);
    } catch (cause) {
      if (call === generation.current) setMoreError(cause ?? new Error());
    } finally {
      if (call === generation.current) {
        busy.current = false;
        setLoadingMore(false);
      }
    }
  }, [client, hasMore]);

  const onFocus = useCallback(() => void loadFirst(), [loadFirst]);
  useFocusedRefresh(onFocus);

  async function onRefresh() {
    setRefreshing(true);
    await loadFirst();
    setRefreshing(false);
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;
  const banner = <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />;

  if (!canApprove) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <EmptyView title={t("noPermission")} />
      </SafeAreaView>
    );
  }

  if (!loaded && !error) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        <LoadingView />
      </SafeAreaView>
    );
  }

  function renderItem({ item }: { item: AttendanceListItem }) {
    const site = item.shift.site?.name ?? null;
    const shift = isolateAuto(shiftTitle(item.shift));
    return (
      <Pressable
        testID={`approvals-row-${item.id}`}
        accessibilityRole="button"
        accessibilityHint={t("openHint")}
        onPress={() => navigation.navigate("AttendanceReview", { timeEntryId: item.id })}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <View style={styles.titleRow}>
          <AppText weight="bold" size="large" style={styles.flexShrink}>
            {isolateAuto(item.worker.fullLegalName)}
          </AppText>
          {item.status === "CORRECTION_REQUESTED" ? <Badge label={enumLabel("TimeEntryStatus", item.status)} color={colors.warning} /> : null}
        </View>
        <AppText>{format.businessDate(item.businessDate)}</AppText>
        <AppText>{site ? t("shiftAtSite", { shift, site: isolateAuto(site) }) : shift}</AppText>
        <AppText color={colors.muted}>{t("hours", { start: format.time(item.clockInAt), end: format.time(item.clockOutAt) })}</AppText>
        <AppText color={colors.muted}>{t("duration", { duration: format.minutes(item.rawDurationMinutes) })}</AppText>
        {item.flags.length > 0 ? (
          <View style={styles.flags} testID={`approvals-flags-${item.id}`}>
            {item.flags.map((flag) => (
              <Badge key={flag} label={enumLabel("AttendanceFlag", flag)} color={FLAG_COLORS[flag] ?? colors.muted} />
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.screen} testID="approvals">
      {header}
      {banner}
      <FlatList
        testID="approvals-list"
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        initialNumToRender={APPROVALS_PAGE_SIZE}
        onEndReachedThreshold={0.5}
        // After a failed page only the retry button asks again (no automatic loop on every scroll).
        onEndReached={() => {
          if (!moreError) void loadMore();
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {restricted ? (
              <View style={styles.inset}>
                <RestrictedHint />
              </View>
            ) : null}
            {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRefresh} /> : null}
            {loaded && items.length > 0 ? (
              <AppText color={colors.muted} style={styles.inset} testID="approvals-total">
                {t("total", { count: format.number(total) })}
              </AppText>
            ) : null}
          </View>
        }
        ListEmptyComponent={loaded ? <EmptyView title={t("empty")} hint={t("emptyHint")} /> : null}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.more} accessibilityRole="progressbar" accessibilityLabel={t("loadingMore")}>
              <ActivityIndicator color={colors.primary} />
              <AppText color={colors.muted}>{t("loadingMore")}</AppText>
            </View>
          ) : moreError ? (
            <ErrorView message={`${t("loadMoreError")}\n${errorMessage(moreError)}`} onRetry={() => void loadMore()} />
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl * 2 },
  listHeader: { gap: spacing.sm, paddingBottom: spacing.sm },
  inset: { marginHorizontal: spacing.xl },
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
  pressed: { opacity: 0.8 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
});
