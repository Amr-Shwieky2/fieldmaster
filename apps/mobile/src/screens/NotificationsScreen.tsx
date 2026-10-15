import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { NotificationItem } from "@fieldmaster/api-client";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { NotificationCard } from "../components/notifications/NotificationCard";
import { NotificationTabs, type NotificationTab } from "../components/notifications/NotificationTabs";
import { groupNotifications, splitByAction, type NotificationRow } from "../components/notifications/notification-rows";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useErrorMessage, useFormat } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { navigateToTarget, resolveAvailableTarget, targetForInAppNotification } from "../lib/linking";
import { useNotifications } from "../lib/notifications-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

/** A stack screen ("Notifications"); also the «الإشعارات» tab of the manager home (ManagerTabs), with that tab's navigation. */
type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;
type Navigation = Props["navigation"];

/** The slice of a navigator this screen reads its surroundings from (missing parts: a test's stand-in). */
interface NavigatorLike {
  getState?: () => { type?: string; routeNames?: readonly string[] } | undefined;
  getParent?: () => NavigatorLike | undefined;
}

const newestFirst = (a: NotificationItem, b: NotificationItem) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/** Every route this screen can open: its own navigator's and, inside the manager tabs, the root stack's. Null when unknown (any). */
function reachableRouteNames(navigation: NavigatorLike): string[] | null {
  const own = navigation.getState?.()?.routeNames;
  if (!own) return null;
  const names = [...own];
  for (let parent = navigation.getParent?.(); parent; parent = parent.getParent?.()) names.push(...(parent.getState?.()?.routeNames ?? []));
  return names;
}

/**
 * Runs `effect` now when the screen is focused, and again each time it comes
 * back into focus (back from an action screen, the tab selected again).
 * Outside a navigator (a test's stand-in) it runs once.
 */
function useOnFocus(navigation: Navigation, effect: () => void) {
  useEffect(() => {
    let focused = navigation.isFocused?.() ?? true;
    if (focused) effect();
    const offFocus = navigation.addListener?.("focus", () => {
      // The first focus event can follow the mount, which already ran the effect.
      if (focused) return;
      focused = true;
      effect();
    });
    const offBlur = navigation.addListener?.("blur", () => {
      focused = false;
    });
    return () => {
      offFocus?.();
      offBlur?.();
    };
  }, [navigation, effect]);
}

/**
 * The signed-in member's notifications, newest first, in Arabic built from
 * each one's type and data (the stored English title/body are never shown);
 * several about the same subject are one row («×N»).
 *
 * A member who manages (mobile manager mode) sees two tabs: «تحتاج إجراء»
 * (each row says what it asks for, the settled ones below the open ones with
 * who settled them) and «للعلم». Tapping a row marks it read and opens its
 * screen: the action's screen for an actionable one, otherwise the same
 * mapping as a tapped push notification; "mark all read" clears the badge.
 */
export function NotificationsScreen({ navigation }: Props) {
  const t = useTranslations("notifications");
  const tc = useTranslations("common");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { isManager } = useAccess();
  const { report } = useNotifications();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<"markReadFailed" | "markAllFailed" | null>(null);
  const [tab, setTab] = useState<NotificationTab>("action");
  const latestLoad = useRef(0);

  const show = useCallback(
    (next: NotificationItem[]) => {
      setItems(next);
      report(next);
    },
    [report],
  );

  const load = useCallback(async () => {
    // A reload on focus can overlap a pull-to-refresh: only the latest answer counts.
    const call = ++latestLoad.current;
    setError(null);
    try {
      const list = await client.listNotifications();
      if (call !== latestLoad.current) return;
      show([...list].sort(newestFirst));
      setLoaded(true);
    } catch (cause) {
      if (call !== latestLoad.current) return;
      setError(cause ?? new Error());
    } finally {
      if (call === latestLoad.current) setRefreshing(false);
    }
  }, [client, show]);

  const reload = useCallback(() => void load(), [load]);
  useOnFocus(navigation, reload);

  const unread = useMemo(() => items.filter((item) => item.readAt === null).length, [items]);
  const rows = useMemo(() => groupNotifications(items), [items]);
  const split = useMemo(() => splitByAction(rows), [rows]);
  const openCount = useMemo(() => split.action.filter((row) => row.handled === null).length, [split]);
  const visibleRows = isManager ? split[tab] : rows;

  async function open(row: NotificationRow) {
    setActionError(null);
    const unreadIds = new Set(row.items.filter((n) => n.readAt === null).map((n) => n.id));
    if (unreadIds.size > 0) {
      const readAt = new Date().toISOString();
      const before = items;
      show(items.map((n) => (unreadIds.has(n.id) ? { ...n, readAt } : n)));
      try {
        await Promise.all([...unreadIds].map((id) => client.markNotificationRead(id)));
      } catch {
        show(before);
        setActionError("markReadFailed");
        return;
      }
    }
    const target = resolveAvailableTarget(
      targetForInAppNotification({ type: row.latest.type, dataJson: row.latest.dataJson, subjectId: row.subjectId, action: row.action }),
      reachableRouteNames(navigation as unknown as NavigatorLike),
    );
    // Leads nowhere else (or to a screen this member's app does not have): the list is already here.
    if (target.name === "Notifications") return;
    navigateToTarget(navigation, target);
  }

  async function markAll() {
    setActionError(null);
    setMarkingAll(true);
    try {
      await client.markAllNotificationsRead();
      const readAt = new Date().toISOString();
      show(items.map((n) => (n.readAt === null ? { ...n, readAt } : n)));
    } catch {
      setActionError("markAllFailed");
    } finally {
      setMarkingAll(false);
    }
  }

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  function onRetry() {
    if (loaded) setRefreshing(true);
    void load();
  }

  // The «الإشعارات» tab of the manager home has no back button; the stack screen has one when it can go back.
  const asTab = (navigation.getState?.() as { type?: string } | undefined)?.type === "tab";
  const canGoBack = !asTab && (navigation.canGoBack?.() ?? true);

  const header = (
    <View style={styles.headerArea}>
      {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRetry} /> : null}
      {loaded && items.length > 0 ? (
        <View style={styles.toolbar}>
          <AppText color={colors.muted} aria-live="polite">
            {unread > 0 ? t("unreadCount", { count: format.number(unread) }) : t("allRead")}
          </AppText>
          <Button label={t("markAllRead")} variant="secondary" busy={markingAll} busyLabel={t("markingAllRead")} disabled={unread === 0} onPress={markAll} />
        </View>
      ) : null}
      {actionError ? (
        <View style={styles.actionError} accessible accessibilityRole="alert">
          <AppText weight="semibold" color={colors.danger}>
            {t(actionError)}
          </AppText>
        </View>
      ) : null}
    </View>
  );

  const empty = !loaded ? null : isManager ? (
    <EmptyView title={tab === "action" ? t("emptyActions") : t("emptyInfo")} />
  ) : (
    <EmptyView title={t("empty")} hint={t("emptyHint")} />
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={tc("notifications")} onBack={canGoBack ? () => navigation.goBack() : undefined} />
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />
      <View style={styles.links}>
        <Button label={t("openPreferences")} variant="link" onPress={() => navigation.navigate("NotificationPreferences")} />
      </View>
      {isManager && loaded ? <NotificationTabs selected={tab} onSelect={setTab} openCount={openCount} /> : null}

      {!loaded && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="notifications-list"
          data={loaded ? visibleRows : []}
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          renderItem={({ item }) => <NotificationCard row={item} onPress={() => void open(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  links: { paddingHorizontal: spacing.xl, alignItems: "flex-start" },
  headerArea: { gap: spacing.sm },
  toolbar: { marginHorizontal: spacing.xl, marginBottom: spacing.md, gap: spacing.sm },
  actionError: { marginHorizontal: spacing.xl, marginBottom: spacing.md, backgroundColor: colors.dangerSoft, borderRadius: 12, padding: spacing.md },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },
});
