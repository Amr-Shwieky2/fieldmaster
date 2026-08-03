import { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import type { QueuedEvent, QueuedEventLocalStatus } from "../lib/offline-queue";
import { colors } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "OfflineQueue">;

const STATUS_LABELS: Record<QueuedEventLocalStatus, string> = {
  PENDING: "Waiting to sync",
  SYNCING: "Syncing…",
  VERIFIED: "Verified",
  FLAGGED: "Flagged for review",
  REJECTED: "Rejected",
  DUPLICATE: "Already synced",
};

const STATUS_COLORS: Record<QueuedEventLocalStatus, string> = {
  PENDING: colors.muted,
  SYNCING: colors.primary,
  VERIFIED: colors.success,
  FLAGGED: "#b45309",
  REJECTED: colors.danger,
  DUPLICATE: colors.muted,
};

const REASON_EXPLANATIONS: Record<string, string> = {
  DEVICE_KEY_NOT_REGISTERED: "This device's signing key wasn't registered yet -- it will retry automatically.",
  INVALID_OFFLINE_SIGNATURE: "This event's signature could not be verified.",
  GEOFENCE_OUTSIDE_ALLOWED_RADIUS: "You were outside the site's permitted check-in area.",
  ACTIVE_TIME_ENTRY_EXISTS: "You already had an open clock-in when this was captured.",
  NO_ACTIVE_TIME_ENTRY: "There was no open clock-in to close when this was captured.",
  SUMMARY_REQUIRED: "A task summary was missing.",
};

export function OfflineQueueScreen({ navigation }: Props) {
  const { queue, isOnline, syncNow } = useOfflineSync();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      await syncNow();
    } finally {
      setRetrying(false);
    }
  }

  const sorted = [...queue].sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime());

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Offline sync</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={[styles.statusBanner, { backgroundColor: isOnline ? "#dcfce7" : "#fef3c7" }]}>
        <Text style={[styles.statusBannerText, { color: isOnline ? colors.success : "#b45309" }]}>
          {isOnline ? "Online" : "Offline — events will sync automatically when you're back online"}
        </Text>
      </View>

      <Pressable style={[styles.retryButton, retrying && styles.retryButtonDisabled]} disabled={retrying} onPress={handleRetry}>
        {retrying ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.retryButtonText}>Sync now</Text>}
      </Pressable>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.clientEventId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No offline events. Everything you clock is syncing normally.</Text>}
        renderItem={({ item }) => <QueueRow item={item} />}
      />
    </SafeAreaView>
  );
}

function QueueRow({ item }: { item: QueuedEvent }) {
  const reasonText = item.reason ? (REASON_EXPLANATIONS[item.reason] ?? item.reason) : null;
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowType}>{item.eventType === "CLOCK_IN" ? "Clock in" : "Clock out"}</Text>
        <View style={[styles.badge, { backgroundColor: STATUS_COLORS[item.localStatus] }]}>
          <Text style={styles.badgeText}>{STATUS_LABELS[item.localStatus]}</Text>
        </View>
      </View>
      <Text style={styles.rowMeta}>Captured {new Date(item.deviceTimestamp).toLocaleString()}</Text>
      <Text style={styles.rowMeta}>
        {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)} (±{Math.round(item.accuracyMeters)}m)
      </Text>
      {reasonText && <Text style={styles.rowReason}>{reasonText}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 8 },
  backText: { color: colors.primary, fontSize: 15, fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  statusBanner: { marginHorizontal: 20, borderRadius: 10, padding: 12, marginBottom: 8 },
  statusBannerText: { fontSize: 13, fontWeight: "600", textAlign: "center" },
  retryButton: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginHorizontal: 20, marginBottom: 12 },
  retryButtonDisabled: { opacity: 0.6 },
  retryButtonText: { color: colors.primaryText, fontSize: 15, fontWeight: "600" },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 10 },
  emptyText: { color: colors.muted, textAlign: "center", marginTop: 24 },
  row: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4 },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowType: { fontSize: 15, fontWeight: "700", color: colors.text },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  rowMeta: { fontSize: 12, color: colors.muted },
  rowReason: { fontSize: 12, color: "#b45309", marginTop: 4 },
});
