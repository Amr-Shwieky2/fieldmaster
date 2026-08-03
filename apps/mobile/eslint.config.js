const baseConfig = require("@fieldmaster/eslint-config");

module.exports = [
  ...baseConfig,
  {
    ignores: [".expo/**"],
  },
];
