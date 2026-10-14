/**
 * The app's settings live in app.json (`eas init` writes the EAS projectId
 * there). This file adds one build-time switch on top of it.
 *
 * Android release builds (the `preview` APK) refuse plain-HTTP connections.
 * When a build points the app at an `http://` API -- the computer's LAN
 * address while testing on a phone, e.g. http://192.168.1.20:3010/api/v1 --
 * cleartext traffic is allowed for that build. A build with an `https://`
 * API (production) keeps Android's default: no cleartext. The value comes
 * from EXPO_PUBLIC_API_URL (apps/mobile/.env with `expo start`, the build
 * profile's `env` in eas.json with EAS Build).
 */
module.exports = ({ config }) => {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "";
  if (!apiUrl.startsWith("http://")) return config;
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ["expo-build-properties", { android: { usesCleartextTraffic: true } }]],
  };
};
