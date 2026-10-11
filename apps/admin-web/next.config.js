const createNextIntlPlugin = require("next-intl/plugin");

// next-intl with a single locale (Arabic only, no URL prefixes); see
// src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@fieldmaster/api-client", "@fieldmaster/shared-types"],
  reactStrictMode: true,
};

module.exports = withNextIntl(nextConfig);
