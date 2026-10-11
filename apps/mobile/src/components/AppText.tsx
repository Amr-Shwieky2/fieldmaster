import { Platform, Text, type TextProps, type TextStyle } from "react-native";
import { colors, fonts, lineHeightFor, textSizes, textStart, type FontWeightName } from "../lib/theme";

export interface AppTextProps extends TextProps {
  weight?: FontWeightName;
  size?: keyof typeof textSizes;
  color?: string;
  /** "start" (default, the right edge in RTL) or "center". */
  align?: "start" | "center";
}

// react-native-web gives Text dir="auto", which would show a Latin-first string as an LTR paragraph.
const WEB_RTL = Platform.OS === "web" ? ({ dir: "rtl" } as object) : null;

/**
 * Every piece of text in the app: IBM Plex Sans Arabic, large sizes, Arabic
 * line height, start-aligned in RTL. Use this instead of Text from
 * react-native (an ESLint rule enforces it).
 */
export function AppText({ weight = "regular", size = "body", color = colors.text, align = "start", style, ...props }: AppTextProps) {
  const fontSize = textSizes[size];
  const base: TextStyle = {
    fontFamily: fonts[weight],
    fontSize,
    lineHeight: lineHeightFor(fontSize),
    color,
    ...(align === "center" ? { textAlign: "center" } : textStart),
  };
  return <Text {...WEB_RTL} {...props} style={[base, style]} />;
}
