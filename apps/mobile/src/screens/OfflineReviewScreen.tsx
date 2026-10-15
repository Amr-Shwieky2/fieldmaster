import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { NotificationSubject, OfflineSyncBatchRecord } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { AppTextInput } from "../components/AppTextInput";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { HandledNote } from "../components/notifications/HandledNote";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useCodeMessage, useEnumLabel, useErrorMessage, useFormat } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "OfflineReview">;

/** A record the server refused or flagged when the worker's phone synced it. */
interface ReviewRecord {
  id: string;
  eventType: string;
  status: "REJECTED" | "FLAGGED";
  reason: string | null;
  capturedAt: string;
  syncedAt: string;
  /** The entry a flagged record made, to review it; null when the API does not say. */
  timeEntryId: string | null;
}

/** The refused and flagged records of the worker's latest batches, newest first (accepted and duplicate ones need nothing). */
function reviewRecords(batches: readonly OfflineSyncBatchRecord[]): ReviewRecord[] {
  const records: ReviewRecord[] = [];
  for (const batch of batches) {
    for (const event of batch.events) {
      if (event.status !== "REJECTED" && event.status !== "FLAGGED") continue;
      records.push({
        id: event.id,
        eventType: event.eventType,
        status: event.status,
        reason: event.rejectionReason,
        capturedAt: event.deviceTimestamp,
        syncedAt: batch.submittedAt,
        timeEntryId: event.resultTimeEntryId ?? null,
      });
    }
  }
  return records.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

type SubjectState = { status: "none" } | { status: "loaded"; subject: NotificationSubject } | { status: "error" };
type SaveState = { status: "idle" | "saving" } | { status: "failed"; cause: unknown };

/**
 * A worker's offline attendance records that the server refused or flagged
 * when their phone synced them (mobile manager mode, VIEW_ATTENDANCE): why
 * each refused one was refused, and «مراجعة الحضور» for a flagged one (the
 * entry it made). Opened from a notification (`subjectId`), it shows who
 * already settled it, or «تمّت المراجعة» with an optional note, which settles
 * it for every manager.
 */
export function OfflineReviewScreen({ navigation, route }: Props) {
  const { workerProfileId, subjectId, workerName } = route.params;
  const t = useTranslations("offlineReview");
  const tStates = useTranslations("states");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const codeMessage = useCodeMessage();
  const { client } = useAuth();
  const { can } = useAccess();
  const allowed = can(Permission.VIEW_ATTENDANCE);

  const [records, setRecords] = useState<ReviewRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [subject, setSubject] = useState<SubjectState>({ status: "none" });
  const [note, setNote] = useState("");
  const [save, setSave] = useState<SaveState>({ status: "idle" });
  const saving = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    const [batches, settled] = await Promise.allSettled([
      client.listWorkerOfflineSyncBatches(workerProfileId),
      subjectId ? client.getNotificationSubject(subjectId) : Promise.resolve(null),
    ]);
    if (batches.status === "fulfilled") setRecords(reviewRecords(batches.value));
    else setError(batches.reason ?? new Error());
    if (subjectId) setSubject(settled.status === "fulfilled" && settled.value ? { status: "loaded", subject: settled.value } : { status: "error" });
    setRefreshing(false);
  }, [client, subjectId, workerProfileId]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  async function markReviewed() {
    if (!subjectId || saving.current) return;
    saving.current = true;
    setSave({ status: "saving" });
    try {
      const updated = await client.handleNotificationSubject(subjectId, note.trim() || undefined);
      setSubject({ status: "loaded", subject: updated });
      setSave({ status: "idle" });
      navigation.goBack();
    } catch (cause) {
      setSave({ status: "failed", cause });
    } finally {
      saving.current = false;
    }
  }

  /** Why a record was refused, said about the worker; else the API code's Arabic text; never the raw code. */
  function reasonText(reason: string | null): string {
    if (!reason) return t("unknownReason");
    if (t.has(`reasons.${reason}`)) return t(`reasons.${reason}`);
    return codeMessage(reason) ?? t("unknownReason");
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;

  if (!allowed) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <View style={styles.content}>
          <View style={[styles.card, styles.warningCard]} accessible accessibilityRole="alert">
            <AppText weight="bold" size="large" color={colors.warning}>
              {tStates("accessDeniedTitle")}
            </AppText>
            <AppText>{tStates("accessDeniedDescription")}</AppText>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (records === null && !error) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <LoadingView />
      </SafeAreaView>
    );
  }

  const handled = subject.status === "loaded" ? subject.subject.handled : null;
  const rejected = records?.filter((record) => record.status === "REJECTED").length ?? 0;
  const flagged = records?.filter((record) => record.status === "FLAGGED").length ?? 0;

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />
      <ScrollView
        testID="offline-review"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRefresh} /> : null}
        {handled ? <HandledNote handled={handled} testID="offline-review-handled" /> : null}
        {subject.status === "error" ? (
          <AppText accessibilityRole="alert" color={colors.danger}>
            {t("subjectLoadError")}
          </AppText>
        ) : null}

        {records ? (
          <>
            {workerName ? <AppText weight="semibold">{t("worker", { name: workerName })}</AppText> : null}
            <AppText color={colors.muted}>{t("intro")}</AppText>
            {records.length === 0 ? (
              <EmptyView title={t("empty")} />
            ) : (
              <AppText weight="semibold">{t("summary", { rejected: format.number(rejected), flagged: format.number(flagged) })}</AppText>
            )}
            {records.map((record) => {
              const entryId = record.timeEntryId;
              return (
                <View key={record.id} style={styles.card} testID={`offline-record-${record.id}`}>
                  <View style={styles.titleRow}>
                    <AppText weight="bold" size="large" style={styles.flexShrink}>
                      {enumLabel("ClockEventType", record.eventType)}
                    </AppText>
                    <Badge label={enumLabel("OfflineSyncEventStatus", record.status)} color={record.status === "REJECTED" ? colors.danger : colors.warning} />
                  </View>
                  <AppText color={colors.muted}>{t("capturedAt", { time: format.dateTime(record.capturedAt) })}</AppText>
                  <AppText color={colors.muted}>{t("syncedAt", { time: format.dateTime(record.syncedAt) })}</AppText>
                  {record.status === "REJECTED" ? (
                    <>
                      <AppText weight="semibold" color={colors.danger}>
                        {t("rejectedReason", { reason: reasonText(record.reason) })}
                      </AppText>
                      <AppText>{t("rejectedHint")}</AppText>
                    </>
                  ) : (
                    <>
                      <AppText weight="semibold" color={colors.warning}>
                        {t("flaggedHint")}
                      </AppText>
                      {entryId ? <Button label={t("openEntry")} variant="secondary" onPress={() => navigation.navigate("AttendanceReview", { timeEntryId: entryId })} /> : null}
                    </>
                  )}
                </View>
              );
            })}

            {subjectId && !handled ? (
              <View style={styles.card}>
                <AppText accessibilityRole="header" weight="bold" size="large">
                  {t("reviewTitle")}
                </AppText>
                <AppText color={colors.muted}>{t("reviewHint")}</AppText>
                <AppTextInput
                  multiline
                  accessibilityLabel={t("noteLabel")}
                  placeholder={t("notePlaceholder")}
                  value={note}
                  onChangeText={setNote}
                  editable={save.status !== "saving"}
                />
                <Button label={t("markReviewed")} busy={save.status === "saving"} busyLabel={t("markingReviewed")} onPress={() => void markReviewed()} />
                {save.status === "failed" ? (
                  <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                    {errorMessage(save.cause)}
                  </AppText>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl * 2, gap: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  warningCard: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
});
