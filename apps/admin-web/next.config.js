const createNextIntlPlugin = require("next-intl/plugin");

// Cookie-based next-intl: no /ar or /en URL prefixes. The request config reads
// the `fm_locale` cookie (see src/i18n/request.ts).
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@fieldmaster/api-client", "@fieldmaster/shared-types"],
  reactStrictMode: true,
};

module.exports = withNextIntl(nextConfig);
