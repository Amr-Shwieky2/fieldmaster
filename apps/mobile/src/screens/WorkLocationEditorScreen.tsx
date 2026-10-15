import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { CreateWorkLocationInput, Project, UpdateWorkLocationInput, WorkLocation, WorkLocationDefaults } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto, isolateLtr } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { ChoiceChips } from "../components/locations/ChoiceChips";
import { FieldError, FormField } from "../components/locations/FormField";
import { OptionRow } from "../components/locations/OptionRow";
import { RadiusSlider } from "../components/locations/RadiusSlider";
import { SavedConfirmation } from "../components/locations/SavedConfirmation";
import { parseShekels } from "../components/locations/money";
import { FALLBACK_REGION, readPosition, regionAround } from "../components/locations/position";
import { Circle, MapView, Marker, type LatLng, type Region } from "../components/maps/Map";
import { useErrorMessage, useFormat } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import type { LocationFailure } from "../lib/location";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "WorkLocationEditor">;

type ProjectMode = "existing" | "new";

interface Loaded {
  defaults: WorkLocationDefaults;
  /** The projects to pick from (a new location only). */
  projects: Project[];
  /** The location being edited; null for a new one. */
  original: WorkLocation | null;
}

/** The geofence's circle fill: the primary colour, faint. */
const CIRCLE_FILL = "rgba(37, 99, 235, 0.16)";
/** Projects listed before «عرض كل المشاريع». */
const VISIBLE_PROJECTS = 6;

/** Where an edited location's circle is now: its geofence, or the site's point while it has none. */
function centerOf(location: WorkLocation): LatLng {
  return location.geofence
    ? { latitude: location.geofence.centerLatitude, longitude: location.geofence.centerLongitude }
    : { latitude: location.latitude, longitude: location.longitude };
}

/** An optional text as the API stores it: trimmed, null when blank. */
const optionalText = (value: string | null | undefined) => value?.trim() || null;

/** The app's settings page, where a permanently refused location permission is turned back on. */
async function openAppSettings() {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing else to offer: the message on screen already says what to do.
  }
}

/**
 * A work location from the phone (MANAGE_SITES): a new one (no `siteId`) or
 * an existing one. The map starts on the phone's position (or on the site);
 * the pin moves with «استخدم موقعي الحالي», by dragging it or by a tap on the
 * map, and a circle shows the geofence radius set with the slider. A new
 * location is saved in ONE request with its geofence (and, when asked, a new
 * project: the server does it in one transaction); an edit sends only the
 * fields that changed. Amounts of money (the new project's budget) appear
 * only for a member holding VIEW_FINANCIALS.
 */
export function WorkLocationEditorScreen({ navigation, route }: Props) {
  const siteId = route.params?.siteId ?? null;
  const editing = siteId !== null;
  const t = useTranslations("workLocation");
  const tc = useTranslations("common");
  const tStates = useTranslations("states");
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { can, restricted } = useAccess();
  const allowed = can(Permission.MANAGE_SITES);
  const canSeeMoney = can(Permission.VIEW_FINANCIALS);
  // A member restricted to some projects only picks one of theirs: the API refuses a new project from them.
  const canCreateProject = !restricted;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [instructions, setInstructions] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState(0);
  const [projectMode, setProjectMode] = useState<ProjectMode>("existing");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [allProjectsShown, setAllProjectsShown] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectClient, setNewProjectClient] = useState("");
  const [budget, setBudget] = useState("");

  const mapRef = useRef<MapView | null>(null);
  /** Set once the map is shown: later moves animate it instead. */
  const regionShown = useRef(false);
  const [initialRegion, setInitialRegion] = useState<Region | null>(null);
  const [locating, setLocating] = useState(false);
  const locatingNow = useRef(false);
  const [locationFailure, setLocationFailure] = useState<LocationFailure | null>(null);
  const [located, setLocated] = useState(false);
  /** While the pin is dragged the page does not scroll (the drag would scroll it on Android). */
  const [dragging, setDragging] = useState(false);
  /** The radius now, for a position that arrives after a later render. */
  const radiusNow = useRef(radius);
  radiusNow.current = radius;

  /** The first save attempt shows what is missing. */
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [nothingChanged, setNothingChanged] = useState(false);
  const [saved, setSaved] = useState<{ kind: "created" | "updated"; name: string; radius: number } | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function showRegion(region: Region) {
    if (regionShown.current) {
      mapRef.current?.animateToRegion(region, 400);
      return;
    }
    regionShown.current = true;
    setInitialRegion(region);
  }

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [defaults, projects, original] = await Promise.all([
        client.getWorkLocationDefaults(),
        siteId ? Promise.resolve<Project[]>([]) : client.listProjects(),
        siteId ? client.getWorkLocation(siteId) : Promise.resolve(null),
      ]);
      if (!mounted.current) return;
      const clamp = (meters: number) => Math.min(defaults.maxRadiusMeters, Math.max(defaults.minRadiusMeters, meters));
      if (original) {
        const center = centerOf(original);
        // The site's own radius as it is (even outside today's bounds): only a change by the manager is sent.
        const meters = original.geofence?.radiusMeters ?? clamp(defaults.defaultGeofenceRadiusMeters);
        setName(original.name);
        setAddress(original.address ?? "");
        setInstructions(original.instructions ?? "");
        setEmergencyContact(original.emergencyContact ?? "");
        setPin(center);
        setRadius(meters);
        if (!regionShown.current) showRegion(regionAround(center, meters));
      } else {
        setRadius(clamp(defaults.defaultGeofenceRadiusMeters));
        if (projects.length === 1) setProjectId(projects[0].id);
        if (projects.length === 0) setProjectMode("new");
      }
      setLoaded({ defaults, projects, original });
    } catch (cause) {
      if (mounted.current) setLoadError(cause ?? new Error());
    }
  }, [client, siteId]);

  /** Moves the pin to the phone's position (`first`: the map is not shown yet, it starts there). */
  async function locate(first: boolean) {
    if (locatingNow.current) return;
    locatingNow.current = true;
    setLocating(true);
    setLocationFailure(null);
    try {
      const result = await readPosition();
      if (!mounted.current) return;
      if (result.ok) {
        const point = { latitude: result.reading.latitude, longitude: result.reading.longitude };
        setPin(point);
        setLocated(true);
        setNothingChanged(false);
        showRegion(regionAround(point, radiusNow.current || 100));
      } else {
        setLocationFailure(result.failure);
        // No position: the map opens on the whole country and the manager places the pin by hand.
        if (first && !regionShown.current) showRegion(FALLBACK_REGION);
      }
    } finally {
      locatingNow.current = false;
      if (mounted.current) setLocating(false);
    }
  }

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  // A new location starts where the manager stands (an existing one starts on the site instead).
  // Once on opening: `locate` only uses refs and state setters.
  useEffect(() => {
    if (allowed && !editing) void locate(true);
  }, [allowed, editing]);

  function movePin(coordinate: LatLng) {
    setPin({ latitude: coordinate.latitude, longitude: coordinate.longitude });
    setNothingChanged(false);
  }

  const header = <ScreenHeader title={editing ? t("editTitle") : t("createTitle")} onBack={() => navigation.goBack()} />;

  if (!allowed) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <EmptyView title={tStates("accessDeniedTitle")} hint={tStates("accessDeniedDescription")} />
      </SafeAreaView>
    );
  }

  if (saved) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <SavedConfirmation
          title={saved.kind === "created" ? t("createdTitle") : t("updatedTitle")}
          lines={[saved.name, t("savedRadius", { meters: String(saved.radius) })]}
          doneLabel={tc("back")}
          onDone={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        {loadError ? <ErrorView message={`${t("loadError")}\n${errorMessage(loadError)}`} onRetry={() => void load()} /> : <LoadingView />}
      </SafeAreaView>
    );
  }

  const { defaults, projects, original } = loaded;
  const effectiveMode: ProjectMode = canCreateProject ? projectMode : "existing";
  const budgetInput = parseShekels(budget);

  // What is missing or wrong (shown after the first save attempt).
  const problems = {
    name: name.trim() === "",
    pin: pin === null,
    project: !original && effectiveMode === "existing" && !projects.some((project) => project.id === projectId),
    newProjectName: !original && effectiveMode === "new" && newProjectName.trim() === "",
    budget: !original && effectiveMode === "new" && canSeeMoney && budgetInput.kind === "invalid",
  };
  const valid = !Object.values(problems).some(Boolean);

  function newProject(): NonNullable<CreateWorkLocationInput["newProject"]> {
    const project: NonNullable<CreateWorkLocationInput["newProject"]> = { name: newProjectName.trim() };
    const clientName = optionalText(newProjectClient);
    if (clientName) project.client = clientName;
    // Money only from a member who may see it: for anyone else the field is not shown and nothing is sent.
    if (canSeeMoney && budgetInput.kind === "ok") project.budgetAgorot = budgetInput.agorot;
    return project;
  }

  function createInput(at: LatLng): CreateWorkLocationInput {
    const input: CreateWorkLocationInput = {
      ...(effectiveMode === "existing" && projectId ? { projectId } : { newProject: newProject() }),
      name: name.trim(),
      latitude: at.latitude,
      longitude: at.longitude,
      geofenceRadiusMeters: radius,
    };
    const addressText = optionalText(address);
    const instructionsText = optionalText(instructions);
    const contactText = optionalText(emergencyContact);
    if (addressText) input.address = addressText;
    if (instructionsText) input.instructions = instructionsText;
    if (contactText) input.emergencyContact = contactText;
    return input;
  }

  /** Only what the manager changed. A site without a geofence yet gets one: its center and radius are always sent. */
  function changedFields(location: WorkLocation, at: LatLng): UpdateWorkLocationInput {
    const changes: UpdateWorkLocationInput = {};
    if (name.trim() !== location.name.trim()) changes.name = name.trim();
    if (optionalText(address) !== optionalText(location.address)) changes.address = optionalText(address);
    if (optionalText(instructions) !== optionalText(location.instructions)) changes.instructions = optionalText(instructions);
    if (optionalText(emergencyContact) !== optionalText(location.emergencyContact)) changes.emergencyContact = optionalText(emergencyContact);
    const center = centerOf(location);
    const noGeofence = location.geofence === null;
    if (noGeofence || at.latitude !== center.latitude || at.longitude !== center.longitude) {
      changes.latitude = at.latitude;
      changes.longitude = at.longitude;
    }
    if (noGeofence || radius !== location.geofence?.radiusMeters) changes.geofenceRadiusMeters = radius;
    return changes;
  }

  async function save() {
    if (inFlight.current) return;
    setAttempted(true);
    setNothingChanged(false);
    setSaveError(null);
    if (!valid || !pin) return;
    const changes = original ? changedFields(original, pin) : null;
    if (changes && Object.keys(changes).length === 0) {
      setNothingChanged(true);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      if (original && changes) await client.updateWorkLocation(original.id, changes);
      else await client.createWorkLocation(createInput(pin));
      if (mounted.current) setSaved({ kind: original ? "updated" : "created", name: name.trim(), radius });
    } catch (cause) {
      if (mounted.current) setSaveError(cause ?? new Error());
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  function locationFailureText(failure: LocationFailure): string {
    switch (failure.kind) {
      case "permission":
        return failure.canAskAgain ? t("permissionDenied") : t("permissionSettings");
      case "servicesOff":
        return t("servicesOff");
      case "location":
        return t("unavailable");
    }
  }

  const hiddenProjects = allProjectsShown ? 0 : Math.max(0, projects.length - VISIBLE_PROJECTS);
  const shownProjects = hiddenProjects > 0 ? projects.filter((project, index) => index < VISIBLE_PROJECTS || project.id === projectId) : projects;

  const projectChooser = (
    <>
      {canCreateProject ? (
        <ChoiceChips
          label={t("projectSection")}
          testIDPrefix="project-mode"
          choices={[
            { value: "existing", label: t("existingProject") },
            { value: "new", label: t("newProject") },
          ]}
          value={projectMode}
          onChange={setProjectMode}
          disabled={saving}
        />
      ) : (
        <AppText size="small" color={colors.muted}>
          {t("restrictedHint")}
        </AppText>
      )}
      {effectiveMode === "existing" ? (
        projects.length === 0 ? (
          <AppText color={colors.muted}>{t("noProjects")}</AppText>
        ) : (
          <View accessibilityRole="radiogroup" accessibilityLabel={t("chooseProject")} style={styles.options}>
            {shownProjects.map((project) => (
              <OptionRow
                key={project.id}
                testID={`project-${project.id}`}
                role="radio"
                selected={project.id === projectId}
                disabled={saving}
                onPress={() => setProjectId(project.id)}
              >
                <AppText weight="semibold">{project.name}</AppText>
                {project.client ? (
                  <AppText size="small" color={colors.muted}>
                    {t("projectClient", { client: isolateAuto(project.client) })}
                  </AppText>
                ) : null}
              </OptionRow>
            ))}
            {hiddenProjects > 0 ? (
              <Button variant="link" label={t("showAllProjects", { count: String(projects.length) })} onPress={() => setAllProjectsShown(true)} />
            ) : null}
          </View>
        )
      ) : (
        <>
          <FormField
            testID="new-project-name"
            label={t("newProjectName")}
            value={newProjectName}
            onChangeText={setNewProjectName}
            editable={!saving}
            error={attempted && problems.newProjectName ? t("newProjectNameRequired") : null}
          />
          <FormField testID="new-project-client" label={t("client")} value={newProjectClient} onChangeText={setNewProjectClient} editable={!saving} />
          {canSeeMoney ? (
            <FormField
              testID="new-project-budget"
              label={t("budget")}
              value={budget}
              onChangeText={setBudget}
              keyboardType="decimal-pad"
              ltr
              editable={!saving}
              error={attempted && problems.budget ? t("budgetInvalid") : null}
              note={
                budgetInput.kind === "ok" ? (
                  <AppText size="small" color={colors.muted}>
                    {t("budgetPreview", { amount: isolateLtr(format.money(budgetInput.agorot)) })}
                  </AppText>
                ) : null
              }
            />
          ) : null}
        </>
      )}
      {attempted && problems.project ? <FieldError message={t("projectRequired")} /> : null}
    </>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets scrollEnabled={!dragging}>
        {header}
        <ConnectionBanner disabled={saving} onPress={() => navigation.navigate("OfflineQueue")} />

        <View style={styles.section}>
          <View style={styles.mapBox}>
            {initialRegion ? (
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={initialRegion}
                showsUserLocation={located}
                accessibilityLabel={t("mapLabel")}
                onPress={(event) => movePin(event.nativeEvent.coordinate)}
              >
                {pin ? <Circle center={pin} radius={radius} strokeWidth={2} strokeColor={colors.primary} fillColor={CIRCLE_FILL} /> : null}
                {pin ? (
                  <Marker
                    coordinate={pin}
                    draggable
                    title={t("pinTitle")}
                    onDragStart={() => setDragging(true)}
                    onDragEnd={(event) => {
                      setDragging(false);
                      movePin(event.nativeEvent.coordinate);
                    }}
                  />
                ) : null}
              </MapView>
            ) : (
              <LoadingView label={t("locating")} />
            )}
          </View>
          <AppText size="small" color={colors.muted}>
            {pin ? t("pinHint") : t("pinMissingHint")}
          </AppText>
          {locationFailure ? (
            <View style={styles.notice}>
              <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" weight="semibold" color={colors.warning}>
                {locationFailureText(locationFailure)}
              </AppText>
              {locationFailure.kind === "permission" && !locationFailure.canAskAgain ? (
                <Button label={t("openSettings")} variant="secondary" onPress={openAppSettings} />
              ) : null}
            </View>
          ) : null}
          <Button
            testID="use-my-location"
            label={t("useMyLocation")}
            variant="secondary"
            busy={locating}
            busyLabel={t("locating")}
            disabled={saving}
            onPress={() => void locate(false)}
          />
          {attempted && problems.pin ? <FieldError message={t("pinRequired")} /> : null}
          <RadiusSlider min={defaults.minRadiusMeters} max={defaults.maxRadiusMeters} value={radius} onChange={setRadius} disabled={saving} />
          {original ? (
            <AppText size="small" color={colors.muted}>
              {original.geofence ? t("geofenceChangeHint") : t("noGeofenceYet")}
            </AppText>
          ) : null}
        </View>

        <View style={styles.section}>
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("detailsSection")}
          </AppText>
          <FormField
            testID="work-location-name"
            label={t("name")}
            value={name}
            onChangeText={setName}
            editable={!saving}
            error={attempted && problems.name ? t("nameRequired") : null}
          />
          <FormField testID="work-location-address" label={t("address")} value={address} onChangeText={setAddress} editable={!saving} />
          <FormField
            testID="work-location-instructions"
            label={t("instructions")}
            value={instructions}
            onChangeText={setInstructions}
            multiline
            editable={!saving}
          />
          <FormField
            testID="work-location-emergency-contact"
            label={t("emergencyContact")}
            value={emergencyContact}
            onChangeText={setEmergencyContact}
            editable={!saving}
          />
        </View>

        <View style={styles.section}>
          <AppText accessibilityRole="header" weight="bold" size="large">
            {t("projectSection")}
          </AppText>
          {original ? (
            <>
              <AppText size="large">{original.projectName}</AppText>
              <AppText size="small" color={colors.muted}>
                {t("projectFixed")}
              </AppText>
            </>
          ) : (
            projectChooser
          )}
        </View>

        {saveError ? <ErrorView message={errorMessage(saveError)} /> : null}
        <View style={styles.actions}>
          {nothingChanged ? (
            <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" weight="semibold" color={colors.muted}>
              {t("noChanges")}
            </AppText>
          ) : null}
          {attempted && !valid ? <FieldError message={t("fixErrors")} /> : null}
          <Button
            testID="work-location-save"
            label={original ? t("saveChanges") : t("create")}
            busy={saving}
            busyLabel={t("saving")}
            onPress={() => void save()}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, paddingBottom: spacing.xl * 2 },
  section: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.md },
  mapBox: { height: 280, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  map: { flex: 1 },
  notice: { gap: spacing.sm, padding: spacing.md, borderRadius: 14, backgroundColor: colors.warningSoft },
  options: { gap: spacing.sm },
  actions: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, gap: spacing.md },
});
