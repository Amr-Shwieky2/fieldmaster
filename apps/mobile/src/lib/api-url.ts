/**
 * Base URL of the FieldMaster REST API, including the /api/v1 prefix.
 *
 * Expo inlines `EXPO_PUBLIC_*` variables into the JavaScript bundle when it
 * is built (Metro): from apps/mobile/.env with `expo start`, and from the
 * build profile's `env` in eas.json with EAS Build. The variable must be
 * written out in full (`process.env.EXPO_PUBLIC_API_URL`) for Expo to
 * replace it. A phone cannot reach "localhost": on the same Wi-Fi use the
 * computer's LAN address, e.g. http://192.168.1.20:3010/api/v1 (see
 * docs/mobile-device-testing.md).
 */
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000/api/v1";
