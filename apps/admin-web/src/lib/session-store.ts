import type { OrgRole } from "@fieldmaster/shared-types";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  organizationId: string;
  role: OrgRole;
  workerProfileId: string | null;
}

const STORAGE_KEY = "fieldmaster.session";

/**
 * Tokens are kept in localStorage for this admin tool (not an httpOnly
 * cookie + CSRF-token pair, which the spec calls for). That pattern needs a
 * BFF proxy layer between the browser and the API that doesn't exist in
 * this slice -- see docs/technical-decisions.md. Access tokens are
 * short-lived (15 min); the API's refresh-token rotation and reuse
 * detection are the real security boundary and are fully implemented and
 * tested server-side.
 */
export const sessionStore = {
  load(): StoredSession | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSession;
    } catch {
      return null;
    }
  },
  save(session: StoredSession) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  },
  clear() {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};
