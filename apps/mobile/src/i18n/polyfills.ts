/**
 * Hermes (iOS and Android) has no Intl.PluralRules, which use-intl needs for
 * ICU plural messages. Imported first in index.ts. The `.js` suffix is
 * required because Metro enforces the package's `exports`.
 *
 * Nothing else is polyfilled on purpose: numbers, dates and money are
 * formatted by @fieldmaster/i18n without Arabic locale data (see format.ts),
 * so Hermes' partial Intl never decides digits or month names.
 */
import "@formatjs/intl-pluralrules/polyfill-force.js";
import "@formatjs/intl-pluralrules/locale-data/ar.js";
