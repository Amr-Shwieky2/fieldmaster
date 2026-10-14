import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslations } from "use-intl";
import { useFormat } from "../i18n/hooks";
import { colors, spacing } from "../lib/theme";
import { AppText } from "./AppText";
import { Button } from "./Button";
import { LtrText } from "./LtrText";

export interface ClockReceiptProps {
  action: "CLOCK_IN" | "CLOCK_OUT";
  /** Saved on the phone and waiting to sync: the server has not seen it yet. */
  queued: boolean;
  title: string;
  shiftTitle?: string | null;
  /** The screen's own lines (the time, the duration, the approval note, ...). */
  children?: ReactNode;
  /** The server's time for the event (ISO); null when not known yet. */
  serverTime: string | null;
  /** The phone's own time when the worker pressed the button (ISO). */
  deviceTime: string;
  /** The server's clock event id, or the client event id while the event waits on the phone. */
  referenceId: string;
  /** What was not sent, and why (e.g. photos need the network). */
  notes?: string[];
  doneLabel: string;
  onDone: () => void;
}

function Row({ label, children, testID }: { label: string; children: ReactNode; testID: string }) {
  return (
    <View style={styles.row} testID={testID}>
      <AppText color={colors.muted}>{label}</AppText>
      {children}
    </View>
  );
}

/**
 * Proof of a clock-in or clock-out for the worker: what was recorded, the
 * server's time and the phone's own time (both in Asia/Jerusalem), whether it
 * reached the server, and a reference to quote to a manager. It stays until
 * the worker taps the button.
 */
export function ClockReceipt({ action, queued, title, shiftTitle, children, serverTime, deviceTime, referenceId, notes = [], doneLabel, onDone }: ClockReceiptProps) {
  const t = useTranslations("receipt");
  const tc = useTranslations("common");
  const format = useFormat();
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View
          aria-live="polite"
          testID="clock-receipt"
          style={[styles.card, { backgroundColor: queued ? colors.warningSoft : colors.successSoft }]}
        >
          <AppText accessibilityRole="header" size="title" weight="bold" color={queued ? colors.warning : colors.success}>
            {title}
          </AppText>
          {shiftTitle ? (
            <AppText testID="receipt-shift" size="large" weight="semibold">
              {shiftTitle}
            </AppText>
          ) : null}
          {children}

          <View style={styles.rows}>
            <Row label={t("action")} testID="receipt-action">
              <AppText weight="semibold">{action === "CLOCK_IN" ? tc("clockIn") : tc("clockOut")}</AppText>
            </Row>
            <Row label={t("serverTime")} testID="receipt-server-time">
              <AppText weight="semibold">{queued ? t("serverTimePending") : format.dateTime(serverTime)}</AppText>
            </Row>
            <Row label={t("deviceTime")} testID="receipt-device-time">
              <AppText weight="semibold">{format.dateTime(deviceTime)}</AppText>
            </Row>
            <Row label={t("syncState")} testID="receipt-sync-state">
              <AppText weight="semibold" color={queued ? colors.warning : colors.success}>
                {queued ? t("pending") : t("synced")}
              </AppText>
            </Row>
            <Row label={t("reference")} testID="receipt-reference">
              <LtrText testID="receipt-reference-id" size="small" selectable>
                {referenceId}
              </LtrText>
            </Row>
          </View>

          {notes.map((note) => (
            <AppText key={note} color={colors.warning} weight="semibold">
              {note}
            </AppText>
          ))}
        </View>
        <View style={styles.actions}>
          <Button testID="receipt-done" label={doneLabel} onPress={onDone} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: spacing.xl, gap: spacing.xl },
  card: { marginHorizontal: spacing.xl, borderRadius: 16, padding: spacing.xl, gap: spacing.md },
  rows: { gap: spacing.sm, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  row: { gap: 2 },
  actions: { paddingHorizontal: spacing.xl, gap: spacing.md },
});
