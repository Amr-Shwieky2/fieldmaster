import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { AssignableWorker, Site } from "@fieldmaster/api-client";
import { getErrorCode } from "@fieldmaster/i18n";
import { CheckInMethod, Permission, ShiftType } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView } from "../components/StateViews";
import { ChoiceChips } from "../components/locations/ChoiceChips";
import { DateTimeField } from "../components/locations/DateTimeField";
import { FieldError, FormField } from "../components/locations/FormField";
import { OptionRow } from "../components/locations/OptionRow";
import { SavedConfirmation } from "../components/locations/SavedConfirmation";
import { defaultShiftTimes, shiftWindow, type ShiftWindow } from "../components/locations/business-time";
import { nearestFirst, readPosition } from "../components/locations/position";
import type { LatLng } from "../components/maps/Map";
import { useEnumLabel, useErrorMessage, useFormat, useShiftTitle } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "NewShift">;

/** `GET /sites` rows carry the site's address too (the `Site` type does not list it yet). */

/** A shift a worker already has at that time (from the workers list, or from the server's 409). */
export interface OverlappingShift {
  shiftId?: string;
  title: string;
  scheduledStart: string;
  scheduledEnd: string;
}

type WorkersState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; list: AssignableWorker[] }
  | { status: "error"; cause: unknown };

/** An emergency call-out is started by the system, never planned (as on the admin web). */
const SHIFT_TYPES = [ShiftType.STANDARD, ShiftType.DAY_TURAN, ShiftType.NIGHT_TURAN] as const;
const CHECK_IN_METHODS = [CheckInMethod.GEOFENCED, CheckInMethod.FLEXI_CHECK] as const;
/** Sites listed (nearest first) before «عرض كل المواقع». */
const VISIBLE_SITES = 5;

/** A worker's row: red once the server refused them, amber with an overlapping shift. */
function workerTone(refusedByServer: boolean, overlaps: boolean): "normal" | "warning" | "danger" {
  if (refusedByServer) return "danger";
  return overlaps ? "warning" : "normal";
}

function isOverlappingShift(value: unknown): value is OverlappingShift {
  if (typeof value !== "object" || value === null) return false;
  const shift = value as Record<string, unknown>;
  return typeof shift.title === "string" && typeof shift.scheduledStart === "string" && typeof shift.scheduledEnd === "string";
}

/**
 * The workers a 409 SHIFT_ASSIGNMENT_CONFLICT refused (`details.conflicts`:
 * `{ workerProfileId, shifts }[]`) with their overlapping shifts; null for
 * any other error. Nothing was created then.
 */
export function assignmentConflicts(error: unknown): Map<string, OverlappingShift[]> | null {
  if (getErrorCode(error) !== "SHIFT_ASSIGNMENT_CONFLICT") return null;
  const details = (error as { body?: { details?: unknown } }).body?.details;
  const list = typeof details === "object" && details !== null ? (details as { conflicts?: unknown }).conflicts : undefined;
  const refused = new Map<string, OverlappingShift[]>();
  if (!Array.isArray(list)) return refused;
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { workerProfileId, shifts } = entry as { workerProfileId?: unknown; shifts?: unknown };
    if (typeof workerProfileId === "string") refused.set(workerProfileId, Array.isArray(shifts) ? shifts.filter(isOverlappingShift) : []);
  }
  return refused;
}

/**
 * A new shift with its workers, from the phone (MANAGE_SHIFTS): the site
 * (nearest to the manager first), a title (the site's name until edited),
 * the shift type, the business date and times in Asia/Jerusalem (an end
 * before the start ends the next day: a night shift) and the check-in
 * method. Once the site and times are set, the workers of the manager's
 * projects are listed with any shift they already have at that time; such a
 * worker can still be picked, but the warning says the server will refuse
 * them. «نشر الوردية» creates the shift and its assignments in one request;
 * a 409 conflict marks the refused workers and creates nothing.
 */
export function NewShiftScreen({ navigation }: Props) {
  const t = useTranslations("newShift");
  const tc = useTranslations("common");
  const tStates = useTranslations("states");
  const format = useFormat();
  const enumLabel = useEnumLabel();
  const shiftTitle = useShiftTitle();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { can } = useAccess();
  const allowed = can(Permission.MANAGE_SHIFTS);

  const [sites, setSites] = useState<Site[] | null>(null);
  const [sitesError, setSitesError] = useState<unknown>(null);
  /** undefined while locating, null when the position is unknown. */
  const [position, setPosition] = useState<LatLng | null | undefined>(undefined);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [allSitesShown, setAllSitesShown] = useState(false);

  const [initialTimes] = useState(() => defaultShiftTimes());
  const [title, setTitle] = useState("");
  /** The manager typed a title: choosing another site no longer replaces it. */
  const titleTyped = useRef(false);
  const [shiftType, setShiftType] = useState<ShiftType>(ShiftType.STANDARD);
  const [day, setDay] = useState(initialTimes.day);
  const [start, setStart] = useState(initialTimes.start);
  const [end, setEnd] = useState(initialTimes.end);
  const [checkInMethod, setCheckInMethod] = useState<CheckInMethod>(CheckInMethod.GEOFENCED);

  const [workers, setWorkers] = useState<WorkersState>({ status: "idle" });
  const [workersRequest, setWorkersRequest] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  /** Workers the server refused (409) for these times, with their overlapping shifts. */
  const [refused, setRefused] = useState<ReadonlyMap<string, OverlappingShift[]>>(new Map());

  const [attempted, setAttempted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const inFlight = useRef(false);
  const [publishError, setPublishError] = useState<{ kind: "conflict" } | { kind: "request"; cause: unknown } | null>(null);
  const [published, setPublished] = useState<{ title: string; slot: ShiftWindow; workers: number } | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadSites = useCallback(async () => {
    setSitesError(null);
    try {
      const rows = await client.listSites();
      if (mounted.current) setSites(rows);
    } catch (cause) {
      if (mounted.current) setSitesError(cause ?? new Error());
    }
  }, [client]);

  useEffect(() => {
    if (allowed) void loadSites();
  }, [allowed, loadSites]);

  // The sites are listed once the position is known (or known to be unavailable): they never reorder under a finger.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    void readPosition().then((result) => {
      if (!cancelled) setPosition(result.ok ? { latitude: result.reading.latitude, longitude: result.reading.longitude } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const slot = useMemo(() => shiftWindow(day, start, end), [day, start, end]);
  const startIso = slot?.start.toISOString() ?? null;
  const endIso = slot?.end.toISOString() ?? null;
  const hasSite = siteId !== null;

  // The workers free (or not) at those times, once the site and times are set; again whenever the times change.
  useEffect(() => {
    if (!allowed || !hasSite || !startIso || !endIso) {
      setWorkers({ status: "idle" });
      return;
    }
    let cancelled = false;
    setWorkers({ status: "loading" });
    // What the server refused was about the previous times.
    setRefused(new Map());
    setPublishError((current) => (current?.kind === "conflict" ? null : current));
    client.listAssignableWorkers(startIso, endIso).then(
      (list) => {
        if (cancelled) return;
        setWorkers({ status: "loaded", list });
        // A worker no longer offered for these times leaves the selection.
        setSelected((current) => new Set(list.map((worker) => worker.workerProfileId).filter((id) => current.has(id))));
      },
      (cause: unknown) => {
        if (!cancelled) setWorkers({ status: "error", cause: cause ?? new Error() });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [allowed, client, hasSite, startIso, endIso, workersRequest]);

  const orderedSites = useMemo(() => (sites && position !== undefined ? nearestFirst(sites, position) : []), [sites, position]);
  const site = sites?.find((row) => row.id === siteId) ?? null;

  function chooseSite(row: Site) {
    setSiteId(row.id);
    if (!titleTyped.current) setTitle(row.name);
  }

  function toggleWorker(workerProfileId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(workerProfileId)) next.delete(workerProfileId);
      else next.add(workerProfileId);
      return next;
    });
  }

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;

  if (!allowed) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <EmptyView title={tStates("accessDeniedTitle")} hint={tStates("accessDeniedDescription")} />
      </SafeAreaView>
    );
  }

  function whenText(shift: ShiftWindow): string {
    const values = { date: format.date(shift.start), start: format.time(shift.start), end: format.time(shift.end) };
    return shift.overnight ? t("whenOvernight", values) : t("when", values);
  }

  if (published) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <SavedConfirmation
          title={t("publishedTitle")}
          lines={[published.title, whenText(published.slot), t("publishedWorkers", { count: String(published.workers) })]}
          doneLabel={tc("back")}
          onDone={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  const workerList = workers.status === "loaded" ? workers.list : [];
  const hasConflict = (worker: AssignableWorker) => worker.conflicts.length > 0 || refused.has(worker.workerProfileId);
  const selectedWithConflicts = workerList.filter((worker) => selected.has(worker.workerProfileId) && hasConflict(worker));
  const problems = { site: site === null, title: title.trim() === "", times: slot === null };
  const valid = !problems.site && !problems.title && !problems.times;

  async function publish() {
    if (inFlight.current) return;
    setAttempted(true);
    setPublishError(null);
    if (!valid || !site || !slot) return;
    // The list's order when it is there (it is, unless its last load failed).
    const workerProfileIds = workers.status === "loaded" ? workerList.map((worker) => worker.workerProfileId).filter((id) => selected.has(id)) : [...selected];
    const shiftTitleText = title.trim();
    inFlight.current = true;
    setPublishing(true);
    try {
      await client.createShiftWithWorkers({
        siteId: site.id,
        title: shiftTitleText,
        shiftType,
        scheduledStart: slot.start.toISOString(),
        scheduledEnd: slot.end.toISOString(),
        checkInMethod,
        workerProfileIds,
      });
      if (mounted.current) setPublished({ title: shiftTitleText, slot, workers: workerProfileIds.length });
    } catch (cause) {
      if (!mounted.current) return;
      const conflicts = assignmentConflicts(cause);
      if (conflicts) {
        setRefused(conflicts);
        setPublishError({ kind: "conflict" });
      } else {
        setPublishError({ kind: "request", cause: cause ?? new Error() });
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setPublishing(false);
    }
  }

  function distanceText(meters: number): string {
    if (meters < 1000) return t("distanceMeters", { meters: String(Math.round(meters)) });
    return t("distanceKm", { km: format.number(meters / 1000, { maximumFractionDigits: 1 }) });
  }

  function overlapText(shift: OverlappingShift): string {
    return t("conflictLine", {
      title: isolateAuto(shiftTitle({ title: shift.title })),
      date: format.date(shift.scheduledStart),
      start: format.time(shift.scheduledStart),
      end: format.time(shift.scheduledEnd),
    });
  }

  const hiddenSites = allSitesShown ? 0 : Math.max(0, orderedSites.length - VISIBLE_SITES);
  const shownSites = hiddenSites > 0 ? orderedSites.filter(({ item }, index) => index < VISIBLE_SITES || item.id === siteId) : orderedSites;
  const sitesReady = sites !== null && position !== undefined;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {header}
        <ConnectionBanner disabled={publishing} onPress={() => navigation.navigate("OfflineQueue")} />

        <View style={styles.section}>
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("siteSection")}
          </AppText>
          {sitesError ? null : !sitesReady ? (
            <InlineLoading label={position === undefined ? t("locatingSites") : tc("loading")} />
          ) : orderedSites.length === 0 ? (
            <EmptyView title={t("noSites")} hint={t("noSitesHint")} />
          ) : (
            <>
              <AppText size="small" color={colors.muted}>
                {position ? t("nearestFirst") : t("noPosition")}
              </AppText>
              <View accessibilityRole="radiogroup" accessibilityLabel={t("siteSection")} style={styles.options}>
                {shownSites.map(({ item: row, meters }) => {
                  const rowAddress = row.address?.trim();
                  return (
                    <OptionRow key={row.id} testID={`site-${row.id}`} role="radio" selected={row.id === siteId} disabled={publishing} onPress={() => chooseSite(row)}>
                      <AppText weight="semibold">{row.name}</AppText>
                      {meters !== null ? (
                        <AppText size="small" color={colors.muted}>
                          {distanceText(meters)}
                        </AppText>
                      ) : null}
                      {rowAddress ? (
                        <AppText size="small" color={colors.muted}>
                          {isolateAuto(rowAddress)}
                        </AppText>
                      ) : null}
                    </OptionRow>
                  );
                })}
                {hiddenSites > 0 ? (
                  <Button variant="link" label={t("showAllSites", { count: String(orderedSites.length) })} onPress={() => setAllSitesShown(true)} />
                ) : null}
              </View>
            </>
          )}
          {attempted && problems.site && sitesReady && orderedSites.length > 0 ? <FieldError message={t("siteRequired")} /> : null}
        </View>
        {sitesError ? <ErrorView message={`${t("loadError")}\n${errorMessage(sitesError)}`} onRetry={() => void loadSites()} /> : null}

        <View style={styles.section}>
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("detailsSection")}
          </AppText>
          <FormField
            testID="shift-title"
            label={t("titleLabel")}
            value={title}
            onChangeText={(text) => {
              titleTyped.current = text.length > 0;
              setTitle(text);
            }}
            editable={!publishing}
            error={attempted && problems.title ? t("titleRequired") : null}
          />
          <AppText weight="semibold">{t("shiftType")}</AppText>
          <ChoiceChips
            label={t("shiftType")}
            testIDPrefix="shift-type"
            choices={SHIFT_TYPES.map((type) => ({ value: type, label: enumLabel("ShiftType", type) }))}
            value={shiftType}
            onChange={setShiftType}
            disabled={publishing}
          />
          <DateTimeField
            testID="shift-date"
            label={t("date")}
            mode="date"
            day={day}
            display={format.businessDate(day)}
            onChange={setDay}
            disabled={publishing}
          />
          <DateTimeField
            testID="shift-start"
            label={t("start")}
            mode="time"
            day={day}
            time={start}
            display={start}
            onChange={setStart}
            disabled={publishing}
          />
          <DateTimeField
            testID="shift-end"
            label={t("end")}
            mode="time"
            day={day}
            time={end}
            display={end}
            note={slot?.overnight ? t("endsNextDay", { date: format.businessDate(slot.endDay) }) : null}
            onChange={setEnd}
            disabled={publishing}
          />
          {slot === null ? <FieldError message={t("sameTimes")} /> : null}
          <AppText weight="semibold">{t("checkInMethod")}</AppText>
          <ChoiceChips
            label={t("checkInMethod")}
            testIDPrefix="check-in-method"
            choices={CHECK_IN_METHODS.map((method) => ({ value: method, label: enumLabel("CheckInMethod", method) }))}
            value={checkInMethod}
            onChange={setCheckInMethod}
            disabled={publishing}
          />
        </View>

        <View style={styles.section}>
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("workersSection")}
          </AppText>
          {workers.status === "idle" ? (
            <AppText color={colors.muted}>{t("workersHint")}</AppText>
          ) : workers.status === "loading" ? (
            <InlineLoading label={t("workersLoading")} />
          ) : workers.status === "error" ? null : workers.list.length === 0 ? (
            <AppText color={colors.muted}>{t("noWorkers")}</AppText>
          ) : (
            <>
              <AppText size="small" color={colors.muted}>
                {t("selectedCount", { count: String(workerList.filter((worker) => selected.has(worker.workerProfileId)).length) })}
              </AppText>
              <View style={styles.options}>
                {workers.list.map((worker) => {
                  const refusedShifts = refused.get(worker.workerProfileId);
                  const overlapping = refusedShifts && refusedShifts.length > 0 ? refusedShifts : worker.conflicts;
                  const tone = workerTone(refusedShifts !== undefined, worker.conflicts.length > 0);
                  return (
                    <OptionRow
                      key={worker.workerProfileId}
                      testID={`worker-${worker.workerProfileId}`}
                      role="checkbox"
                      selected={selected.has(worker.workerProfileId)}
                      tone={tone}
                      disabled={publishing}
                      onPress={() => toggleWorker(worker.workerProfileId)}
                    >
                      <AppText weight="semibold">{worker.fullLegalName}</AppText>
                      {refusedShifts ? (
                        <Badge label={t("refusedBadge")} color={colors.danger} />
                      ) : worker.conflicts.length > 0 ? (
                        <Badge label={t("conflictBadge")} color={colors.warning} />
                      ) : null}
                      {overlapping.map((shift, index) => (
                        <AppText key={shift.shiftId ?? index} size="small" color={tone === "danger" ? colors.danger : colors.warning}>
                          {overlapText(shift)}
                        </AppText>
                      ))}
                    </OptionRow>
                  );
                })}
              </View>
            </>
          )}
        </View>
        {workers.status === "error" ? (
          <ErrorView message={`${t("workersLoadError")}\n${errorMessage(workers.cause)}`} onRetry={() => setWorkersRequest((count) => count + 1)} />
        ) : null}

        {publishError ? <ErrorView message={publishError.kind === "conflict" ? t("conflictError") : errorMessage(publishError.cause)} /> : null}
        <View style={styles.actions}>
          {selectedWithConflicts.length > 0 ? (
            <View style={styles.warning}>
              <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" weight="semibold" color={colors.warning}>
                {t("conflictWarning", { count: String(selectedWithConflicts.length) })}
              </AppText>
            </View>
          ) : null}
          {attempted && !valid ? <FieldError message={t("fixErrors")} /> : null}
          <Button
            testID="publish-shift"
            label={t("publish")}
            busy={publishing}
            busyLabel={t("publishing")}
            disabled={workers.status === "loading"}
            onPress={() => void publish()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** A small "loading…" line inside a section. */
function InlineLoading({ label }: { label: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.inlineLoading}>
      <ActivityIndicator color={colors.primary} />
      <AppText color={colors.muted}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingBottom: spacing.xl * 2 },
  section: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.md },
  options: { gap: spacing.sm },
  inlineLoading: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  warning: { padding: spacing.md, borderRadius: 14, backgroundColor: colors.warningSoft },
  actions: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.md },
});
