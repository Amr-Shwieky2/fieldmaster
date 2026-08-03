/** Client-side JWT payload decode for UI branching only -- never trusted for authorization, which the API always re-checks server-side. */
export function decodeJwtPayload<T>(token: string): T | null {
  try {
    const [, payload] = token.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
