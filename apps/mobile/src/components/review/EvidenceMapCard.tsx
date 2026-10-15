import { StyleSheet, View } from "react-native";
import { useTranslations } from "use-intl";
import type { EvidenceTemporaryPoint, TimeEntryEvidence } from "@fieldmaster/api-client";
import { ClockEventType } from "@fieldmaster/shared-types";
import { useEnumLabel, useFormat } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { isolateAuto } from "../LtrText";
import { Circle, MapView, Marker, type Region } from "../maps/Map";
import { ReviewCard } from "./ReviewCard";

/** Colors shared by the map and its legend (the admin web's evidence map colors). */
export const EVIDENCE_COLORS = {
  geofence: "#2563eb",
  temporaryPoint: "#16a34a",
  clockIn: "#059669",
  clockOut: "#4f46e5",
  rejected: "#dc2626",
} as const;

type EvidenceColor = keyof typeof EVIDENCE_COLORS;

interface Area {
  key: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  color: EvidenceColor;
  label: string;
}

interface Point {
  key: string;
  latitude: number;
  longitude: number;
  color: EvidenceColor;
  label: string;
}

const METERS_PER_DEGREE = 111_320;
const MIN_DELTA = 0.004;

/** A region showing every area and point, with some room around them. */
export function regionFor(areas: readonly Area[], points: readonly Point[]): Region | null {
  const boxes = [
    ...areas.map((area) => {
      const latSpan = area.radiusMeters / METERS_PER_DEGREE;
      const lngSpan = area.radiusMeters / (METERS_PER_DEGREE * Math.max(0.1, Math.cos((area.latitude * Math.PI) / 180)));
      return { minLat: area.latitude - latSpan, maxLat: area.latitude + latSpan, minLng: area.longitude - lngSpan, maxLng: area.longitude + lngSpan };
    }),
    ...points.map((point) => ({ minLat: point.latitude, maxLat: point.latitude, minLng: point.longitude, maxLng: point.longitude })),
  ];
  if (boxes.length === 0) return null;
  const minLat = Math.min(...boxes.map((box) => box.minLat));
  const maxLat = Math.max(...boxes.map((box) => box.maxLat));
  const minLng = Math.min(...boxes.map((box) => box.minLng));
  const maxLng = Math.max(...boxes.map((box) => box.maxLng));
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(MIN_DELTA, (maxLat - minLat) * 1.5),
    longitudeDelta: Math.max(MIN_DELTA, (maxLng - minLng) * 1.5),
  };
}

/**
 * Where things happened (read-only): the shift's geofence (or, for a
 * Flexi-Check shift, the site's default radius), the temporary check-in points
 * used, a marker per clock event (in / out) and per refused attempt.
 * Everything on the map is also listed in text below it, with the details of
 * each refused attempt.
 */
export function EvidenceMapCard({ evidence }: { evidence: TimeEntryEvidence }) {
  const tMap = useTranslations("review.map");
  const tAttempts = useTranslations("review.attempts");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const meters = (value: number | null | undefined) => format.number(value === null || value === undefined ? null : Math.round(value));
  const attemptReason = (code: string) => (tAttempts.has(`codes.${code}`) ? tAttempts(`codes.${code}`) : tAttempts("unknownCode"));
  const { shift } = evidence;

  const areas: Area[] = [];
  if (shift.geofence) {
    areas.push({
      key: "geofence",
      latitude: shift.geofence.centerLatitude,
      longitude: shift.geofence.centerLongitude,
      radiusMeters: shift.geofence.radiusMeters,
      color: "geofence",
      label: tMap("geofence", { radius: meters(shift.geofence.radiusMeters) }),
    });
  } else if (shift.site) {
    areas.push({
      key: "site",
      latitude: shift.site.latitude,
      longitude: shift.site.longitude,
      radiusMeters: shift.site.defaultGeofenceRadiusMeters,
      color: "geofence",
      label: tMap("site", { name: isolateAuto(shift.site.name), radius: meters(shift.site.defaultGeofenceRadiusMeters) }),
    });
  }
  const temporaryPoints = new Map<string, EvidenceTemporaryPoint>();
  for (const item of [...evidence.clockEvents, ...evidence.rejectedAttempts]) {
    if (item.temporaryCheckInPoint) temporaryPoints.set(item.temporaryCheckInPoint.id, item.temporaryCheckInPoint);
  }
  for (const point of temporaryPoints.values()) {
    areas.push({
      key: `point-${point.id}`,
      latitude: point.latitude,
      longitude: point.longitude,
      radiusMeters: point.radiusMeters,
      color: "temporaryPoint",
      label: tMap("temporaryPoint", { name: isolateAuto(point.name), radius: meters(point.radiusMeters) }),
    });
  }

  const eventPoints: Point[] = evidence.clockEvents.map((event) => {
    const values = {
      event: enumLabel("ClockEventType", event.eventType),
      accuracy: meters(event.accuracyMeters),
      outcome: enumLabel("LocationValidationStatus", event.locationValidationStatus),
    };
    return {
      key: event.id,
      latitude: event.latitude,
      longitude: event.longitude,
      color: event.eventType === ClockEventType.CLOCK_IN ? "clockIn" : "clockOut",
      label:
        event.distanceFromSiteMeters === null
          ? tMap("eventPointNoDistance", values)
          : tMap("eventPoint", { ...values, distance: meters(event.distanceFromSiteMeters) }),
    };
  });
  const attemptPoints: Point[] = evidence.rejectedAttempts.map((attempt) => ({
    key: attempt.id,
    latitude: attempt.latitude,
    longitude: attempt.longitude,
    color: "rejected",
    label: tAttempts("marker", { event: enumLabel("ClockEventType", attempt.eventType), reason: attemptReason(attempt.code) }),
  }));
  const points = [...eventPoints, ...attemptPoints];
  const region = regionFor(areas, points);

  return (
    <ReviewCard title={tMap("title")} testID="evidence-map">
      {region ? (
        <>
          <View style={styles.mapFrame} accessible accessibilityLabel={tMap("label")}>
            <MapView key={evidence.id} style={styles.map} initialRegion={region} rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false}>
              {areas.map((area) => (
                <Circle
                  key={area.key}
                  center={{ latitude: area.latitude, longitude: area.longitude }}
                  radius={area.radiusMeters}
                  strokeColor={EVIDENCE_COLORS[area.color]}
                  fillColor={`${EVIDENCE_COLORS[area.color]}22`}
                  strokeWidth={2}
                />
              ))}
              {points.map((point) => (
                <Marker
                  key={point.key}
                  coordinate={{ latitude: point.latitude, longitude: point.longitude }}
                  title={point.label}
                  pinColor={EVIDENCE_COLORS[point.color]}
                />
              ))}
            </MapView>
          </View>
          <AppText weight="semibold">{tMap("legend")}</AppText>
          {[...areas, ...eventPoints].map((item) => (
            <LegendRow key={item.key} color={EVIDENCE_COLORS[item.color]} label={item.label} />
          ))}
        </>
      ) : (
        <AppText color={colors.muted}>{tMap("nothing")}</AppText>
      )}

      <AppText accessibilityRole="header" weight="bold" style={styles.subheading}>
        {evidence.rejectedAttempts.length === 0 ? tAttempts("title") : tAttempts("count", { count: evidence.rejectedAttempts.length })}
      </AppText>
      {evidence.rejectedAttempts.length === 0 ? <AppText color={colors.muted}>{tAttempts("none")}</AppText> : null}
      {evidence.rejectedAttempts.map((attempt) => {
        const details =
          attempt.distanceMeters !== null
            ? attempt.allowedRadiusMeters !== null
              ? tAttempts("distanceValue", { distance: meters(attempt.distanceMeters), allowed: meters(attempt.allowedRadiusMeters) })
              : tAttempts("distanceOnly", { distance: meters(attempt.distanceMeters) })
            : attempt.requiredAccuracyMeters !== null
              ? tAttempts("accuracyValue", { accuracy: meters(attempt.accuracyMeters), required: meters(attempt.requiredAccuracyMeters) })
              : attempt.deviationSeconds !== null
                ? tAttempts("deviationValue", { seconds: format.number(attempt.deviationSeconds) })
                : null;
        return (
          <View key={attempt.id} style={styles.attempt} testID={`attempt-${attempt.id}`}>
            <LegendRow
              color={EVIDENCE_COLORS.rejected}
              label={tAttempts("item", {
                event: enumLabel("ClockEventType", attempt.eventType),
                time: format.dateTime(attempt.serverReceivedAt),
                reason: attemptReason(attempt.code),
              })}
              strong
            />
            {details ? <AppText size="small">{details}</AppText> : null}
            {attempt.temporaryCheckInPoint ? (
              <AppText size="small" color={colors.muted}>
                {tAttempts("atTemporaryPoint", { name: isolateAuto(attempt.temporaryCheckInPoint.name) })}
              </AppText>
            ) : null}
            <AppText size="small" color={colors.muted}>
              {tAttempts("origin", { origin: enumLabel("EventOrigin", attempt.origin) })}
            </AppText>
          </View>
        );
      })}
    </ReviewCard>
  );
}

function LegendRow({ color, label, strong = false }: { color: string; label: string; strong?: boolean }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <AppText size="small" weight={strong ? "semibold" : "regular"} style={styles.legendText}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  mapFrame: { height: 260, borderRadius: 12, overflow: "hidden", marginVertical: spacing.xs },
  map: { flex: 1 },
  legendRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 8 },
  legendText: { flex: 1 },
  subheading: { marginTop: spacing.sm },
  attempt: { gap: 2, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
});
