import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import type { OperationsSnapshot } from "@fieldmaster/api-client";
import { toBusinessDay } from "@fieldmaster/i18n";
import { useFormat, useShiftTitle } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { Circle, MapView, Marker, type Region } from "../maps/Map";

export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** A circle around the point that must fit too (a site's geofence). */
  radiusMeters?: number;
}

const METERS_PER_DEGREE = 111_320;
/** Never closer than about a kilometre: a single worker is shown with their surroundings. */
const MIN_DELTA = 0.01;
/** Room around the outermost points. */
const PADDING = 1.4;

const SITE_FILL = "rgba(37, 99, 235, 0.12)";
const POINT_FILL = "rgba(21, 128, 61, 0.12)";

function isValidPoint(point: GeoPoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

/** The smallest region that shows every point (and its circle), with some room around; null without a valid point. */
export function fitRegion(points: readonly GeoPoint[]): Region | null {
  const valid = points.filter(isValidPoint);
  if (valid.length === 0) return null;
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of valid) {
    const radius = Math.max(point.radiusMeters ?? 0, 0);
    const latitudeSpan = radius / METERS_PER_DEGREE;
    const longitudeSpan = radius / (METERS_PER_DEGREE * Math.max(Math.cos((point.latitude * Math.PI) / 180), 0.01));
    south = Math.min(south, point.latitude - latitudeSpan);
    north = Math.max(north, point.latitude + latitudeSpan);
    west = Math.min(west, point.longitude - longitudeSpan);
    east = Math.max(east, point.longitude + longitudeSpan);
  }
  return {
    latitude: (south + north) / 2,
    longitude: (west + east) / 2,
    latitudeDelta: Math.max((north - south) * PADDING, MIN_DELTA),
    longitudeDelta: Math.max((east - west) * PADDING, MIN_DELTA),
  };
}

/** The positions of the workers on shift and of the running emergency call-outs. */
function livePoints(snapshot: OperationsSnapshot): GeoPoint[] {
  return [
    ...snapshot.workersOnShift.flatMap((entry) => (entry.position ? [{ latitude: entry.position.latitude, longitude: entry.position.longitude }] : [])),
    ...snapshot.activeEmergencies.map((emergency) => ({ latitude: emergency.start.latitude, longitude: emergency.start.longitude })),
  ];
}

/**
 * Where the map opens: around the workers on shift and the running call-outs;
 * without any, the first site (then the first temporary point); null when
 * there is nothing to show.
 */
export function initialRegionFor(snapshot: OperationsSnapshot): Region | null {
  const live = fitRegion(livePoints(snapshot));
  if (live) return live;
  for (const site of snapshot.sites) {
    const region = fitRegion([{ latitude: site.centerLatitude, longitude: site.centerLongitude, radiusMeters: site.radiusMeters }]);
    if (region) return region;
  }
  for (const point of snapshot.temporaryPoints) {
    const region = fitRegion([{ latitude: point.latitude, longitude: point.longitude, radiusMeters: point.radiusMeters }]);
    if (region) return region;
  }
  return null;
}

/**
 * The live operations map (no money): a blue circle per site geofence, a
 * green one per temporary check-in point, a pin per worker on shift at the
 * position of their last clock event (green when the location passed, orange
 * when it needs review, red on an emergency call-out) and a red pin where a
 * running call-out started. A pin's callout opens the entry's review when
 * `onOpenEntry` is given. Only clock events have a position: workers are
 * never tracked in between.
 */
export function LiveOperationsMap({
  snapshot,
  onOpenEntry,
  height = 240,
}: {
  snapshot: OperationsSnapshot;
  onOpenEntry?: (timeEntryId: string) => void;
  height?: number;
}) {
  const t = useTranslations("liveOperations");
  const format = useFormat();
  const shiftTitle = useShiftTitle();
  // react-native-maps applies initialRegion once, when the map mounts: later refreshes never move the map.
  const initialRegion = useMemo(() => initialRegionFor(snapshot), [snapshot]);

  if (!initialRegion) {
    return (
      <View style={[styles.empty, { height: height / 2 }]} testID="live-map-empty">
        <AppText color={colors.muted} align="center">
          {t("noMap")}
        </AppText>
      </View>
    );
  }

  const today = toBusinessDay(Date.now());
  const timeText = (value: string | null) => (value && toBusinessDay(value) !== today ? format.dateTime(value) : format.time(value));
  // A call-out whose worker already has a pin on shift is not pinned twice.
  const pinnedEntries = new Set(snapshot.workersOnShift.filter((entry) => entry.position).map((entry) => entry.timeEntryId));

  return (
    <View style={styles.container}>
      <MapView
        testID="live-map"
        style={[styles.map, { height }]}
        initialRegion={initialRegion}
        accessibilityLabel={t("mapLabel")}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {snapshot.sites.map((site) => (
          <Circle
            key={`site-${site.siteId}`}
            center={{ latitude: site.centerLatitude, longitude: site.centerLongitude }}
            radius={site.radiusMeters}
            strokeColor={colors.primary}
            fillColor={SITE_FILL}
            strokeWidth={2}
          />
        ))}
        {snapshot.temporaryPoints.map((point) => (
          <Circle
            key={`point-${point.id}`}
            center={{ latitude: point.latitude, longitude: point.longitude }}
            radius={point.radiusMeters}
            strokeColor={colors.success}
            fillColor={POINT_FILL}
            strokeWidth={2}
          />
        ))}
        {snapshot.workersOnShift.map((entry) =>
          entry.position ? (
            <Marker
              key={`worker-${entry.timeEntryId}`}
              identifier={`worker-${entry.timeEntryId}`}
              coordinate={{ latitude: entry.position.latitude, longitude: entry.position.longitude }}
              title={entry.worker.fullLegalName}
              description={t("mapWorker", { shift: shiftTitle(entry.shift), time: timeText(entry.position.at) })}
              pinColor={entry.isEmergency ? colors.danger : entry.position.locationValidationStatus === "PASSED" ? colors.success : colors.warning}
              onCalloutPress={onOpenEntry ? () => onOpenEntry(entry.timeEntryId) : undefined}
            />
          ) : null,
        )}
        {snapshot.activeEmergencies
          .filter((emergency) => !emergency.timeEntryId || !pinnedEntries.has(emergency.timeEntryId))
          .map((emergency) => {
            const timeEntryId = emergency.timeEntryId;
            return (
              <Marker
                key={`emergency-${emergency.calloutId}`}
                identifier={`emergency-${emergency.calloutId}`}
                coordinate={{ latitude: emergency.start.latitude, longitude: emergency.start.longitude }}
                title={emergency.worker.fullLegalName}
                description={t("mapEmergency", { time: timeText(emergency.actualStartClick) })}
                pinColor={colors.danger}
                onCalloutPress={onOpenEntry && timeEntryId ? () => onOpenEntry(timeEntryId) : undefined}
              />
            );
          })}
      </MapView>
      <AppText size="small" color={colors.muted}>
        {t("mapHelp")}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginHorizontal: spacing.xl, gap: spacing.xs },
  map: { borderRadius: 16, overflow: "hidden" },
  empty: {
    marginHorizontal: spacing.xl,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
});
