import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { getEnumLabel, type EnumName } from "@fieldmaster/i18n";

export type { EnumName } from "@fieldmaster/i18n";

/**
 * `(enumName, value) => Arabic label` for any `@fieldmaster/shared-types`
 * enum value, from the shared `enums` messages (see `getEnumLabel` in
 * @fieldmaster/i18n). Page code must use this instead of printing raw API
 * enum values. The returned function is stable, so it is safe in dependency
 * arrays.
 *
 *   const label = useEnumLabel();
 *   label("OrgRole", session.role);          // "المالك"
 */
export function useEnumLabel(): (enumName: EnumName, value: string | null | undefined) => string {
  const t = useTranslations("enums");
  return useMemo(() => (enumName, value) => getEnumLabel(t, enumName, value), [t]);
}
