import { useCallback, useEffect, useMemo, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { NotificationItem } from "@fieldmaster/api-client";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { navigateToTarget, resolveAvailableTarget, targetForInAppNotification } from "../lib/linking";
import { renderNotificationText } from "../lib/notification-text";
import { useNotifications } from "../lib/notifications-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Notifications">;

const newestFirst = (a: NotificationItem, b: NotificationItem) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

/**
 * The signed-in member's notifications, newest first, in Arabic built from
 * each one's type and data (the stored English title/body are never shown).
 * Tapping one marks it read and opens its screen (the same mapping as a
 * tapped push notification); "mark all read" clears the badge.
 */
export function NotificationsScreen({ navigation }: Props) {
  const t = useTranslations("notifications");
  const tc = useTranslations("common");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { report } = useNotifications();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [actionError, setActionError] = useState<"markReadFailed" | "markAllFailed" | null>(null);

  const show = useCallback(
    (next: NotificationItem[]) => {
      setItems(next);
      report(next);
    },
    [report],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await client.listNotifications();
      show([...list].sort(newestFirst));
      setLoaded(true);
    } catch (cause) {
      setError(cause ?? new Error());
    } finally {
      setRefreshing(false);
    }
  }, [client, show]);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = useMemo(() => items.filter((item) => item.readAt === null).length, [items]);

  async function open(item: NotificationItem) {
    setActionError(null);
    if (item.readAt === null) {
      const readAt = new Date().toISOString();
      const before = items;
      show(items.map((n) => (n.id === item.id ? { ...n, readAt } : n)));
      try {
        await client.markNotificationRead(item.id);
      } catch {
        show(before);
        setActionError("markReadFailed");
        return;
      }
    }
    const target = targetForInAppNotification(item);
    if (target.name === "Notifications") return;
    navigateToTarget(navigation, resolveAvailableTarget(target, navigation.getState?.()?.routeNames ?? null));
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

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={tc("notifications")} onBack={() => navigation.goBack()} />
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />
      <View style={styles.links}>
        <Button label={t("openPreferences")} variant="link" onPress={() => navigation.navigate("NotificationPreferences")} />
      </View>

      {!loaded && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="notifications-list"
          data={loaded ? items : []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListHeaderComponent={header}
          ListEmptyComponent={loaded ? <EmptyView title={t("empty")} hint={t("emptyHint")} /> : null}
          renderItem={({ item }) => {
            const rendered = renderNotificationText(t, format, enumLabel, item);
            const isUnread = item.readAt === null;
            const leadsSomewhere = targetForInAppNotification(item).name !== "Notifications";
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityHint={leadsSomewhere ? t("openHint") : isUnread ? t("markReadHint") : undefined}
                onPress={() => void open(item)}
                style={({ pressed }) => [styles.card, isUnread && styles.cardUnread, pressed && styles.pressed]}
              >
                <View style={styles.cardRow}>
                  <AppText weight={isUnread ? "bold" : "semibold"} size="large" style={styles.cardTitle}>
                    {rendered.title}
                  </AppText>
                  {isUnread ? <Badge label={t("unread")} color={colors.primary} /> : null}
                </View>
                <AppText>{rendered.body}</AppText>
                <AppText size="small" color={colors.muted}>
                  {format.dateTime(item.createdAt)}
                </AppText>
              </Pressable>
            );
          }}
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
  card: {
    minHeight: TOUCH_TARGET,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  cardUnread: { borderColor: colors.primary, borderWidth: 2 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cardTitle: { flexShrink: 1 },
  pressed: { opacity: 0.85 },
});
