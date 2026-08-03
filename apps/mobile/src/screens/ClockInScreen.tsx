import { useState } from "react";
import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiRequestError, NetworkError } from "@fieldmaster/api-client";
import { useAuth } from "../lib/auth-context";
import { useOfflineSync } from "../lib/offline-sync-context";
import { getDeviceId } from "../lib/device-id";
import { colors } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ClockIn">;

type Step = "idle" | "locating" | "submitting" | "done";

export function ClockInScreen({ route, navigation }: Props) {
  const { shiftId, shiftTitle } = route.params;
  const { client } = useAuth();
  const { queueOfflineEvent } = useOfflineSync();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  async function handleClockIn() {
    setError(null);
    setStep("locating");
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission is required to clock in at a job site.");
        setStep("idle");
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setStep("submitting");

      const deviceId = await getDeviceId();
      const idempotencyKey = `clockin-${shiftId}-${Date.now()}`;
      const deviceTimestamp = new Date().toISOString();
      const locationFields = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy ?? 9999,
        altitude: position.coords.altitude ?? undefined,
        locationProvider: "expo-location",
        mockLocationSuspected: position.mocked ?? false,
      };

      try {
        await client.clockIn(
          { shiftId, deviceId, clientEventId: idempotencyKey, deviceTimestamp, ...locationFields, origin: "ONLINE" },
          idempotencyKey,
        );
        setStep("done");
        navigation.replace("Home");
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        // No connectivity: capture, sign, and queue the event locally
        // instead of failing outright (spec section 20.1). The server will
        // validate the geofence/shift rules for real once this syncs.
        await queueOfflineEvent({
          clientEventId: idempotencyKey,
          eventType: "CLOCK_IN",
          shiftId,
          deviceTimestamp,
          ...locationFields,
        });
        setQueuedOffline(true);
        setStep("done");
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Clock-in failed. Check your connection and try again.");
      setStep("idle");
    }
  }

  if (queuedOffline) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.container}>
          <Text style={styles.title}>Clock-in queued</Text>
          <Text style={styles.helpText}>
            You're offline. Your clock-in was saved and signed on this device and will sync automatically once you're back online.
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
      <View style={styles.container}>
        <Text style={styles.title}>Clock in</Text>
        <Text style={styles.subtitle}>{shiftTitle}</Text>
        <Text style={styles.helpText}>
          Your device location will be checked against this shift's geofence. Make sure you are on-site before clocking in.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable style={[styles.button, step !== "idle" && styles.buttonDisabled]} disabled={step !== "idle"} onPress={handleClockIn}>
          {step === "idle" ? (
            <Text style={styles.buttonText}>Clock in now</Text>
          ) : (
            <View style={styles.buttonRow}>
              <ActivityIndicator color={colors.primaryText} />
              <Text style={styles.buttonText}>{step === "locating" ? "Getting location…" : "Submitting…"}</Text>
            </View>
          )}
        </Pressable>

        <Pressable onPress={() => navigation.goBack()} disabled={step !== "idle"}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 16, color: colors.muted, textAlign: "center", marginBottom: 8 },
  helpText: { fontSize: 13, color: colors.muted, textAlign: "center", marginBottom: 16 },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 16, alignItems: "center" },
  buttonDisabled: { opacity: 0.6 },
  buttonRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  cancelText: { color: colors.muted, textAlign: "center", marginTop: 16, fontSize: 14 },
});
