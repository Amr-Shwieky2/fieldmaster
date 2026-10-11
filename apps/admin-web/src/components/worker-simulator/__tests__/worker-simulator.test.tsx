import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Component, type ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgRole } from "@fieldmaster/shared-types";
import { toBusinessDay } from "@fieldmaster/i18n";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { sessionStore } from "@/lib/session-store";
import { createIntlWrapper } from "@/test/render-with-intl";
import { WorkerSimulator } from "../worker-simulator";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/dev/worker-simulator",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  notFound: navigation.notFound,
}));

// Leaflet is covered by geofence-map-picker.test.tsx; here the map is a stub whose button stands for a click on the map.
vi.mock("next/dynamic", () => ({
  default: () =>
    function MapStub({ onChange }: { onChange: (lat: number, lng: number) => void }) {
      return (
        <button type="button" data-testid="map-click" onClick={() => onChange(32.0858, 34.7818)}>
          map
        </button>
      );
    },
}));

// ── Fake API ────────────────────────────────────────────────────────────
function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256" })}.${encode(payload)}.signature`;
}

const ADMIN_TOKEN = "admin-access-token";
const ADMIN_REFRESH = "admin-family:admin-secret";
const WORKER_TOKEN = fakeJwt({ sub: "u-w1", membershipId: "m-w1", organizationId: "org-1", role: "WORKER", workerProfileId: "wp-1" });
const WORKER_REFRESH = "worker-family:worker-secret";
/** A budget the worker-scoped shift response carries; it must never reach the page. */
const BUDGET_AGOROT = 987654321;

const DEV_USERS = [
  { membershipId: "m-owner", userId: "u-o", fullLegalName: "سلمى منصور", preferredName: null, phoneNumber: "+972500000001", role: "OWNER", organizationId: "org-1", organizationName: "شركة الميدان" },
  { membershipId: "m-fm", userId: "u-fm", fullLegalName: "يوسف الخطيب", preferredName: null, phoneNumber: "+972500000011", role: "FIELD_MANAGER", organizationId: "org-1", organizationName: "شركة الميدان" },
  { membershipId: "m-w1", userId: "u-w1", fullLegalName: "خالد ناصر", preferredName: null, phoneNumber: "+972500010001", role: "WORKER", organizationId: "org-1", organizationName: "شركة الميدان" },
  { membershipId: "m-w2", userId: "u-w2", fullLegalName: "محمود جبارين", preferredName: null, phoneNumber: "+972500010002", role: "WORKER", organizationId: "org-1", organizationName: "شركة الميدان" },
  { membershipId: "m-x", userId: "u-x", fullLegalName: "عامل من مؤسسة أخرى", preferredName: null, phoneNumber: "+972500099999", role: "WORKER", organizationId: "org-2", organizationName: "مؤسسة أخرى" },
];

const now = Date.now();
const SHIFT = {
  id: "shift-1",
  organizationId: "org-1",
  projectId: "p1",
  siteId: "s1",
  geofenceId: "g1",
  shiftType: "STANDARD",
  title: "وردية أيالون",
  scheduledStart: new Date(now - 30 * 60_000).toISOString(),
  scheduledEnd: new Date(now + 8 * 60 * 60_000).toISOString(),
  checkInMethod: "GEOFENCED",
  status: "PUBLISHED",
  managerId: "u-fm",
  businessDate: toBusinessDay(new Date(now)),
  site: { id: "s1", projectId: "p1", name: "تقاطع الشمال", latitude: 32.0853, longitude: 34.7818, defaultGeofenceRadiusMeters: 150 },
  project: { id: "p1", name: "مشروع أيالون", client: null, projectCode: "AYL-01", status: "ACTIVE", budgetAgorot: BUDGET_AGOROT },
};
const SHIFT_DETAIL = {
  ...SHIFT,
  geofence: { id: "g1", siteId: "s1", centerLatitude: 32.0853, centerLongitude: 34.7818, radiusMeters: 150, minAccuracyMeters: 50 },
  temporaryCheckInPoints: [],
};
const CONTEXT = { workerProfileId: "wp-1", turanAssignments: [], emergencyEligibleTuranAssignmentId: null, temporarySupervisorAssignments: [] };
const CLOCK_IN = {
  timeEntry: { id: "te-1", organizationId: "org-1", workerProfileId: "wp-1", shiftId: "shift-1", status: "ACTIVE", businessDate: SHIFT.businessDate, clockInAt: new Date(now).toISOString(), clockOutAt: null, rawDurationMinutes: null, approvedRegularMinutes: null, approvedOvertimeMinutes: null, fullDayCredit: false, devRewoundAt: null },
  clockEvent: {
    id: "ce-1",
    timeEntryId: "te-1",
    eventType: "CLOCK_IN",
    origin: "ONLINE",
    deviceId: "d",
    clientEventId: "e",
    deviceTimestamp: new Date(now).toISOString(),
    serverReceivedAt: new Date(now).toISOString(),
    deviceTimeDeviationSeconds: 0,
    latitude: 32.0853,
    longitude: 34.7818,
    accuracyMeters: 10,
    mockLocationSuspected: false,
    distanceFromSiteMeters: 0,
    locationValidationStatus: "PASSED",
    // Not something the API sends here today: proves the raw view would still never show money.
    estimatedCostAgorot: 45000,
  },
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function apiError(status: number, code: string) {
  return json(status, { statusCode: status, code, message: "English API message", details: {}, correlationId: "c-1" });
}

interface Call {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}
type Handler = (call: Call) => Response;

function defaultRoutes(): Record<string, Handler> {
  return {
    "GET /auth/dev/users": () => json(200, DEV_USERS),
    "POST /auth/dev/login": () => json(201, { accessToken: WORKER_TOKEN, refreshToken: WORKER_REFRESH, expiresIn: 900, organizationId: "org-1", role: "WORKER" }),
    "POST /auth/logout": () => new Response(null, { status: 204 }),
    "GET /shifts": () => json(200, [SHIFT]),
    "GET /shifts/shift-1": () => json(200, SHIFT_DETAIL),
    "GET /time-entries": () => json(200, []),
    "GET /dev/worker-simulator/me": () => json(200, CONTEXT),
    "POST /clock-events/clock-in": () => json(201, CLOCK_IN),
  };
}

let calls: Call[] = [];
function mockApi(overrides: Record<string, Handler> = {}) {
  const routes = { ...defaultRoutes(), ...overrides };
  calls = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = {
      method: init?.method ?? "GET",
      path: new URL(url).pathname.replace(/^.*\/api\/v1/, ""),
      auth: headers.Authorization ?? null,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    return handler ? handler(call) : apiError(500, "INTERNAL_ERROR");
  });
  vi.stubGlobal("fetch", fetchMock);
}

// ── Rendering ───────────────────────────────────────────────────────────
/** Stands in for Next's not-found boundary. */
class NotFoundBoundary extends Component<{ children: ReactNode }, { notFound: boolean }> {
  state = { notFound: false };
  static getDerivedStateFromError(error: Error) {
    if (error.message === "NEXT_NOT_FOUND") return { notFound: true };
    throw error;
  }
  render() {
    return this.state.notFound ? <p>not-found-page</p> : this.props.children;
  }
}

/** Like the signed-in layout: the page only exists while the admin is signed in. */
function Harness() {
  const { isAuthenticated, logout } = useAuth();
  return (
    <>
      <button type="button" onClick={logout}>
        admin-sign-out
      </button>
      {isAuthenticated ? (
        <NotFoundBoundary>
          <WorkerSimulator />
        </NotFoundBoundary>
      ) : null}
    </>
  );
}

function renderSimulator(role: OrgRole) {
  sessionStore.save({ accessToken: ADMIN_TOKEN, refreshToken: ADMIN_REFRESH, organizationId: "org-1", role, workerProfileId: null });
  const adminQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={adminQueryClient}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
  return { adminQueryClient };
}

async function actAsKhaled() {
  fireEvent.click(await screen.findByRole("button", { name: /خالد ناصر/ }));
  await screen.findByText("ليس في دوام الآن");
  await screen.findByText("وردية أيالون");
}

/** "بدء الدوام" is enabled once the selected shift's details (geofence) have loaded. */
async function clockIn() {
  const button = screen.getByRole("button", { name: "بدء الدوام" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByText("تم بدء الدوام");
}

const adminCacheRoots = (client: QueryClient) => client.getQueryCache().getAll().map((q) => q.queryKey[0]);

beforeEach(() => {
  window.localStorage.clear();
  navigation.replace.mockClear();
  navigation.notFound.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Worker simulator: the simulated worker's session is completely separate from the admin's", () => {
  it("never writes the worker's tokens to the admin session store and never puts worker data in the admin's cache", async () => {
    mockApi();
    const { adminQueryClient } = renderSimulator(OrgRole.OWNER);
    const adminSessionBefore = window.localStorage.getItem("fieldmaster.session");

    await actAsKhaled();
    await clockIn();

    // Browser storage holds exactly the admin's own session, unchanged.
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem("fieldmaster.session")).toBe(adminSessionBefore);
    expect(JSON.stringify(window.localStorage.getItem("fieldmaster.session"))).not.toContain(WORKER_TOKEN);

    // The admin's React Query cache only has the admin's own dev-mode probe.
    expect(adminCacheRoots(adminQueryClient)).toEqual(["dev-login-users"]);

    // Worker requests go out with the worker's token; the admin's own request with the admin's.
    const workerPaths = ["/shifts", "/shifts/shift-1", "/time-entries", "/dev/worker-simulator/me", "/clock-events/clock-in"];
    for (const path of workerPaths) {
      const forPath = calls.filter((c) => c.path === path);
      expect(forPath.length).toBeGreaterThan(0);
      expect(forPath.every((c) => c.auth === `Bearer ${WORKER_TOKEN}`)).toBe(true);
    }
    expect(calls.find((c) => c.path === "/auth/dev/users")?.auth).toBe(`Bearer ${ADMIN_TOKEN}`);
    // Obtained exactly like quick login.
    expect(calls.find((c) => c.path === "/auth/dev/login")?.body).toMatchObject({ membershipId: "m-w1", platform: "WEB" });
  });

  it("ending the simulator session revokes only the worker's session and keeps the admin signed in", async () => {
    mockApi();
    renderSimulator(OrgRole.FIELD_MANAGER);
    await actAsKhaled();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء جلسة المحاكي" }));

    await waitFor(() => expect(calls.some((c) => c.path === "/auth/logout")).toBe(true));
    expect(calls.filter((c) => c.path === "/auth/logout").map((c) => c.body)).toEqual([{ refreshToken: WORKER_REFRESH }]);
    expect(sessionStore.load()?.accessToken).toBe(ADMIN_TOKEN);
    expect(navigation.replace).not.toHaveBeenCalledWith("/login");
    expect(screen.queryByText("ليس في دوام الآن")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "محاكي العامل (تجريبي)" })).toBeTruthy();
  });

  it("a 401 on a worker request ends only the simulator session, never the admin's", async () => {
    mockApi({ "GET /shifts": (call) => (call.auth === `Bearer ${WORKER_TOKEN}` ? apiError(401, "UNAUTHENTICATED") : json(200, [])) });
    renderSimulator(OrgRole.OWNER);
    fireEvent.click(await screen.findByRole("button", { name: /خالد ناصر/ }));

    expect(await screen.findByText(/انتهت جلسة العامل في المحاكي/)).toBeTruthy();
    expect(sessionStore.load()?.accessToken).toBe(ADMIN_TOKEN);
    expect(navigation.replace).not.toHaveBeenCalledWith("/login");
    expect(screen.getByRole("heading", { level: 1, name: "محاكي العامل (تجريبي)" })).toBeTruthy();
  });

  it("signing the admin out drops the simulator session too and revokes the worker's session", async () => {
    mockApi();
    const { adminQueryClient } = renderSimulator(OrgRole.OWNER);
    await actAsKhaled();

    fireEvent.click(screen.getByRole("button", { name: "admin-sign-out" }));

    await waitFor(() => expect(calls.filter((c) => c.path === "/auth/logout").map((c) => c.body)).toEqual([{ refreshToken: WORKER_REFRESH }]));
    expect(screen.queryByText("ليس في دوام الآن")).toBeNull();
    expect(window.localStorage.getItem("fieldmaster.session")).toBeNull();
    expect(navigation.replace).toHaveBeenCalledWith("/login");
    expect(adminQueryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("lists only the admin's own organization's workers", async () => {
    mockApi();
    renderSimulator(OrgRole.OWNER);
    const list = await screen.findByRole("list", { name: "اختيار العامل" });
    const names = within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["التصرّف كهذا العامل: خالد ناصر", "التصرّف كهذا العامل: محمود جبارين"]);
  });
});

describe("Worker simulator: visibility", () => {
  it("is a 404 when the API is not in dev login mode", async () => {
    // React reports the error the not-found boundary catches; that is the expected path here.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockApi({ "GET /auth/dev/users": () => apiError(404, "NOT_FOUND") });
    renderSimulator(OrgRole.OWNER);
    expect(await screen.findByText("not-found-page")).toBeTruthy();
    expect(navigation.notFound).toHaveBeenCalled();
    expect(calls.some((c) => c.path === "/auth/dev/login")).toBe(false);
  });

  it("is not available to a Worker", async () => {
    mockApi();
    renderSimulator(OrgRole.WORKER);
    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /خالد ناصر/ })).toBeNull();
    expect(calls.some((c) => c.path === "/auth/dev/login")).toBe(false);
  });
});

describe("Worker simulator: a Field Manager never sees money", () => {
  it("shows no amount, no money field and calls no financial endpoint, even in the raw JSON", async () => {
    mockApi();
    renderSimulator(OrgRole.FIELD_MANAGER);
    await actAsKhaled();
    await clockIn();
    // The raw response is in the DOM (collapsed); the money field was removed from it.
    expect(screen.getByText("حُذفت الحقول المالية من هذا العرض.")).toBeTruthy();

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("₪");
    expect(text).not.toMatch(/agorot/i);
    expect(text).not.toContain(String(BUDGET_AGOROT));
    expect(text).not.toContain("45000");
    expect(calls.some((c) => /payroll|compensation|dashboard|payslip/.test(c.path))).toBe(false);
  });
});
