import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiRequestError, type DevLoginUser } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { useAuth } from "../lib/auth-context";
import { getDeviceId } from "../lib/device-id";
import { colors } from "../lib/theme";

type Step = "phone" | "code";

interface OrgOption {
  organizationId: string;
  role: string;
}

const ROLE_GROUPS: { role: OrgRole; title: string }[] = [
  { role: OrgRole.OWNER, title: "Owners" },
  { role: OrgRole.FIELD_MANAGER, title: "Field Managers" },
  { role: OrgRole.WORKER, title: "Workers" },
];

function currentPlatform(): "IOS" | "ANDROID" | "WEB" {
  return Platform.OS === "ios" ? "IOS" : Platform.OS === "android" ? "ANDROID" : "WEB";
}

export function LoginScreen() {
  const { client, login } = useAuth();
  const [step, setStep] = useState<Step>("phone");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<OrgOption[] | null>(null);
  // Non-null only while the API runs in dev login (test) mode -- it answers
  // 404 otherwise and every test option stays hidden.
  const [devUsers, setDevUsers] = useState<DevLoginUser[] | null>(null);
  const [quickLoginId, setQuickLoginId] = useState<string | null>(null);
  const [quickLoginError, setQuickLoginError] = useState<string | null>(null);
  const devMode = devUsers !== null;

  useEffect(() => {
    let cancelled = false;
    client
      .listDevLoginUsers()
      .then((users) => {
        if (!cancelled) setDevUsers(users);
      })
      .catch(() => {
        // API unreachable: the normal phone form surfaces connection errors.
        if (!cancelled) setDevUsers(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function handleQuickLogin(user: DevLoginUser) {
    setQuickLoginError(null);
    setQuickLoginId(user.membershipId);
    try {
      const deviceId = await getDeviceId();
      const session = await client.devLogin({ membershipId: user.membershipId, deviceId, platform: currentPlatform() });
      await login(session);
    } catch (err) {
      setQuickLoginError(err instanceof ApiRequestError ? err.body.message : "Quick login failed. Is the API reachable from this device?");
      setQuickLoginId(null);
    }
  }

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
        platform: currentPlatform(),
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
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {devMode && (
            <View style={styles.banner} accessibilityRole="alert">
              <Text style={styles.bannerTitle}>TEST MODE — login without SMS</Text>
              <Text style={styles.bannerText}>This server has dev login enabled. Never use it with real data.</Text>
            </View>
          )}
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
                Enter the code sent to {phoneNumber}.
              </Text>
              <Text style={styles.label}>Verification code</Text>
              <TextInput style={styles.input} placeholder="123456" keyboardType="number-pad" value={code} onChangeText={setCode} />
              {devMode && <Text style={styles.devHint}>Test mode — code: 123456</Text>}
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

          {devMode && devUsers && (
            <View style={styles.quickLogin}>
              <Text style={styles.quickLoginTitle}>Quick test login</Text>
              <Text style={styles.helpText}>Tap a seeded user to sign in. No SMS or code needed.</Text>
              {devUsers.length === 0 && <Text style={styles.helpText}>No active users found. Run pnpm db:seed on the server.</Text>}
              {ROLE_GROUPS.map(({ role, title }) => {
                const group = devUsers.filter((u) => u.role === role);
                if (group.length === 0) return null;
                return (
                  <View key={role} style={styles.group}>
                    <Text style={styles.groupTitle}>
                      {title} ({group.length})
                    </Text>
                    {group.map((user) => (
                      <Pressable
                        key={user.membershipId}
                        style={[styles.userButton, quickLoginId !== null && styles.buttonDisabled]}
                        disabled={quickLoginId !== null}
                        onPress={() => handleQuickLogin(user)}
                        accessibilityRole="button"
                        accessibilityLabel={`Sign in as ${user.fullLegalName}`}
                      >
                        <Text style={styles.userName}>{quickLoginId === user.membershipId ? "Signing in…" : user.fullLegalName}</Text>
                        <Text style={styles.userPhone}>{user.phoneNumber}</Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
              {quickLoginError && <Text style={styles.error}>{quickLoginError}</Text>}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", padding: 24 },
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
  banner: { backgroundColor: "#fffbeb", borderColor: "#fcd34d", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 20 },
  bannerTitle: { fontSize: 14, fontWeight: "700", color: "#78350f" },
  bannerText: { fontSize: 12, color: "#92400e", marginTop: 2 },
  devHint: { fontSize: 12, color: "#b45309" },
  quickLogin: { marginTop: 32, gap: 8 },
  quickLoginTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  group: { gap: 8, marginTop: 8 },
  groupTitle: { fontSize: 12, fontWeight: "700", color: colors.muted, textTransform: "uppercase" },
  userButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.card },
  userName: { fontSize: 15, fontWeight: "600", color: colors.text },
  userPhone: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
