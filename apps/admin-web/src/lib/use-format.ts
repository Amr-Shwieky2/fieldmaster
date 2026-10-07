import { createFormatter, type Formatter } from "./format";

const FORMATTER = createFormatter();

/** The app's Arabic formatters (Western digits, Asia/Jerusalem, `₪ 1,234.50`). */
export function useFormat(): Formatter {
  return FORMATTER;
}
