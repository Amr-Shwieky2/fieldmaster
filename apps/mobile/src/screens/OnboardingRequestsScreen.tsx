import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { FieldMasterClient } from "@fieldmaster/api-client";
import { AppText } from "../components/AppText";
import { ChevronIcon } from "../components/ChevronIcon";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useErrorMessage, useFormat } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "OnboardingRequests">;

/** One application waiting for a decision (`GET /workers/pending-approval`): no ID or bank detail. */
type PendingApplication = Awaited<ReturnType<FieldMasterClient["listPendingApproval"]>>[number];

/**
 * Join applications waiting for a decision (APPROVE_ONBOARDING): who applied,
 * their phone and when, the longest waiting first (the API's order). Read
 * again each time the screen comes back into view, so a decision taken on
 * the review screen (or by another manager) disappears from the list.
 */
export function OnboardingRequestsScreen({ navigation }: Props) {
  const t = useTranslations("onboardingRequests");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();

  const [items, setItems] = useState<PendingApplication[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const call = ++latest.current;
    setError(null);
    try {
      const list = await client.listPendingApproval();
      if (call !== latest.current) return;
      setItems(list.filter((item) => typeof item.workerProfileId === "string" && item.workerProfileId.length > 0));
      setLoaded(true);
    } catch (cause) {
      if (call !== latest.current) return;
      setError(cause ?? new Error());
    } finally {
      if (call === latest.current) setRefreshing(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
        <AppText color={colors.muted} style={styles.count} aria-live="polite">
          {t("count", { count: format.number(items.length) })}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />
      {!loaded && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="onboarding-requests"
          data={loaded ? items : []}
          keyExtractor={(item) => item.workerProfileId}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListHeaderComponent={header}
          ListEmptyComponent={loaded ? <EmptyView title={t("empty")} hint={t("emptyHint")} /> : null}
          renderItem={({ item }) => (
            <Pressable
              testID="onboarding-request"
              accessibilityRole="button"
              accessibilityHint={t("openHint")}
              onPress={() => navigation.navigate("OnboardingReview", { workerProfileId: item.workerProfileId })}
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <View style={styles.cardText}>
                <AppText weight="bold" size="large">
                  {isolateAuto(item.fullLegalName)}
                </AppText>
                <AppText>{isolateLtr(item.phoneNumber)}</AppText>
                <AppText size="small" color={colors.muted}>
                  {t("submittedAt", { dateTime: format.dateTime(item.submittedAt) })}
                </AppText>
              </View>
              <View style={styles.chevron}>
                <ChevronIcon />
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerArea: { gap: spacing.sm },
  count: { paddingHorizontal: spacing.xl, marginBottom: spacing.sm },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },
  card: {
    minHeight: TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  cardText: { flex: 1, gap: 2 },
  chevron: { transform: [{ scaleX: -1 }] },
  pressed: { opacity: 0.85 },
});
