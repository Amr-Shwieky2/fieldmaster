const expoPreset = require("jest-expo/jest-preset");

// use-intl and its formatjs dependencies ship ES modules only. jest-expo's first
// pattern skips them (under pnpm the path continues with /node_modules/use-intl/),
// so add them to its allow-list and keep the rest of the preset's patterns.
const ESM_PACKAGES = ["use-intl", "icu-minify", "intl-messageformat", "@formatjs", "@schummar"];
const transformIgnorePatterns = expoPreset.transformIgnorePatterns.map((pattern, index) =>
  index === 0 ? pattern.replace("|react-native|", `|react-native|${ESM_PACKAGES.join("|")}|`) : pattern,
);

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  transformIgnorePatterns,
  moduleNameMapper: {
    // pnpm hoists the admin web's react@19.2.8 into the shared store; always use the app's own react.
    "^react$": "<rootDir>/node_modules/react",
    "^react/(.*)$": "<rootDir>/node_modules/react/$1",
  },
  clearMocks: true,
  // Only spies and replaceProperty. Never resetMocks: it wipes the NetInfo mock's return values.
  restoreMocks: true,
  // Business times must come from Asia/Jerusalem formatting, never the machine's time zone.
  globalSetup: "<rootDir>/jest.global-setup.js",
};
