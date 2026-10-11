import { createFormatter, type Formatter } from "@fieldmaster/i18n";

const FORMATTER = createFormatter();

/** The app's Arabic formatters (Western digits, Asia/Jerusalem, `₪ 1,234.50`). */
export function useFormat(): Formatter {
  return FORMATTER;
}
