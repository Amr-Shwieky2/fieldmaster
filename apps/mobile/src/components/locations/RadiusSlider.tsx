import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Slider from "@react-native-community/slider";
import { useTranslations } from "use-intl";
import { colors, spacing, TOUCH_TARGET } from "../../lib/theme";
import { AppText } from "../AppText";

/** The step of the slider and of the − / + buttons: 5 m, or 10 m over a wide range. */
export function radiusStep(min: number, max: number): number {
  return max - min > 500 ? 10 : 5;
}

/**
 * The geofence radius in meters, between the organization's bounds: a slider
 * for a quick change and − / + buttons for an exact one (gloves, sunlight).
 * The value is always shown in meters. The slider is not a controlled
 * component: it gets a new position from the buttons or a change made
 * elsewhere, never back from its own drag (that would stutter on Android).
 */
export function RadiusSlider({
  min,
  max,
  value,
  onChange,
  disabled = false,
}: {
  min: number;
  max: number;
  value: number;
  onChange: (meters: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("workLocation");
  const clamp = (meters: number) => Math.min(max, Math.max(min, meters));
  const [position, setPosition] = useState(() => clamp(value));
  const step = radiusStep(min, max);
  /** The last value this control sent: any other value came from elsewhere and moves the thumb. */
  const sent = useRef(value);

  useEffect(() => {
    if (value === sent.current) return;
    sent.current = value;
    setPosition(Math.min(max, Math.max(min, value)));
  }, [value, min, max]);

  function send(meters: number) {
    sent.current = meters;
    onChange(meters);
  }

  function nudge(direction: 1 | -1) {
    // From an off-step value (a site's radius set elsewhere) the first press lands on the step grid.
    const next = clamp(direction === 1 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step);
    setPosition(next);
    send(next);
  }

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <AppText weight="semibold" style={styles.flex}>
          {t("radiusLabel")}
        </AppText>
        <AppText testID="radius-value" weight="bold" size="large" color={colors.primary}>
          {t("radiusValue", { meters: String(value) })}
        </AppText>
      </View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("radiusDecrease")}
          accessibilityState={{ disabled: disabled || value <= min }}
          disabled={disabled || value <= min}
          onPress={() => nudge(-1)}
          style={({ pressed }) => [styles.nudge, (disabled || value <= min) && styles.disabled, pressed && styles.pressed]}
        >
          <View style={styles.bar} />
        </Pressable>
        <Slider
          testID="radius-slider"
          accessibilityLabel={t("radiusLabel")}
          style={styles.slider}
          minimumValue={min}
          maximumValue={max}
          step={step}
          value={position}
          disabled={disabled}
          onValueChange={(meters) => send(clamp(Math.round(meters)))}
          minimumTrackTintColor={colors.primary}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.primary}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("radiusIncrease")}
          accessibilityState={{ disabled: disabled || value >= max }}
          disabled={disabled || value >= max}
          onPress={() => nudge(1)}
          style={({ pressed }) => [styles.nudge, (disabled || value >= max) && styles.disabled, pressed && styles.pressed]}
        >
          <View style={styles.bar} />
          <View style={[styles.bar, styles.barCross]} />
        </Pressable>
      </View>
      <AppText size="small" color={colors.muted}>
        {t("radiusRange", { min: String(min), max: String(max) })}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  slider: { flex: 1, height: TOUCH_TARGET },
  nudge: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  bar: { position: "absolute", width: 20, height: 3, borderRadius: 2, backgroundColor: colors.primary },
  barCross: { transform: [{ rotate: "90deg" }] },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});
