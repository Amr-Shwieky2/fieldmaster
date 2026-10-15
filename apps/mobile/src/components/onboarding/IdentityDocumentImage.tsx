import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTranslations } from "use-intl";
import type { FieldMasterClient, UploadedFileSummary } from "@fieldmaster/api-client";
import { useErrorMessage } from "../../i18n/hooks";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { Button } from "../Button";

type State = { status: "idle" } | { status: "loading" } | { status: "shown"; url: string } | { status: "broken" } | { status: "failed"; cause: unknown };

/**
 * The uploaded identity document, fetched only when asked: each press asks
 * the API for a new short-lived signed URL (an audited view) and the image is
 * shown without any cache (memory or disk). Nothing outlives this component:
 * leaving the details drops the URL with it. A PDF is not opened on the phone
 * (it would land in another app's cache): the admin web opens it.
 */
export function IdentityDocumentImage({ client, document }: { client: FieldMasterClient; document: UploadedFileSummary }) {
  const t = useTranslations("onboardingReview");
  const errorMessage = useErrorMessage();
  const [state, setState] = useState<State>({ status: "idle" });
  const alive = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  if (document.contentType === "application/pdf") {
    return <AppText color={colors.muted}>{t("idDocumentPdf")}</AppText>;
  }

  async function show() {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ status: "loading" });
    try {
      const view = await client.getFileAssetViewUrl(document.fileAssetId);
      if (alive.current) setState({ status: "shown", url: view.url });
    } catch (cause) {
      if (alive.current) setState({ status: "failed", cause: cause ?? new Error() });
    } finally {
      inFlight.current = false;
    }
  }

  if (state.status === "shown") {
    return (
      <Image
        testID="id-document-image"
        source={{ uri: state.url }}
        cachePolicy="none"
        contentFit="contain"
        accessibilityLabel={t("idImageLabel")}
        style={styles.image}
        onError={() => {
          if (alive.current) setState({ status: "broken" });
        }}
      />
    );
  }

  const message = state.status === "failed" ? `${t("idImageFailed")}\n${errorMessage(state.cause)}` : state.status === "broken" ? t("idImageExpired") : null;
  return (
    <View style={styles.box}>
      <Button
        testID="id-document-show"
        label={state.status === "broken" ? t("reloadIdImage") : t("showIdImage")}
        variant="secondary"
        busy={state.status === "loading"}
        busyLabel={t("loadingIdImage")}
        onPress={() => void show()}
      />
      {message ? (
        <AppText accessibilityRole="alert" weight="semibold" color={colors.danger}>
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs },
  image: { width: "100%", height: 260, borderRadius: 12, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
});
