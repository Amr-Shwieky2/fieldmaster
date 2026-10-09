import { AppText, type AppTextProps } from "./AppText";

/** Left-to-right isolate: keeps "+972...", coordinates or a code in order inside Arabic text. */
const LRI = "\u2066";
/** First-strong isolate: user text (names, titles, summaries) in any script, without reordering the sentence around it. */
const FSI = "\u2068";
/** Pop directional isolate: closes LRI / FSI. */
const PDI = "\u2069";

export function isolateLtr(value: string): string {
  return `${LRI}${value}${PDI}`;
}

export function isolateAuto(value: string): string {
  return `${FSI}${value}${PDI}`;
}

/**
 * A left-to-right value (phone number, code, coordinates) shown inside the RTL
 * layout: the paragraph stays RTL (start-aligned on the right like all other
 * text) and only the value is isolated, so "+972..." keeps its order.
 */
export function LtrText({ children, ...props }: Omit<AppTextProps, "children"> & { children: string }) {
  return <AppText {...props}>{isolateLtr(children)}</AppText>;
}
