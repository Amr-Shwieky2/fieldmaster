import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Shift, TimeEntry } from "@fieldmaster/api-client";
import { useAuth } from "../lib/auth-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import { colors } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function HomeScreen({ navigation }: Props) {
  const { client, logout, session } = useAuth();
  const { isOnline, pendingCount } = useOfflineSync();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [active, allShifts] = await Promise.all([
        client.listTimeEntries({ status: "ACTIVE" }),
        client.listShifts(),
      ]);
      setActiveEntry(active[0] ?? null);
      setShifts(
        allShifts
          .filter((s) => s.status === "PUBLISHED" || s.status === "OPEN" || s.status === "ACTIVE")
          .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime()),
      );
    } catch {
      setError("Could not load your shifts. Pull down to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>FieldMaster</Text>
          <Text style={styles.subtitle}>{session?.role === "WORKER" ? "Worker" : session?.role}</Text>
        </View>
        <Pressable onPress={logout}>
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>

      {(!isOnline || pendingCount > 0) && (
        <Pressable style={styles.offlineBanner} onPress={() => navigation.navigate("OfflineQueue")}>
          <Text style={styles.offlineBannerText}>
            {!isOnline ? "Offline" : "Syncing"}
            {pendingCount > 0 ? ` — ${pendingCount} event${pendingCount === 1 ? "" : "s"} pending sync` : " — reconnected"}
          </Text>
        </Pressable>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {activeEntry ? (
        <View style={styles.activeCard}>
          <Text style={styles.activeLabel}>Currently clocked in</Text>
          <Text style={styles.activeShiftTitle}>{activeEntry.shift?.title ?? "Shift"}</Text>
          <Text style={styles.activeSince}>Since {new Date(activeEntry.clockInAt ?? "").toLocaleTimeString()}</Text>
          <Pressable style={styles.clockOutButton} onPress={() => navigation.navigate("ClockOut")}>
            <Text style={styles.clockButtonText}>Clock out</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.noActiveCard}>
          <Text style={styles.noActiveText}>You are not clocked in.</Text>
        </View>
      )}

      <View style={styles.listHeader}>
        <Text style={styles.listHeaderText}>Your shifts</Text>
        <Pressable onPress={() => navigation.navigate("History")}>
          <Text style={styles.linkText}>History</Text>
        </Pressable>
      </View>

      <FlatList
        data={shifts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.emptyText}>No upcoming shifts assigned.</Text>}
        renderItem={({ item }) => (
          <View style={styles.shiftCard}>
            <View style={styles.shiftCardBody}>
              <Text style={styles.shiftTitle}>{item.title}</Text>
              <Text style={styles.shiftMeta}>{item.site?.name ?? "No site"}</Text>
              <Text style={styles.shiftMeta}>
                {new Date(item.scheduledStart).toLocaleString()} → {new Date(item.scheduledEnd).toLocaleTimeString()}
              </Text>
            </View>
            {!activeEntry && (
              <Pressable style={styles.clockInButton} onPress={() => navigation.navigate("ClockIn", { shiftId: item.id, shiftTitle: item.title })}>
                <Text style={styles.clockButtonText}>Clock in</Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, paddingBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 13, color: colors.muted },
  logoutText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  error: { color: colors.danger, marginHorizontal: 20, marginBottom: 8 },
  offlineBanner: { backgroundColor: "#fef3c7", marginHorizontal: 20, borderRadius: 10, padding: 10, marginBottom: 8 },
  offlineBannerText: { color: "#b45309", fontSize: 13, fontWeight: "600", textAlign: "center" },
  activeCard: { backgroundColor: "#dcfce7", marginHorizontal: 20, borderRadius: 14, padding: 16, marginBottom: 12 },
  activeLabel: { fontSize: 12, fontWeight: "700", color: colors.success, textTransform: "uppercase" },
  activeShiftTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 4 },
  activeSince: { fontSize: 13, color: colors.muted, marginTop: 2 },
  clockOutButton: { backgroundColor: colors.danger, borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  noActiveCard: { marginHorizontal: 20, marginBottom: 12 },
  noActiveText: { color: colors.muted, fontSize: 14 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 8 },
  listHeaderText: { fontSize: 16, fontWeight: "700", color: colors.text },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  listContent: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  emptyText: { color: colors.muted, textAlign: "center", marginTop: 24 },
  shiftCard: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 10 },
  shiftCardBody: { gap: 2 },
  shiftTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  shiftMeta: { fontSize: 13, color: colors.muted },
  clockInButton: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  clockButtonText: { color: colors.primaryText, fontSize: 15, fontWeight: "600" },
});
