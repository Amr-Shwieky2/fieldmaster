import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { Shift } from "@fieldmaster/api-client";
import { CheckInMethod } from "@fieldmaster/shared-types";
import { toBusinessDay } from "@fieldmaster/i18n";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { SiteMap } from "../components/SiteMap";
import { ErrorView, LoadingView } from "../components/StateViews";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAuth } from "../lib/auth-context";
import { useLiveDistance, type DistanceTarget } from "../lib/location";
import type { MapPoint } from "../lib/site-map-html";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShiftDetails">;

/** The circle the server checks at clock-in: the shift's geofence, else the site's own default radius. */
function geofenceOf(shift: Shift): DistanceTarget | null {
  if (shift.geofence) {
    return { latitude: shift.geofence.centerLatitude, longitude: shift.geofence.centerLongitude, radiusMeters: shift.geofence.radiusMeters };
  }
  if (shift.site) return { latitude: shift.site.latitude, longitude: shift.site.longitude, radiusMeters: shift.site.defaultGeofenceRadiusMeters };
  return null;
}

/** Temporary check-in points that are open right now (ACTIVE, not revoked, not expired). */
function activePointsOf(shift: Shift, now: number) {
  return (shift.temporaryCheckInPoints ?? []).filter((point) => point.status === "ACTIVE" && !point.revokedAt && Date.parse(point.expiresAt) > now);
}

async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch {
    // The message on screen already says what to do.
  }
}

function Field({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View style={styles.field} testID={testID}>
      <AppText color={colors.muted}>{label}</AppText>
      <AppText weight="semibold" size="large">
        {value}
      </AppText>
    </View>
  );
}

/**
 * One assigned shift: what, where and when, how attendance is checked, the
 * manager and the site's instructions, a map of the site (geofence, active
 * temporary check-in points, the worker's position) and the live distance to
 * the site while the screen is open.
 */
export function ShiftDetailsScreen({ route, navigation }: Props) {
  const { shiftId } = route.params;
  const t = useTranslations("shift");
  const tLocation = useTranslations("location");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const shiftTitle = useShiftTitle();
  const { client } = useAuth();
  const isFocused = useIsFocused();

  const [shift, setShift] = useState<Shift | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setShift(await client.getShift(shiftId));
    } catch (cause) {
      setError(cause ?? new Error());
    } finally {
      setRefreshing(false);
    }
  }, [client, shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  const target = shift ? geofenceOf(shift) : null;
  // The GPS watch runs only while this screen is the one on top (it stops on blur and unmount).
  const live = useLiveDistance(target, isFocused && target !== null);

  const points: MapPoint[] = useMemo(
    () =>
      shift
        ? activePointsOf(shift, Date.now()).map((point) => ({ name: point.name, latitude: point.latitude, longitude: point.longitude, radiusMeters: point.radiusMeters }))
        : [],
    [shift],
  );

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;
  const banner = <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />;

  if (!shift) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {banner}
        {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={load} /> : <LoadingView />}
      </SafeAreaView>
    );
  }

  const sameDay = toBusinessDay(shift.scheduledStart) === toBusinessDay(shift.scheduledEnd);
  const hours = sameDay
    ? t("hoursValue", { start: format.time(shift.scheduledStart), end: format.time(shift.scheduledEnd) })
    : t("hoursValue", { start: format.dateTime(shift.scheduledStart), end: format.dateTime(shift.scheduledEnd) });
  // Shown as "غير محدد" when the API does not give it.
  const managerName = shift.managerName?.trim() || null;
  const instructions = shift.site?.instructions?.trim() || null;
  const activePoints = activePointsOf(shift, Date.now());

  function distanceView() {
    if (!target) return null;
    switch (live.status) {
      case "idle":
      case "locating":
        return <AppText color={colors.muted}>{tLocation("locating")}</AppText>;
      case "permission":
        return (
          <>
            <AppText color={colors.warning} weight="semibold">
              {live.canAskAgain ? tLocation("permissionDenied") : tLocation("permissionSettings")}
            </AppText>
            {!live.canAskAgain ? <Button label={tLocation("openSettings")} variant="secondary" onPress={openAppSettings} /> : null}
          </>
        );
      case "servicesOff":
        return (
          <AppText color={colors.warning} weight="semibold">
            {tLocation("servicesOff")}
          </AppText>
        );
      case "unavailable":
        return (
          <AppText color={colors.warning} weight="semibold">
            {tLocation("unavailable")}
          </AppText>
        );
      case "located":
        return (
          <>
            <AppText testID="shift-distance" size="large" weight="bold" color={live.inside ? colors.success : colors.text} aria-live="polite">
              {live.inside ? tLocation("insideSite") : tLocation("distanceAway", { distance: format.number(live.distanceMeters) })}
            </AppText>
            {live.accuracy !== null ? (
              <AppText color={colors.muted}>{tLocation("accuracy", { meters: format.number(Math.round(live.accuracy)) })}</AppText>
            ) : null}
          </>
        );
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      >
        {header}
        {banner}
        {error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={load} /> : null}

        <View style={styles.section}>
          <AppText testID="shift-title" accessibilityRole="header" weight="bold" size="title">
            {isolateAuto(shiftTitle(shift))}
          </AppText>
          <Field testID="shift-project" label={t("project")} value={shift.project?.name ? isolateAuto(shift.project.name) : t("notSet")} />
          <Field testID="shift-site" label={t("site")} value={shift.site?.name ? isolateAuto(shift.site.name) : t("notSet")} />
          <Field testID="shift-date" label={t("date")} value={format.date(shift.scheduledStart)} />
          <Field testID="shift-hours" label={t("hours")} value={hours} />
          <Field testID="shift-check-in-method" label={t("checkInMethod")} value={enumLabel("CheckInMethod", shift.checkInMethod)} />
          {shift.checkInMethod === CheckInMethod.FLEXI_CHECK ? <AppText color={colors.muted}>{t("flexiHint")}</AppText> : null}
          <Field testID="shift-manager" label={t("manager")} value={managerName ? isolateAuto(managerName) : t("notSet")} />
          <View style={styles.field} testID="shift-instructions">
            <AppText color={colors.muted}>{t("instructions")}</AppText>
            <AppText>{instructions ? isolateAuto(instructions) : t("noInstructions")}</AppText>
          </View>
        </View>

        <View style={styles.section}>
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("map")}
          </AppText>
          <View style={styles.distance}>{distanceView()}</View>
          <SiteMap
            testID="shift-map"
            geofence={target}
            points={points}
            worker={live.status === "located" ? { latitude: live.latitude, longitude: live.longitude, accuracy: live.accuracy } : null}
          />
          {target ? <AppText size="small" color={colors.muted}>{tLocation("estimateNote")}</AppText> : null}
          {activePoints.length > 0 ? (
            <View style={styles.points} testID="shift-temporary-points">
              <AppText weight="semibold">{t("temporaryPoints")}</AppText>
              {activePoints.map((point) => (
                <AppText key={point.id}>{t("temporaryPoint", { name: isolateAuto(point.name), time: format.time(point.expiresAt) })}</AppText>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingBottom: spacing.xl },
  section: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.md },
  field: { gap: 2 },
  distance: { gap: spacing.xs },
  points: { gap: spacing.xs },
});
