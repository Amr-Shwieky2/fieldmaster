import { readFileSync } from "node:fs";

/**
 * The one font family of every report: IBM Plex Sans Arabic (SIL Open Font
 * License, `@fontsource/ibm-plex-sans-arabic`), embedded as base64
 * `@font-face` rules so Chromium never falls back to a system font. Its
 * Arabic, Latin and Latin-extended subsets (the last one holds ₪) are
 * declared under one family with their `unicode-range`, so the browser picks
 * the right file for each character. Read once per process.
 */
export const REPORT_FONT_FAMILY = "FieldMaster Report";

const PACKAGE = "@fontsource/ibm-plex-sans-arabic";
const SUBSETS = ["arabic", "latin", "latin-ext"] as const;
const WEIGHTS = [400, 700] as const;

let cachedCss: string | null = null;

export function reportFontFaces(): string {
  if (cachedCss !== null) return cachedCss;
  const ranges = JSON.parse(readFileSync(require.resolve(`${PACKAGE}/unicode.json`), "utf8")) as Record<string, string>;
  cachedCss = SUBSETS.flatMap((subset) => {
    const unicodeRange = ranges[subset];
    if (!unicodeRange) throw new Error(`${PACKAGE} has no unicode range for the "${subset}" subset.`);
    return WEIGHTS.map((weight) => {
      const file = require.resolve(`${PACKAGE}/files/ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`);
      const data = readFileSync(file).toString("base64");
      return `@font-face { font-family: "${REPORT_FONT_FAMILY}"; font-style: normal; font-weight: ${weight}; font-display: block; src: url(data:font/woff2;base64,${data}) format("woff2"); unicode-range: ${unicodeRange}; }`;
    });
  }).join("\n");
  return cachedCss;
}
