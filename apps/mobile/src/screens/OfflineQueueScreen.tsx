import { useMemo, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView } from "../components/StateViews";
import { useCodeMessage, useEnumLabel, useErrorMessage, useFormat } from "../i18n/hooks";
import { useOfflineSync } from "../lib/offline-sync-context";
import type { QueuedEvent, QueuedEventLocalStatus } from "../lib/offline-queue";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "OfflineQueue">;

const STATUS_COLORS: Record<QueuedEventLocalStatus, string> = {
  PENDING: colors.muted,
  SYNCING: colors.primary,
  VERIFIED: colors.success,
  FLAGGED: colors.warning,
  REJECTED: colors.danger,
  DUPLICATE: colors.muted,
};

export function OfflineQueueScreen({ navigation }: Props) {
  const t = useTranslations("offlineQueue");
  const errorMessage = useErrorMessage();
  const { queue, isOnline, syncNow } = useOfflineSync();
  const [syncing, setSyncing] = useState(false);
  // The thrown error itself (wrapped, since it can be any value), turned into Arabic at render time.
  const [syncFailure, setSyncFailure] = useState<{ cause: unknown } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setSyncFailure(null);
    try {
      await syncNow();
    } catch (err) {
      setSyncFailure({ cause: err });
    } finally {
      setSyncing(false);
    }
  }

  const sorted = useMemo(() => [...queue].sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime()), [queue]);
  // Stable list props: the list does not re-render while only the sync button changes.
  const emptyView = useMemo(() => <EmptyView title={t("empty")} />, [t]);

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />

      <View
        aria-live="polite"
        style={[styles.statusBanner, { backgroundColor: isOnline ? colors.successSoft : colors.warningSoft }]}
      >
        <AppText weight="semibold" color={isOnline ? colors.success : colors.warning}>
          {isOnline ? t("online") : t("offline")}
        </AppText>
      </View>

      {/* Offline, a manual sync cannot reach anyone: the banner above says the records go out on their own. */}
      <View style={styles.actions}>
        <Button label={t("syncNow")} busy={syncing} busyLabel={t("syncing")} disabled={!isOnline} onPress={handleSync} />
      </View>

      {syncFailure ? <ErrorView message={errorMessage(syncFailure.cause)} onRetry={handleSync} /> : null}

      <FlatList
        style={styles.list}
        data={sorted}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={emptyView}
        renderItem={renderItem}
      />
    </SafeAreaView>
  );
}

const keyExtractor = (item: QueuedEvent) => item.clientEventId;
const renderItem = ({ item }: ListRenderItemInfo<QueuedEvent>) => <QueueRow item={item} />;

function QueueRow({ item }: { item: QueuedEvent }) {
  const t = useTranslations("offlineQueue");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const codeMessage = useCodeMessage();

  // Worker wording on purpose ("تم القبول", "بحاجة إلى مراجعة", "تمت مزامنته سابقًا"): the admin web's
  // enums.OfflineSyncEventStatus ("تم التحقق", "مُعلَّم للمراجعة", "مكرّر") is written for managers.
  const statusLabel = t(`status.${item.localStatus}`);
  const rejected = item.localStatus === "REJECTED";
  // The server sends an error code for a record captured earlier, and a rejection is final (only
  // waiting records are sent again): explain what was wrong at the time, never the raw code.
  const reason = item.reason;
  const reasonText = reason
    ? t.has(`reasons.${reason}`)
      ? t(`reasons.${reason}`)
      : (codeMessage(reason) ?? t("unknownReason"))
    : null;
  const coordinates = isolateLtr(`${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}`);

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <AppText weight="bold" size="large" style={styles.rowType}>
          {enumLabel("ClockEventType", item.eventType)}
        </AppText>
        <Badge label={statusLabel} color={STATUS_COLORS[item.localStatus] ?? colors.muted} />
      </View>
      <AppText color={colors.muted}>{t("capturedAt", { time: format.dateTime(item.deviceTimestamp) })}</AppText>
      <AppText color={colors.muted}>{t("location", { coordinates })}</AppText>
      <AppText color={colors.muted}>{t("accuracy", { meters: String(Math.round(item.accuracyMeters)) })}</AppText>
      {reasonText ? (
        <AppText weight="semibold" color={rejected ? colors.danger : colors.warning}>
          {reasonText}
        </AppText>
      ) : null}
      {rejected ? <AppText>{t("rejectedHint")}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  statusBanner: { marginHorizontal: spacing.xl, marginBottom: spacing.md, borderRadius: 14, padding: spacing.md },
  actions: { paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md },
  row: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  rowType: { flexShrink: 1 },
});
