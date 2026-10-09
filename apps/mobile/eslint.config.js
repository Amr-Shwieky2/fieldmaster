const baseConfig = require("@fieldmaster/eslint-config");
const i18next = require("eslint-plugin-i18next");

module.exports = [
  ...baseConfig,
  {
    ignores: [".expo/**", "dist/**", "jest.config.js", "jest.global-setup.js"],
  },
  {
    // No hard-coded user-facing text: JSX text and the props people read or
    // hear (placeholder, accessibilityLabel, label, title, message, ...) must
    // come from ar.json via use-intl. Strings that are only digits/punctuation
    // or CONSTANT_CASE are allowed, as is the brand name.
    files: ["src/**/*.tsx", "App.tsx"],
    ignores: ["src/**/__tests__/**"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            include: ["placeholder", "accessibilityLabel", "accessibilityHint", "aria-label", "label", "busyLabel", "title", "message", "hint"],
          },
          words: { exclude: ["[0-9!-/:-@[-`{-~\\s₪—·•…]+", "[A-Z_-]+", "FieldMaster"] },
          callees: {
            exclude: ["t", "t[A-Z]\\w*", "tc", "[\\w]+\\.(rich|markup|raw|has)", "useTranslations", "enumLabel", "require", "addEventListener", "setItem", "getItem", "removeItem"],
          },
        },
      ],
    },
  },
  {
    // All text goes through AppText / AppTextInput (Arabic font, line height, RTL alignment).
    files: ["src/**/*.tsx", "App.tsx"],
    ignores: ["src/components/AppText.tsx", "src/components/AppTextInput.tsx", "src/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-native",
              importNames: ["Text", "TextInput", "Button"],
              message: "Use AppText / AppTextInput / Button from src/components (Arabic font, RTL alignment, large touch targets).",
            },
          ],
        },
      ],
    },
  },
];
