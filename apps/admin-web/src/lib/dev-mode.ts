import { API_URL } from "./api-url";

/**
 * Is the API in dev login (test) mode? Same signal the login page uses: the
 * API answers `GET /auth/dev/users` with 200 only while DEV_LOGIN_ENABLED=true
 * (which it refuses to start with in production) and 404 otherwise. Asked on
 * the server for each request, so a test-only page is a real 404 when the
 * mode is off. Any failure counts as "off".
 */
export async function isDevLoginEnabledOnServer(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`${API_URL}/auth/dev/users`, { cache: "no-store" });
    return response.status === 200;
  } catch {
    return false;
  }
}
