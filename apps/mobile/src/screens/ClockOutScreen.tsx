import { useState } from "react";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import { TaskCategory } from "@fieldmaster/shared-types";
import { useAuth } from "../lib/auth-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import { getDeviceId } from "../lib/device-id";
import { colors } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ClockOut">;

const TASK_CATEGORY_LABELS: Record<string, string> = {
  [TaskCategory.CONSTRUCTION]: "Construction",
  [TaskCategory.TRAFFIC_CONTROL]: "Traffic control",
  [TaskCategory.TRAFFIC_SIGN]: "Traffic sign",
  [TaskCategory.TRAFFIC_LIGHT_INSTALLATION]: "Traffic light install",
  [TaskCategory.TRAFFIC_LIGHT_REPAIR]: "Traffic light repair",
  [TaskCategory.INSPECTION]: "Inspection",
  [TaskCategory.MAINTENANCE]: "Maintenance",
  [TaskCategory.EMERGENCY_REPAIR]: "Emergency repair",
  [TaskCategory.OTHER]: "Other",
};

export function ClockOutScreen({ navigation }: Props) {
  const { client } = useAuth();
  const { queueOfflineEvent } = useOfflineSync();
  const [taskCategory, setTaskCategory] = useState<string>(TaskCategory.OTHER);
  const [summaryText, setSummaryText] = useState("");
  const [problemsEncountered, setProblemsEncountered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const canSubmit = summaryText.trim().length > 0 && !submitting;

  async function handleClockOut() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission is required to clock out.");
        setSubmitting(false);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });

      const deviceId = await getDeviceId();
      const idempotencyKey = `clockout-${Date.now()}`;
      const deviceTimestamp = new Date().toISOString();
      const locationFields = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? 9999,
        altitude: position.coords.altitude ?? undefined,
        locationProvider: "expo-location",
        mockLocationSuspected: position.mocked ?? false,
      };
      const summaryFields = {
        summaryText: summaryText.trim(),
        taskCategory,
        problemsEncountered: problemsEncountered.trim() || undefined,
      };

      try {
        await client.clockOut(
          { deviceId, clientEventId: idempotencyKey, deviceTimestamp, ...locationFields, origin: "ONLINE", ...summaryFields },
          idempotencyKey,
        );
        navigation.replace("Home");
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        // No connectivity: the mandatory summary was already captured
        // above, so clock-out can still queue locally like clock-in does.
        await queueOfflineEvent({
          clientEventId: idempotencyKey,
          eventType: "CLOCK_OUT",
          deviceTimestamp,
          ...locationFields,
          ...summaryFields,
        });
        setQueuedOffline(true);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Clock-out failed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (queuedOffline) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.container}>
          <Text style={styles.title}>Clock-out queued</Text>
          <Text style={styles.helpText}>
            You're offline. Your clock-out and summary were saved and signed on this device and will sync automatically once you're back
            online.
          </Text>
          <Pressable style={styles.button} onPress={() => navigation.replace("Home")}>
            <Text style={styles.buttonText}>Back to Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Clock out</Text>
        <Text style={styles.helpText}>A daily summary is required before you can clock out.</Text>

        <Text style={styles.label}>Task category</Text>
        <View style={styles.categoryGrid}>
          {Object.values(TaskCategory).map((value) => (
            <Pressable key={value} style={[styles.categoryChip, taskCategory === value && styles.categoryChipSelected]} onPress={() => setTaskCategory(value)}>
              <Text style={[styles.categoryChipText, taskCategory === value && styles.categoryChipTextSelected]}>{TASK_CATEGORY_LABELS[value]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Summary of work done (required)</Text>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={4}
          placeholder="Describe what you worked on today…"
          value={summaryText}
          onChangeText={setSummaryText}
        />

        <Text style={styles.label}>Problems encountered (optional)</Text>
        <TextInput style={styles.textArea} multiline numberOfLines={3} placeholder="Any issues to flag?" value={problemsEncountered} onChangeText={setProblemsEncountered} />

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, !canSubmit && styles.buttonDisabled]} disabled={!canSubmit} onPress={handleClockOut}>
          {submitting ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.buttonText}>Clock out</Text>}
        </Pressable>

        <Pressable onPress={() => navigation.goBack()} disabled={submitting}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 10 },
  title: { fontSize: 24, fontWeight: "700", color: colors.text },
  helpText: { fontSize: 13, color: colors.muted, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginTop: 8 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  categoryChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryChipText: { fontSize: 13, color: colors.text },
  categoryChipTextSelected: { color: colors.primaryText, fontWeight: "600" },
  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    backgroundColor: colors.card,
    minHeight: 80,
    textAlignVertical: "top",
  },
  error: { color: colors.danger, fontSize: 13 },
  button: { backgroundColor: colors.danger, borderRadius: 10, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  cancelText: { color: colors.muted, textAlign: "center", marginTop: 12, fontSize: 14 },
});
