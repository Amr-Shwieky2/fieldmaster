import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslations } from "use-intl";
import type { EvidencePhoto } from "@fieldmaster/api-client";
import { useEnumLabel, useErrorMessage, useFormat } from "../../i18n/hooks";
import { useAuth } from "../../lib/auth-context";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";
import { Button } from "../Button";
import { ReviewCard } from "./ReviewCard";

/** The photo being viewed: its short-lived URL lives only here, in component state, and is dropped on close. */
type Viewer = { photo: EvidencePhoto; status: "loading" } | { photo: EvidencePhoto; status: "ready"; url: string } | { photo: EvidencePhoto; status: "failed"; cause: unknown };

/**
 * The entry's attendance photos. Nothing is downloaded until a photo is
 * tapped: each view asks the API for a short-lived URL (the view is audited)
 * and shows it with expo-image without any cache (`cachePolicy="none"`), so
 * the photo is never stored on the phone. The URL is kept only in this
 * component's state and forgotten when the viewer closes.
 */
export function EntryPhotos({ timeEntryId, photos }: { timeEntryId: string; photos: readonly EvidencePhoto[] }) {
  const t = useTranslations("review.photos");
  const tc = useTranslations("common");
  const enumLabel = useEnumLabel();
  const format = useFormat();
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // Answers that arrive after the viewer was closed (or another photo was opened) are ignored.
  const latest = useRef(0);

  async function open(photo: EvidencePhoto) {
    const request = ++latest.current;
    setViewer({ photo, status: "loading" });
    try {
      const answer = await client.getEntryPhotoViewUrl(timeEntryId, photo.id);
      if (request === latest.current) setViewer({ photo, status: "ready", url: answer.url });
    } catch (cause) {
      if (request === latest.current) setViewer({ photo, status: "failed", cause });
    }
  }

  function close() {
    latest.current += 1;
    setViewer(null);
  }

  const labelOf = (photo: EvidencePhoto) =>
    photo.eventType
      ? t("item", { event: enumLabel("ClockEventType", photo.eventType), time: format.dateTime(photo.uploadedAt) })
      : t("itemNoEvent", { time: format.dateTime(photo.uploadedAt) });

  return (
    <ReviewCard title={t("title")} testID="entry-photos">
      {photos.length === 0 ? <AppText color={colors.muted}>{t("none")}</AppText> : null}
      {photos.map((photo) => (
        <Pressable
          key={photo.id}
          testID={`photo-${photo.id}`}
          accessibilityRole="button"
          accessibilityLabel={labelOf(photo)}
          accessibilityHint={t("openHint")}
          onPress={() => void open(photo)}
          style={({ pressed }) => [styles.photo, pressed && styles.pressed]}
        >
          <Ionicons name="image-outline" size={28} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
          <AppText weight="semibold" color={colors.primary} style={styles.photoLabel}>
            {labelOf(photo)}
          </AppText>
        </Pressable>
      ))}

      <Modal visible={viewer !== null} animationType="fade" onRequestClose={close} supportedOrientations={["portrait", "landscape"]}>
        <SafeAreaView style={styles.viewer}>
          <View style={styles.viewerHeader}>
            <AppText accessibilityRole="header" weight="bold" size="large" color={colors.primaryText} style={styles.photoLabel}>
              {viewer ? labelOf(viewer.photo) : t("viewerTitle")}
            </AppText>
            <Button label={tc("close")} variant="secondary" onPress={close} />
          </View>
          <View style={styles.viewerBody}>
            {viewer?.status === "loading" ? (
              <View style={styles.centered} accessibilityRole="progressbar" accessibilityLabel={t("loading")}>
                <ActivityIndicator size="large" color={colors.primaryText} />
                <AppText color={colors.primaryText} align="center">
                  {t("loading")}
                </AppText>
              </View>
            ) : null}
            {viewer?.status === "ready" ? (
              <Image
                testID="photo-viewer-image"
                source={{ uri: viewer.url }}
                cachePolicy="none"
                contentFit="contain"
                accessibilityLabel={labelOf(viewer.photo)}
                style={styles.image}
                onError={() => setViewer((current) => (current && current.status === "ready" ? { photo: current.photo, status: "failed", cause: null } : current))}
              />
            ) : null}
            {viewer?.status === "failed" ? (
              <View style={styles.centered}>
                <AppText accessibilityRole="alert" weight="semibold" color={colors.primaryText} align="center">
                  {viewer.cause ? `${t("loadError")}\n${errorMessage(viewer.cause)}` : t("loadError")}
                </AppText>
                <Button label={tc("retry")} variant="secondary" onPress={() => void open(viewer.photo)} />
              </View>
            ) : null}
          </View>
          <AppText size="small" color={colors.primaryText} align="center" style={styles.privacy}>
            {t("privacy")}
          </AppText>
        </SafeAreaView>
      </Modal>
    </ReviewCard>
  );
}

const styles = StyleSheet.create({
  photo: {
    minHeight: TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.background,
  },
  pressed: { opacity: 0.85 },
  photoLabel: { flex: 1 },
  viewer: { flex: 1, backgroundColor: "#0f172a" },
  viewerHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  viewerBody: { flex: 1, justifyContent: "center" },
  centered: { alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  image: { flex: 1, width: "100%" },
  privacy: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
});
