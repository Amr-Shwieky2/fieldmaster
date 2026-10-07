const baseConfig = require("@fieldmaster/eslint-config");
const i18next = require("eslint-plugin-i18next");

module.exports = [
  ...baseConfig,
  {
    ignores: [".next/**"],
  },
  {
    // No hard-coded user-facing text in components: JSX text and the
    // attributes people read (placeholder, title, alt, aria-label, label)
    // must come from ar.json / en.json via next-intl. Strings that are only
    // digits/punctuation or CONSTANT_CASE are allowed, as is the brand name.
    files: ["src/**/*.tsx"],
    ignores: ["src/**/__tests__/**", "src/test/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          // Native text attributes plus the text props of the app's own components (PageHeader, EmptyState, ErrorState, FullPageMessage, ...).
          "jsx-attributes": {
            include: ["placeholder", "title", "alt", "aria-label", "aria-description", "label", "description", "message", "hint", "linkLabel", "zoomInTitle", "zoomOutTitle"],
          },
          words: { exclude: ["[0-9!-/:-@[-`{-~\\s₪—·•…]+", "[A-Z_-]+", "FieldMaster"] },
          // Translator functions (t, tCommon, tc, t.rich ...) and helpers that take keys or enum values.
          callees: {
            exclude: [
              "t",
              "t[A-Z]\\w*",
              "tc",
              "[\\w]+\\.(rich|markup|raw|has)",
              "useTranslations",
              "getTranslations",
              "enumLabel",
              "label",
              "require",
              "addEventListener",
              "removeEventListener",
              "includes",
              "indexOf",
              "startsWith",
              "endsWith",
              "replace",
              "split",
              "join",
              "setItem",
              "getItem",
              "removeItem",
              "invalidateQueries",
              "querySelector",
            ],
          },
        },
      ],
    },
  },
];
