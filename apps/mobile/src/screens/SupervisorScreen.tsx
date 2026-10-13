import { useCallback, useEffect, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { SupervisedShift } from "@fieldmaster/api-client";
import { getErrorCode, isNotFound } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { AppTextInput } from "../components/AppTextInput";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { SiteMap } from "../components/SiteMap";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { readLocation, type LocationReading } from "../lib/location";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Supervisor">;

const PRESENCE_COLORS: Record<string, string> = {
  NOT_CLOCKED_IN: colors.muted,
  CLOCKED_IN: colors.success,
  CLOCKED_OUT: colors.primary,
};

const INACTIVE = "TEMPORARY_SUPERVISOR_INACTIVE";

type PointAction = { status: "idle" } | { status: "locating" } | { status: "opening" } | { status: "done"; message: "pointOpened" | "pointClosed" };

type Feedback = { kind: "location"; key: "locationPermission" | "locationServicesOff" | "locationUnavailable" } | { kind: "error"; cause: unknown } | null;

/**
 * A temporary supervisor's shift, only while the assignment is ACTIVE (the
 * API checks it on every call; an inactive one gets an Arabic message and
 * nothing else): the shift's workers and their status, the temporary
 * check-in points (open one at the current location, close one), and
 * «الإبلاغ عن مشكلة» to the shift's manager and the Owners. Operational data
 * only: no money and no phone numbers.
 */
export function SupervisorScreen({ navigation, route }: Props) {
  const { assignmentId } = route.params;
  const t = useTranslations("supervisor");
  const tErrors = useTranslations("errors");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();

  const [data, setData] = useState<SupervisedShift | null>(null);
  const [inactive, setInactive] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pointName, setPointName] = useState("");
  const [pointAction, setPointAction] = useState<PointAction>({ status: "idle" });
  const [pointFeedback, setPointFeedback] = useState<Feedback>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [position, setPosition] = useState<LocationReading | null>(null);
  const [issue, setIssue] = useState("");
  const [issueState, setIssueState] = useState<{ status: "idle" | "sending" | "sent" } | { status: "missing" } | { status: "failed"; cause: unknown }>({ status: "idle" });

  /** An action answered "not active any more": from now on only the message is shown. */
  const handleInactive = useCallback((cause: unknown) => {
    if (getErrorCode(cause) !== INACTIVE) return false;
    setInactive(true);
    setData(null);
    return true;
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await client.getSupervisedShift(assignmentId));
      setInactive(false);
      setNotFound(false);
    } catch (cause) {
      if (handleInactive(cause)) return;
      if (isNotFound(cause)) {
        setNotFound(true);
        setData(null);
      } else {
        setError(cause ?? new Error());
      }
    } finally {
      setRefreshing(false);
    }
  }, [assignmentId, client, handleInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  function onRefresh() {
    setRefreshing(true);
    void load();
  }

  async function openPoint() {
    if (!data || pointAction.status === "locating" || pointAction.status === "opening") return;
    setPointFeedback(null);
    setPointAction({ status: "locating" });
    const result = await readLocation();
    if (!result.ok) {
      const key = result.failure.kind === "permission" ? "locationPermission" : result.failure.kind === "servicesOff" ? "locationServicesOff" : "locationUnavailable";
      setPointFeedback({ kind: "location", key });
      setPointAction({ status: "idle" });
      return;
    }
    setPosition(result.reading);
    setPointAction({ status: "opening" });
    try {
      await client.createTemporaryCheckInPoint({
        shiftId: data.shift.id,
        name: pointName.trim() || t("defaultPointName", { time: format.time(new Date()) }),
        latitude: result.reading.latitude,
        longitude: result.reading.longitude,
      });
      setPointName("");
      setPointAction({ status: "done", message: "pointOpened" });
      await load();
    } catch (cause) {
      setPointAction({ status: "idle" });
      if (!handleInactive(cause)) setPointFeedback({ kind: "error", cause });
    }
  }

  async function closePoint(pointId: string) {
    if (closing) return;
    setPointFeedback(null);
    setClosing(pointId);
    try {
      await client.closeTemporaryCheckInPoint(pointId);
      setPointAction({ status: "done", message: "pointClosed" });
      await load();
    } catch (cause) {
      if (!handleInactive(cause)) setPointFeedback({ kind: "error", cause });
    } finally {
      setClosing(null);
    }
  }

  async function sendIssue() {
    if (issueState.status === "sending") return;
    if (issue.trim() === "") {
      setIssueState({ status: "missing" });
      return;
    }
    setIssueState({ status: "sending" });
    try {
      await client.reportSupervisorIssue(assignmentId, issue.trim());
      setIssue("");
      setIssueState({ status: "sent" });
    } catch (cause) {
      if (handleInactive(cause)) return;
      setIssueState({ status: "failed", cause });
    }
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;

  if (inactive) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <View style={styles.content}>
          <View style={[styles.card, styles.warningCard]} accessible accessibilityRole="alert">
            <AppText weight="bold" size="large" color={colors.warning}>
              {t("inactiveTitle")}
            </AppText>
            <AppText>{tErrors(INACTIVE)}</AppText>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!data && !error && !notFound) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <LoadingView />
      </SafeAreaView>
    );
  }

  const shift = data?.shift;
  const geofence = shift?.geofence
    ? { latitude: shift.geofence.centerLatitude, longitude: shift.geofence.centerLongitude, radiusMeters: shift.geofence.radiusMeters }
    : shift?.site
      ? { latitude: shift.site.latitude, longitude: shift.site.longitude, radiusMeters: 0 }
      : null;
  const canManagePoints = data?.assignment.canOpenCheckInPoints ?? false;
  const pointBusy = pointAction.status === "locating" || pointAction.status === "opening";

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />
      <ScrollView
        testID="supervisor"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
      >
        {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRefresh} /> : null}
        {notFound ? <EmptyView title={t("notFound")} /> : null}

        {data && shift ? (
          <>
            <View style={styles.card}>
              <AppText accessibilityRole="header" weight="bold" size="title">
                {isolateAuto(shiftTitle(shift))}
              </AppText>
              <AppText>{format.businessDate(shift.businessDate)}</AppText>
              <AppText>{t("shiftHours", { start: format.time(shift.scheduledStart), end: format.time(shift.scheduledEnd) })}</AppText>
              {shift.site ? <AppText>{t("site", { name: isolateAuto(shift.site.name) })}</AppText> : null}
              <AppText color={colors.muted}>{t("until", { time: format.dateTime(data.assignment.expiresAt) })}</AppText>
            </View>

            <View style={styles.card}>
              <AppText accessibilityRole="header" weight="bold" size="large">
                {t("workers")}
              </AppText>
              {data.workers.length === 0 ? <AppText color={colors.muted}>{t("noWorkers")}</AppText> : null}
              {data.workers.map((worker) => (
                <View key={worker.workerProfileId} style={styles.row}>
                  <View style={styles.titleRow}>
                    <AppText weight="semibold" style={styles.flexShrink}>
                      {isolateAuto(worker.fullLegalName)}
                    </AppText>
                    <Badge label={enumLabel("ShiftWorkerPresence", worker.presence)} color={PRESENCE_COLORS[worker.presence] ?? colors.muted} />
                  </View>
                  {worker.clockInAt ? <AppText size="small">{t("clockedInAt", { time: format.time(worker.clockInAt) })}</AppText> : null}
                  {worker.clockOutAt ? <AppText size="small">{t("clockedOutAt", { time: format.time(worker.clockOutAt) })}</AppText> : null}
                  {worker.locationOutcome ? (
                    <AppText size="small" color={colors.muted}>
                      {t("locationOutcome", { status: enumLabel("LocationValidationStatus", worker.locationOutcome) })}
                    </AppText>
                  ) : null}
                  {worker.flags.length > 0 ? (
                    <View style={styles.flags}>
                      {worker.flags.map((flag) => (
                        <Badge key={flag} label={enumLabel("AttendanceFlag", flag)} color={colors.warning} />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <AppText accessibilityRole="header" weight="bold" size="large">
                {t("points")}
              </AppText>
              <SiteMap
                geofence={geofence}
                points={data.temporaryCheckInPoints.map((point) => ({ latitude: point.latitude, longitude: point.longitude, radiusMeters: point.radiusMeters, name: point.name }))}
                worker={position ? { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy } : null}
                height={220}
                testID="supervisor-map"
              />
              {position ? (
                <AppText size="small" color={colors.muted}>
                  {t("currentPosition", { coordinates: isolateLtr(`${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`) })}
                </AppText>
              ) : null}
              {data.temporaryCheckInPoints.length === 0 ? <AppText color={colors.muted}>{t("noPoints")}</AppText> : null}
              {data.temporaryCheckInPoints.map((point) => (
                <View key={point.id} style={styles.row}>
                  <AppText weight="semibold">{isolateAuto(point.name)}</AppText>
                  <AppText size="small" color={colors.muted}>
                    {t("pointExpires", { time: format.dateTime(point.expiresAt) })}
                  </AppText>
                  <AppText size="small" color={colors.muted}>
                    {t("pointRadius", { meters: format.number(point.radiusMeters) })}
                  </AppText>
                  {canManagePoints ? (
                    <Button
                      label={t("closePoint")}
                      accessibilityHint={t("closePointLabel", { name: isolateAuto(point.name) })}
                      variant="secondary"
                      busy={closing === point.id}
                      busyLabel={t("closingPoint")}
                      disabled={closing !== null && closing !== point.id}
                      onPress={() => void closePoint(point.id)}
                    />
                  ) : null}
                </View>
              ))}
              {canManagePoints ? (
                <View style={styles.form}>
                  <AppTextInput accessibilityLabel={t("pointName")} placeholder={t("pointName")} value={pointName} onChangeText={setPointName} editable={!pointBusy} />
                  <Button
                    label={t("openPoint")}
                    busy={pointBusy}
                    busyLabel={pointAction.status === "locating" ? t("locating") : t("openingPoint")}
                    onPress={() => void openPoint()}
                  />
                </View>
              ) : (
                <AppText color={colors.muted}>{t("cannotOpenPoints")}</AppText>
              )}
              {pointAction.status === "done" ? (
                <AppText accessibilityRole="alert" weight="semibold" color={colors.success}>
                  {t(pointAction.message)}
                </AppText>
              ) : null}
              {pointFeedback ? (
                <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                  {pointFeedback.kind === "location" ? t(pointFeedback.key) : errorMessage(pointFeedback.cause)}
                </AppText>
              ) : null}
            </View>

            <View style={styles.card}>
              <AppText accessibilityRole="header" weight="bold" size="large">
                {t("reportIssue")}
              </AppText>
              <AppText color={colors.muted}>{t("reportIssueHelp")}</AppText>
              <AppTextInput
                multiline
                accessibilityLabel={t("reportIssueLabel")}
                placeholder={t("reportIssuePlaceholder")}
                value={issue}
                onChangeText={(value) => {
                  setIssue(value);
                  if (issueState.status === "missing" || issueState.status === "sent") setIssueState({ status: "idle" });
                }}
                editable={issueState.status !== "sending"}
              />
              <Button label={t("sendReport")} busy={issueState.status === "sending"} busyLabel={t("sendingReport")} onPress={() => void sendIssue()} />
              {issueState.status === "missing" ? (
                <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                  {t("reportIssueRequired")}
                </AppText>
              ) : null}
              {issueState.status === "sent" ? (
                <AppText accessibilityRole="alert" weight="semibold" color={colors.success}>
                  {t("reportSent")}
                </AppText>
              ) : null}
              {issueState.status === "failed" ? (
                <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
                  {errorMessage(issueState.cause)}
                </AppText>
              ) : null}
            </View>
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
  row: { gap: 2, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  flexShrink: { flexShrink: 1 },
  flags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  form: { gap: spacing.sm },
});
