import { forwardRef } from "react";
import { Platform, TextInput, type TextInputProps } from "react-native";
import { colors, fonts, lineHeightFor, textSizes, textStart, TOUCH_TARGET } from "../lib/theme";

export interface AppTextInputProps extends TextInputProps {
  /** Left-to-right content such as a phone number or a code (still start-aligned in the RTL layout). */
  ltr?: boolean;
}

/** Text input with the Arabic font and large touch size. Use it instead of TextInput from react-native. */
export const AppTextInput = forwardRef<TextInput, AppTextInputProps>(function AppTextInput({ ltr = false, style, multiline, ...props }, ref) {
  const fontSize = textSizes.large;
  const webDir = Platform.OS === "web" ? ({ dir: ltr ? "ltr" : "rtl" } as object) : null;
  return (
    <TextInput
      ref={ref}
      {...webDir}
      placeholderTextColor={colors.muted}
      multiline={multiline}
      {...props}
      style={[
        {
          fontFamily: fonts.regular,
          fontSize,
          lineHeight: lineHeightFor(fontSize),
          color: colors.text,
          minHeight: multiline ? 112 : TOUCH_TARGET,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: colors.card,
          textAlignVertical: multiline ? "top" : "center",
          writingDirection: ltr ? "ltr" : "rtl",
          // Android ignores writingDirection; an LTR view keeps "+972..." from showing as "...972+".
          ...(ltr && Platform.OS !== "web" ? { direction: "ltr" as const } : null),
        },
        // LTR content (a phone number, a code) still lines up with the start edge of the RTL form: the right.
        ltr ? { textAlign: "right" } : textStart, // rtl-ok: the field itself is LTR, so "right" is the RTL start edge
        style,
      ]}
    />
  );
});
