import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TimeEntry } from "@fieldmaster/api-client";
import { useAuth } from "../lib/auth-context";
import { colors } from "../lib/theme";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: colors.primary,
  PENDING_APPROVAL: colors.warning,
  APPROVED: colors.success,
  REJECTED: colors.danger,
};

function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function HistoryScreen() {
  const { client } = useAuth();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .listTimeEntries()
      .then((items) => setEntries(items.sort((a, b) => new Date(b.businessDate).getTime() - new Date(a.businessDate).getTime())))
      .catch(() => setError("Could not load your attendance history."))
      .finally(() => setLoading(false));
  }, [client]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {!loading && (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>No attendance records yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <Text style={styles.cardTitle}>{item.shift?.title ?? "Shift"}</Text>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] ?? colors.muted }]}>
                  <Text style={styles.statusText}>{item.status.replace(/_/g, " ")}</Text>
                </View>
              </View>
              <Text style={styles.cardMeta}>{item.businessDate}</Text>
              <Text style={styles.cardMeta}>
                {item.clockInAt ? new Date(item.clockInAt).toLocaleTimeString() : "—"} → {item.clockOutAt ? new Date(item.clockOutAt).toLocaleTimeString() : "—"}
              </Text>
              <Text style={styles.cardMeta}>Worked: {formatDuration(item.rawDurationMinutes)}</Text>
              {item.dailySummary?.text && <Text style={styles.summaryText}>{item.dailySummary.text}</Text>}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: colors.danger, marginHorizontal: 20 },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  emptyText: { color: colors.muted, textAlign: "center", marginTop: 24 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 4 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: colors.text, flexShrink: 1 },
  statusBadge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { color: colors.primaryText, fontSize: 10, fontWeight: "700" },
  cardMeta: { fontSize: 13, color: colors.muted },
  summaryText: { fontSize: 13, color: colors.text, marginTop: 6, fontStyle: "italic" },
});
