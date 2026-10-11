import { useCallback, useMemo } from "react";
import { useTranslations } from "use-intl";
import {
  createFormatter,
  getCodeMessage,
  getEnumLabel,
  getErrorMessage,
  isSystemShiftTitle,
  type EnumName,
  type Formatter,
} from "@fieldmaster/i18n";

const FORMATTER = createFormatter();

/** Arabic formatters shared with the admin web: Western digits, Asia/Jerusalem, "1 س 30 د", "₪ 1,234.50". */
export function useFormat(): Formatter {
  return FORMATTER;
}

/** `(enumName, value) => Arabic label` for any shared-types enum value. */
export function useEnumLabel(): (enumName: EnumName, value: string | null | undefined) => string {
  const t = useTranslations("enums");
  return useMemo(() => (enumName, value) => getEnumLabel(t, enumName, value), [t]);
}

/** `(error) => Arabic message` for anything an API call can throw (never the API's English text). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations("errors");
  return useCallback((error: unknown) => getErrorMessage(t, error), [t]);
}

/** `(code, details?) => Arabic message | null` for a bare API error code, e.g. an offline-sync rejection reason. */
export function useCodeMessage(): (code: string, details?: unknown) => string | null {
  const t = useTranslations("errors");
  return useCallback((code: string, details?: unknown) => getCodeMessage(t, code, details), [t]);
}

/** The title to show for a shift: the Arabic shift type instead of the API's English placeholder title. */
export function useShiftTitle(): (shift: { title: string; shiftType?: string | null } | null | undefined) => string {
  const enumLabel = useEnumLabel();
  const t = useTranslations("common");
  return useCallback(
    (shift) => {
      if (!shift) return t("shift");
      return isSystemShiftTitle(shift) ? enumLabel("ShiftType", shift.shiftType ?? "EMERGENCY_CALLOUT") : shift.title;
    },
    [enumLabel, t],
  );
}
