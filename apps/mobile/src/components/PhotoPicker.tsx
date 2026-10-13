import { useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useTranslations } from "use-intl";
import { MAX_ATTENDANCE_PHOTOS } from "@fieldmaster/shared-types";
import { useOfflineSync } from "../lib/offline-sync-context";
import { compressPhoto, type AttendancePhoto } from "../lib/photos";
import { colors, spacing, TOUCH_TARGET } from "../lib/theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

type Failure = "cameraDenied" | "failed";

/**
 * Optional work photos for a clock-in or clock-out: from the camera or the
 * gallery, compressed on the phone (see lib/photos.ts), at most
 * MAX_ATTENDANCE_PHOTOS. Photos are uploaded when the worker submits (the
 * screen does it), so a cancelled clock-in sends nothing. They need the
 * network: offline, adding is switched off and the notice says so (the clock
 * event itself can still be saved on the phone, without the photos).
 */
export function PhotoPicker({
  photos,
  onChange,
  disabled = false,
}: {
  photos: AttendancePhoto[];
  onChange: (photos: AttendancePhoto[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("photos");
  const { isOnline } = useOfflineSync();
  const [processing, setProcessing] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const remaining = MAX_ATTENDANCE_PHOTOS - photos.length;
  const canAdd = !disabled && !processing && isOnline && remaining > 0;

  async function add(assets: ImagePicker.ImagePickerAsset[]) {
    setProcessing(true);
    try {
      const added: AttendancePhoto[] = [];
      for (const asset of assets.slice(0, remaining)) added.push(await compressPhoto(asset));
      onChange([...photos, ...added].slice(0, MAX_ATTENDANCE_PHOTOS));
    } catch {
      setFailure("failed");
    } finally {
      setProcessing(false);
    }
  }

  async function takePhoto() {
    if (!canAdd) return;
    setFailure(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission?.granted) {
        setFailure("cameraDenied");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false });
      if (!result.canceled && result.assets?.length) await add(result.assets);
    } catch {
      setFailure("failed");
    }
  }

  async function pickFromGallery() {
    if (!canAdd) return;
    setFailure(null);
    try {
      // The system photo picker needs no permission; it is limited to the photos still allowed.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: remaining > 1,
        selectionLimit: remaining,
        quality: 1,
        exif: false,
      });
      if (!result.canceled && result.assets?.length) await add(result.assets);
    } catch {
      setFailure("failed");
    }
  }

  function remove(key: string) {
    onChange(photos.filter((photo) => photo.key !== key));
  }

  return (
    <View style={styles.section} testID="photo-picker">
      <View style={styles.titleRow}>
        <AppText weight="semibold">{t("title")}</AppText>
        <AppText testID="photo-count" color={colors.muted}>
          {t("count", { count: photos.length, max: MAX_ATTENDANCE_PHOTOS })}
        </AppText>
      </View>

      {photos.length > 0 ? (
        <View style={styles.thumbnails}>
          {photos.map((photo, index) => (
            <View key={photo.key} style={styles.thumbnail}>
              <Image source={{ uri: photo.uri }} style={styles.image} accessibilityLabel={t("thumbnail", { index: index + 1 })} />
              <Pressable
                testID="photo-remove"
                accessibilityRole="button"
                accessibilityLabel={t("remove", { index: index + 1 })}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => remove(photo.key)}
                hitSlop={8}
                style={styles.remove}
              >
                <AppText size="small" weight="semibold" color={colors.danger} align="center">
                  {t("removeShort")}
                </AppText>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {!isOnline ? (
        <AppText color={colors.warning} weight="semibold">
          {t("offline")}
        </AppText>
      ) : remaining <= 0 ? (
        <AppText color={colors.muted}>{t("limitReached", { max: MAX_ATTENDANCE_PHOTOS })}</AppText>
      ) : null}
      {failure ? (
        <AppText accessibilityRole="alert" color={colors.danger} weight="semibold">
          {t(failure)}
        </AppText>
      ) : null}

      <View style={styles.buttons}>
        <Button
          testID="photo-take"
          label={t("takePhoto")}
          variant="secondary"
          disabled={!canAdd}
          busy={processing}
          busyLabel={t("processing")}
          onPress={takePhoto}
          style={styles.button}
        />
        <Button testID="photo-gallery" label={t("pickFromGallery")} variant="secondary" disabled={!canAdd} onPress={pickFromGallery} style={styles.button} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  thumbnails: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  thumbnail: { width: 84, gap: spacing.xs, alignItems: "center" },
  image: { width: 84, height: 84, borderRadius: 10, backgroundColor: colors.border },
  remove: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.xs },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  // Side by side when both labels fit on one line, one under the other on a phone.
  button: { flexGrow: 1, flexBasis: 220, minHeight: TOUCH_TARGET },
});
