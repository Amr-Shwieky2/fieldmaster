import { useCallback, useEffect, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Platform, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { MyNotificationPreferences } from "@fieldmaster/api-client";
import type { NotificationType } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "NotificationPreferences">;

type Preference = MyNotificationPreferences["preferences"][number];

/**
 * Push on/off per notification type (the caller's own preferences). In-app
 * notifications are always kept in the list; only the phone notification is
 * switched. Each switch saves at once and goes back if saving fails.
 */
export function NotificationPreferencesScreen({ navigation }: Props) {
  const t = useTranslations("settings");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();

  const [preferences, setPreferences] = useState<Preference[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState<NotificationType | null>(null);
  const [saveError, setSaveError] = useState<{ type: NotificationType; cause: unknown } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await client.getMyNotificationPreferences();
      setPreferences(response.preferences);
    } catch (cause) {
      setError(cause ?? new Error());
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(type: NotificationType, push: boolean) {
    if (!preferences || saving) return;
    const before = preferences;
    setSaveError(null);
    setSaving(type);
    setPreferences(preferences.map((p) => (p.type === type ? { ...p, push } : p)));
    try {
      const response = await client.updateMyNotificationPreferences({ preferences: [{ type, push }] });
      setPreferences(response.preferences);
    } catch (cause) {
      setPreferences(before);
      setSaveError({ type, cause });
    } finally {
      setSaving(null);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={t("notificationsTitle")} onBack={() => navigation.goBack()} />
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />

      {preferences === null && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="notification-preferences"
          data={preferences ?? []}
          keyExtractor={(item) => item.type}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.intro}>
              {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={() => void load()} /> : null}
              <AppText color={colors.muted}>{t("notificationsHelp")}</AppText>
              {Platform.OS === "web" ? (
                <AppText size="small" color={colors.warning}>
                  {t("webNote")}
                </AppText>
              ) : null}
            </View>
          }
          ListEmptyComponent={preferences ? <EmptyView title={t("empty")} /> : null}
          renderItem={({ item }) => {
            const label = enumLabel("NotificationType", item.type);
            const busy = saving === item.type;
            return (
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <AppText weight="semibold">{label}</AppText>
                  <AppText size="small" color={colors.muted}>
                    {busy ? t("saving") : item.push ? t("pushOn") : t("pushOff")}
                  </AppText>
                  {saveError?.type === item.type ? (
                    <AppText size="small" weight="semibold" color={colors.danger} accessibilityRole="alert">
                      {`${t("saveFailed")} ${errorMessage(saveError.cause)}`}
                    </AppText>
                  ) : null}
                </View>
                <Switch
                  accessibilityLabel={t("pushLabel", { type: label })}
                  value={item.push}
                  disabled={saving !== null}
                  onValueChange={(value) => void toggle(item.type, value)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                />
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingBottom: spacing.xl * 2 },
  intro: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm },
  row: {
    minHeight: TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1, gap: 2 },
});
