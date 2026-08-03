/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "test",
  testMatch: ["**/*.e2e-spec.ts"],
  setupFiles: ["<rootDir>/env.setup.js"],
  testTimeout: 30_000,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/../src/$1",
  },
};
