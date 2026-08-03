/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@fieldmaster/shared-types$": "<rootDir>/../shared-types/src/index.ts",
  },
};
