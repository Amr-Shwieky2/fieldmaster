import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiRequestError } from "@fieldmaster/api-client";
import { useAuth } from "../lib/auth-context";
import { getDeviceId } from "../lib/device-id";
import { colors } from "../lib/theme";

type Step = "phone" | "code";

interface OrgOption {
  organizationId: string;
  role: string;
}

export function LoginScreen() {
  const { client, login } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<OrgOption[] | null>(null);

  async function handleRequestOtp() {
    setError(null);
    setSubmitting(true);
    try {
      await client.requestOtp(phoneNumber.trim());
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Failed to send verification code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(organizationId?: string) {
    setError(null);
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const session = await client.verifyOtp({
        phoneNumber: phoneNumber.trim(),
        code: code.trim(),
        deviceId,
        platform: Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB",
        organizationId,
      });
      await login(session);
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.code === "ORGANIZATION_SELECTION_REQUIRED") {
        setOrganizations((err.body.details?.organizations as OrgOption[]) ?? []);
        return;
      }
      setError(err instanceof ApiRequestError ? err.body.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.container}>
          <Text style={styles.title}>FieldMaster</Text>
          <Text style={styles.subtitle}>Worker sign-in</Text>

          {step === "phone" && (
            <View style={styles.form}>
              <Text style={styles.label}>Phone number</Text>
              <TextInput
                style={styles.input}
                placeholder="+972501234567"
                keyboardType="phone-pad"
                autoCapitalize="none"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
              />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable
                style={[styles.button, (!phoneNumber || submitting) && styles.buttonDisabled]}
                disabled={!phoneNumber || submitting}
                onPress={handleRequestOtp}
              >
                {submitting ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.buttonText}>Send verification code</Text>}
              </Pressable>
            </View>
          )}

          {step === "code" && !organizations && (
            <View style={styles.form}>
              <Text style={styles.helpText}>
                Enter the code sent to {phoneNumber}. In development, it is printed to the API server console.
              </Text>
              <Text style={styles.label}>Verification code</Text>
              <TextInput style={styles.input} placeholder="123456" keyboardType="number-pad" value={code} onChangeText={setCode} />
              {error && <Text style={styles.error}>{error}</Text>}
              <Pressable style={[styles.button, (!code || submitting) && styles.buttonDisabled]} disabled={!code || submitting} onPress={() => handleVerify()}>
                {submitting ? <ActivityIndicator color={colors.primaryText} /> : <Text style={styles.buttonText}>Verify and sign in</Text>}
              </Pressable>
              <Pressable onPress={() => setStep("phone")}>
                <Text style={styles.linkText}>Use a different phone number</Text>
              </Pressable>
            </View>
          )}

          {organizations && (
            <View style={styles.form}>
              <Text style={styles.helpText}>This phone number belongs to multiple organizations. Choose one:</Text>
              {organizations.map((org) => (
                <Pressable key={org.organizationId} style={styles.orgOption} onPress={() => handleVerify(org.organizationId)}>
                  <Text style={styles.orgOptionText}>{org.role}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 32, fontWeight: "700", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: "center", marginTop: 4, marginBottom: 32 },
  form: { gap: 12 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text },
  helpText: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: colors.card,
  },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
  linkText: { color: colors.primary, textAlign: "center", marginTop: 8, fontSize: 14 },
  error: { color: colors.danger, fontSize: 13 },
  orgOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, backgroundColor: colors.card },
  orgOptionText: { fontSize: 15, fontWeight: "600", color: colors.text },
});
