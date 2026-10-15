import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import type { Project, Site } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import { AppText } from "../components/AppText";
import { Button } from "../components/Button";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { isolateAuto } from "../components/LtrText";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyView, ErrorView, LoadingView } from "../components/StateViews";
import { useErrorMessage } from "../i18n/hooks";
import { useAccess } from "../lib/access-context";
import { useAuth } from "../lib/auth-context";
import { colors, spacing } from "../lib/theme";
import type { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "WorkLocations">;

/** `GET /sites` rows carry the site's address too (the `Site` type does not list it yet). */

/**
 * The work locations the member may manage (MANAGE_SITES; only their
 * projects' sites when restricted, the API scopes the list): name, project
 * and address. A tap opens one for editing; «موقع عمل جديد» adds one. The
 * list reloads whenever the screen comes back into view (after a save).
 */
export function WorkLocationsScreen({ navigation }: Props) {
  const t = useTranslations("workLocations");
  const tStates = useTranslations("states");
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const { can } = useAccess();
  const allowed = can(Permission.MANAGE_SITES);

  const [sites, setSites] = useState<Site[]>([]);
  const [projectNames, setProjectNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The last load failure, rendered in Arabic at render time. */
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!allowed) return;
    const request = ++latest.current;
    setError(null);
    try {
      // The project names only label the rows: without them the sites still show.
      const [rows, projects] = await Promise.all([client.listSites(), client.listProjects().catch((): Project[] | null => null)]);
      if (request !== latest.current) return;
      setSites(rows);
      if (projects) setProjectNames(new Map(projects.map((project) => [project.id, project.name])));
      setLoaded(true);
    } catch (cause) {
      if (request === latest.current) setError(cause ?? new Error());
    } finally {
      if (request === latest.current) setRefreshing(false);
    }
  }, [allowed, client]);

  // On every focus: the first visit, and back from the editor with a new or changed location.
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

  const header = <ScreenHeader title={t("title")} onBack={() => navigation.goBack()} />;

  if (!allowed) {
    return (
      <SafeAreaView style={styles.screen}>
        {header}
        <EmptyView title={tStates("accessDeniedTitle")} hint={tStates("accessDeniedDescription")} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {header}
      <ConnectionBanner onPress={() => navigation.navigate("OfflineQueue")} />
      <View style={styles.add}>
        <Button testID="work-location-add" label={t("add")} onPress={() => navigation.navigate("WorkLocationEditor")} />
      </View>

      {!loaded && !error ? (
        <LoadingView />
      ) : (
        <FlatList
          testID="work-locations-list"
          data={loaded ? sites : []}
          keyExtractor={(site) => site.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          ListHeaderComponent={error ? <ErrorView message={`${t("loadError")}\n${errorMessage(error)}`} onRetry={onRetry} /> : null}
          ListEmptyComponent={loaded ? <EmptyView title={t("empty")} hint={t("emptyHint")} /> : null}
          renderItem={({ item: site }) => {
            const projectName = projectNames.get(site.projectId);
            const address = site.address?.trim();
            return (
              <Pressable
                testID={`work-location-${site.id}`}
                accessibilityRole="button"
                accessibilityHint={t("openHint")}
                onPress={() => navigation.navigate("WorkLocationEditor", { siteId: site.id })}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <AppText weight="bold" size="large">
                  {site.name}
                </AppText>
                {projectName ? <AppText color={colors.muted}>{t("project", { name: isolateAuto(projectName) })}</AppText> : null}
                <AppText color={address ? colors.text : colors.muted}>{address ? t("address", { address: isolateAuto(address) }) : t("noAddress")}</AppText>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  add: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  list: { paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.md,
  },
  pressed: { opacity: 0.85 },
});
