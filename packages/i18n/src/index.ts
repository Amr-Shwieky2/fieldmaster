/**
 * Arabic UI text and formatting shared by the admin web (next-intl) and the
 * mobile app (use-intl). Both apps are Arabic only. See
 * docs/technical-decisions.md ("Step 3: one shared i18n package").
 */
export { APP_DIRECTION, APP_LOCALE, BUSINESS_TIME_ZONE, INTL_LOCALE } from "./config";
export { sharedMessages, mergeMessages, type SharedMessages } from "./messages";
export {
  ARABIC_MONTHS,
  CURRENCY_SYMBOL,
  EM_DASH,
  createFormatter,
  formatAgorot,
  formatBusinessDate,
  formatDate,
  formatDateTime,
  formatMinutes,
  formatMonth,
  formatNumber,
  formatTime,
  israelOffsetMinutes,
  toBusinessDay,
  toWesternDigits,
  type DateInput,
  type Formatter,
} from "./format";
export {
  DETAIL_PARAMS,
  getCodeMessage,
  getErrorCode,
  getErrorMessage,
  isForbidden,
  isNetworkError,
  isNotFound,
  type ErrorTranslator,
} from "./errors";
export { ENUM_NAMES, MISSING_LABEL, getEnumLabel, type EnumName, type EnumTranslator } from "./enums";
export { SYSTEM_EMERGENCY_CALLOUT_TITLE, isSystemShiftTitle } from "./shift-title";
