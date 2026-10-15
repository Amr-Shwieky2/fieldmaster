import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "../../lib/theme";
import { AppText } from "../AppText";
import { Button } from "../Button";

/** How long a confirmation stays before the screen goes back by itself (tests shorten it). */
export const confirmationTiming = { ms: 1800 };

/**
 * What was just saved (a work location, a published shift): shown in place
 * of the form, then the screen goes back by itself after a moment, or at
 * once with the button. `onDone` runs once.
 */
export function SavedConfirmation({ title, lines, doneLabel, onDone }: { title: string; lines: string[]; doneLabel: string; onDone: () => void }) {
  const finished = useRef(false);
  const latestOnDone = useRef(onDone);
  latestOnDone.current = onDone;

  function finish() {
    if (finished.current) return;
    finished.current = true;
    latestOnDone.current();
  }

  // Once, when the confirmation appears (`finish` reads the latest `onDone`).
  useEffect(() => {
    const timer = setTimeout(finish, confirmationTiming.ms);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View testID="saved-confirmation" style={styles.box}>
      <View style={styles.badge}>
        <View style={styles.tick} />
      </View>
      <AppText accessibilityRole="alert" accessibilityLiveRegion="polite" weight="bold" size="title" color={colors.success}>
        {title}
      </AppText>
      {lines.map((line, index) => (
        <AppText key={index} size="large">
          {line}
        </AppText>
      ))}
      <Button label={doneLabel} onPress={finish} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { margin: spacing.xl, padding: spacing.xl, gap: spacing.md, borderRadius: 16, backgroundColor: colors.successSoft },
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.success, alignItems: "center", justifyContent: "center" },
  // A drawing (a tick), not text direction: the same shape in both directions.
  tick: { width: 24, height: 13, borderLeftWidth: 4, borderBottomWidth: 4, borderColor: colors.primaryText, transform: [{ rotate: "-45deg" }], marginTop: -5 }, // rtl-ok
  button: { marginTop: spacing.sm },
});
