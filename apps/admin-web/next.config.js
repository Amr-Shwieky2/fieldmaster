/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@fieldmaster/api-client", "@fieldmaster/shared-types"],
  reactStrictMode: true,
};

module.exports = nextConfig;
