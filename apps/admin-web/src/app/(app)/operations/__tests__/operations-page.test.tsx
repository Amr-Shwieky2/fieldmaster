import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import type { OperationsPerson, OperationsShiftRef, OperationsSnapshot } from "@fieldmaster/api-client";
import type { MapCircle, MapPoint } from "@/components/geofence-map-picker";
import { EVIDENCE_COLORS } from "@/components/attendance/evidence-map";
import { sessionStore } from "@/lib/session-store";
import { renderWithIntl } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits } from "@/test/attendance-fixtures";
import OperationsPage from "../page";

// Every time on the page is Asia/Jerusalem whatever the browser's zone. Run in another zone so that a
// local-time format could not pass by accident on a machine that is itself set to Jerusalem.
const machineTimeZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (machineTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = machineTimeZone;
});

// ── Mocks ───────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/operations",
  useSearchParams: () => new URLSearchParams(),
}));

// Leaflet stays out of jsdom: the map is a stub that keeps the circles and points it was given. The text
// legend under it is rendered by EvidenceMap outside the dynamic import, so it is real.
type MapStubProps = { ariaLabel?: string; help?: string; circles?: MapCircle[]; points?: MapPoint[] };
const map = vi.hoisted(() => ({ props: null as MapStubProps | null }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function OperationsMapStub(props: MapStubProps) {
      map.props = props;
      return <div data-testid="operations-map" aria-label={props.ariaLabel} />;
    },
}));

const client = vi.hoisted(() => ({
  getOperationsLive: vi.fn(),
  notificationsStreamUrl: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "FIELD_MANAGER" as "OWNER" | "FIELD_MANAGER" }));
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ client, session: { role: auth.role } }) }));

const STREAM_URL = "https://api.test/api/v1/notifications/stream";

/**
 * A stand-in for the browser's EventSource (jsdom has none): the test opens it, sends it named events and
 * makes it fail, each inside act() like a real network event that updates the page.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((existing) => existing !== listener),
    );
  }

  close() {
    this.closed = true;
  }

  open() {
    act(() => this.onopen?.(new Event("open")));
  }

  emit(type: string) {
    act(() => {
      for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: "{}" }));
    });
  }

  fail() {
    act(() => this.onerror?.(new Event("error")));
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────
// Now is 07:15Z = 10:15 in Asia/Jerusalem (IDT, UTC+3).
const KHALED: OperationsPerson = { id: "wp-1", fullLegalName: "خالد ناصر" };
const SAMER: OperationsPerson = { id: "wp-2", fullLegalName: "سامر حداد" };
const MARWAN: OperationsPerson = { id: "wp-3", fullLegalName: "مروان خليل" };
const LAYLA: OperationsPerson = { id: "wp-4", fullLegalName: "ليلى سعيد" };
const YOUSEF: OperationsPerson = { id: "wp-5", fullLegalName: "يوسف عودة" };
const NADER: OperationsPerson = { id: "wp-6", fullLegalName: "نادر سليمان" };

const TRAFFIC: OperationsShiftRef = { id: "s-1", title: "تنظيم حركة المرور صباحًا", shiftType: "STANDARD" };
const SIGNALS: OperationsShiftRef = { id: "s-2", title: "صيانة الإشارات", shiftType: "STANDARD" };
// The API creates call-out shifts with this fixed English placeholder title.
const SAMER_CALLOUT: OperationsShiftRef = { id: "s-3", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" };
const LAYLA_CALLOUT: OperationsShiftRef = { id: "s-4", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" };
const WAREHOUSE: OperationsShiftRef = { id: "s-5", title: "حراسة المستودع", shiftType: "NIGHT_TURAN" };

const SNAPSHOT: OperationsSnapshot = {
  generatedAt: "2026-10-12T07:15:00.000Z",
  workersOnShift: [
    {
      timeEntryId: "te-1",
      worker: KHALED,
      shift: TRAFFIC,
      clockInAt: "2026-10-12T04:02:00.000Z",
      openMinutes: 193,
      isEmergency: false,
      position: {
        latitude: 32.0858,
        longitude: 34.7818,
        accuracyMeters: 10,
        at: "2026-10-12T04:02:00.000Z",
        eventType: "CLOCK_IN",
        locationValidationStatus: "PASSED",
      },
    },
    // An emergency call-out (compensated start 60 minutes before the click) with a recorded position.
    {
      timeEntryId: "te-2",
      worker: SAMER,
      shift: SAMER_CALLOUT,
      clockInAt: "2026-10-12T03:30:00.000Z",
      openMinutes: 225,
      isEmergency: true,
      position: {
        latitude: 32.0849,
        longitude: 34.7805,
        accuracyMeters: 8,
        at: "2026-10-12T04:30:00.000Z",
        eventType: "CLOCK_IN",
        locationValidationStatus: "PASSED",
      },
    },
    // Open since midnight, with a clock-in that needs review.
    {
      timeEntryId: "te-3",
      worker: MARWAN,
      shift: SIGNALS,
      clockInAt: "2026-10-11T21:00:00.000Z",
      openMinutes: 615,
      isEmergency: false,
      position: {
        latitude: 32.0712,
        longitude: 34.7925,
        accuracyMeters: 35,
        at: "2026-10-11T21:00:00.000Z",
        eventType: "CLOCK_IN",
        locationValidationStatus: "FLAGGED",
      },
    },
    // An emergency call-out without any clock event yet.
    { timeEntryId: "te-4", worker: LAYLA, shift: LAYLA_CALLOUT, clockInAt: "2026-10-12T05:50:00.000Z", openMinutes: 85, isEmergency: true, position: null },
  ],
  sites: [{ siteId: "site-1", name: "تقاطع الشمال", centerLatitude: 32.0853, centerLongitude: 34.7818, radiusMeters: 150 }],
  temporaryPoints: [
    { id: "tp-1", name: "البوابة الشرقية", latitude: 32.0861, longitude: 34.7835, radiusMeters: 100, expiresAt: "2026-10-12T13:00:00.000Z", shift: TRAFFIC },
  ],
  activeEmergencies: [
    {
      calloutId: "co-1",
      timeEntryId: "te-2",
      worker: SAMER,
      authorizationSource: "NIGHT_TURAN_ASSIGNMENT",
      actualStartClick: "2026-10-12T04:30:00.000Z",
      compensatedStart: "2026-10-12T03:30:00.000Z",
      start: { latitude: 32.0849, longitude: 34.7805 },
    },
    {
      calloutId: "co-2",
      timeEntryId: "te-4",
      worker: LAYLA,
      authorizationSource: "MANUAL_MANAGER_AUTHORIZATION",
      actualStartClick: "2026-10-12T06:50:00.000Z",
      compensatedStart: "2026-10-12T05:50:00.000Z",
      start: { latitude: 32.0901, longitude: 34.7952 },
    },
  ],
  activeShifts: [
    {
      ...TRAFFIC,
      scheduledStart: "2026-10-12T04:00:00.000Z",
      scheduledEnd: "2026-10-12T13:00:00.000Z",
      siteName: "تقاطع الشمال",
      expectedCount: 2,
      clockedInCount: 1,
      lateCount: 1,
    },
    // Past its scheduled end, still on because someone is clocked in; no site.
    {
      ...SIGNALS,
      scheduledStart: "2026-10-11T21:00:00.000Z",
      scheduledEnd: "2026-10-12T06:00:00.000Z",
      siteName: null,
      expectedCount: 1,
      clockedInCount: 1,
      lateCount: 0,
    },
  ],
  // A 15-minute grace, not the default 10: "{grace} دقيقة" has no plural form, and 3 to 10 minutes need «دقائق».
  lateWorkers: [{ worker: YOUSEF, shift: TRAFFIC, scheduledStart: "2026-10-12T04:00:00.000Z", graceMinutes: 15, lateMinutes: 195 }],
  longOpenEntries: [{ timeEntryId: "te-3", worker: MARWAN, shift: SIGNALS, clockInAt: "2026-10-11T21:00:00.000Z", openMinutes: 615, isEmergency: false }],
  recentRejectedAttempts: [
    {
      id: "ra-1",
      eventType: "CLOCK_IN",
      code: "GEOFENCE_OUTSIDE_ALLOWED_RADIUS",
      at: "2026-10-12T03:55:00.000Z",
      latitude: 32.0875,
      longitude: 34.7818,
      accuracyMeters: 12,
      distanceMeters: 228.6,
      allowedRadiusMeters: 150,
      requiredAccuracyMeters: null,
      timeEntryId: "te-1",
      worker: KHALED,
      shift: TRAFFIC,
    },
    {
      id: "ra-2",
      eventType: "CLOCK_OUT",
      code: "GPS_ACCURACY_TOO_LOW",
      at: "2026-10-12T06:05:00.000Z",
      latitude: 32.0712,
      longitude: 34.7925,
      accuracyMeters: 87.4,
      distanceMeters: null,
      allowedRadiusMeters: null,
      requiredAccuracyMeters: 50,
      timeEntryId: "te-3",
      worker: MARWAN,
      shift: SIGNALS,
    },
    {
      id: "ra-3",
      eventType: "CLOCK_IN",
      code: "DEVICE_TIME_DEVIATION_EXCEEDED",
      at: "2026-10-12T07:10:00.000Z",
      latitude: 32.0853,
      longitude: 34.7818,
      accuracyMeters: 9,
      distanceMeters: null,
      allowedRadiusMeters: null,
      requiredAccuracyMeters: null,
      timeEntryId: null,
      worker: YOUSEF,
      shift: TRAFFIC,
    },
  ],
  suspiciousLocations: [
    {
      clockEventId: "ce-3",
      eventType: "CLOCK_IN",
      origin: "ONLINE",
      at: "2026-10-11T21:00:00.000Z",
      latitude: 32.0712,
      longitude: 34.7925,
      mockLocationSuspected: false,
      locationValidationStatus: "FLAGGED",
      timeEntryId: "te-3",
      worker: MARWAN,
      shift: SIGNALS,
    },
    {
      clockEventId: "ce-8",
      eventType: "CLOCK_OUT",
      origin: "OFFLINE",
      at: "2026-10-12T02:40:00.000Z",
      latitude: 32.1102,
      longitude: 34.8401,
      mockLocationSuspected: true,
      locationValidationStatus: "FLAGGED",
      timeEntryId: "te-8",
      worker: NADER,
      shift: WAREHOUSE,
    },
  ],
  offlineReview: [
    {
      id: "os-1",
      eventType: "CLOCK_OUT",
      status: "FLAGGED",
      deviceTimestamp: "2026-10-12T02:40:00.000Z",
      processedAt: "2026-10-12T03:20:00.000Z",
      rejectionReason: null,
      timeEntryId: "te-8",
      worker: NADER,
    },
    {
      id: "os-2",
      eventType: "CLOCK_IN",
      status: "REJECTED",
      deviceTimestamp: "2026-10-11T03:58:00.000Z",
      processedAt: "2026-10-11T09:00:00.000Z",
      rejectionReason: "INVALID_OFFLINE_SIGNATURE",
      timeEntryId: null,
      worker: KHALED,
    },
  ],
};

/** Nothing going on: every list empty, nothing to place on the map. */
const QUIET: OperationsSnapshot = {
  generatedAt: "2026-10-12T07:15:00.000Z",
  workersOnShift: [],
  sites: [],
  temporaryPoints: [],
  activeEmergencies: [],
  activeShifts: [],
  lateWorkers: [],
  longOpenEntries: [],
  recentRejectedAttempts: [],
  suspiciousLocations: [],
  offlineReview: [],
};

/** A minute later: Yousef clocked in, so nobody is late any more. */
const AFTER_YOUSEF_CLOCKED_IN: OperationsSnapshot = {
  ...SNAPSHOT,
  generatedAt: "2026-10-12T07:16:00.000Z",
  workersOnShift: [
    ...SNAPSHOT.workersOnShift,
    {
      timeEntryId: "te-9",
      worker: YOUSEF,
      shift: TRAFFIC,
      clockInAt: "2026-10-12T07:16:00.000Z",
      openMinutes: 0,
      isEmergency: false,
      position: {
        latitude: 32.0853,
        longitude: 34.7818,
        accuracyMeters: 9,
        at: "2026-10-12T07:16:00.000Z",
        eventType: "CLOCK_IN",
        locationValidationStatus: "PASSED",
      },
    },
  ],
  lateWorkers: [],
};

// ── Helpers ─────────────────────────────────────────────────────────────
const TITLE = "العمليات المباشرة";
const WORKERS_ON_SHIFT = "العمال في الدوام";
const NOT_CONNECTED = ["غير متصل", "تتحدث الصفحة كل دقيقة إلى أن يعود الاتصال."];

function renderPage() {
  return renderWithIntl(<OperationsPage />, { queryClient: true });
}

/** Renders the page and waits for the snapshot's lists. */
async function renderSnapshot() {
  const result = renderPage();
  await screen.findByRole("heading", { level: 2, name: WORKERS_ON_SHIFT });
  return result;
}

/** Stores a signed-in session: the stream reads its access token from there. */
function signIn(accessToken = "test-access-token") {
  sessionStore.save({ accessToken, refreshToken: "test-refresh-token", organizationId: "org-1", role: auth.role, workerProfileId: null });
}

/** Gives the page a browser EventSource (jsdom has none). */
function stubEventSource() {
  vi.stubGlobal("EventSource", FakeEventSource);
}

/** What sits next to the page title: the connection indicator and the update time. */
function headerActions(): HTMLElement {
  const actions = screen.getByRole("heading", { level: 1, name: TITLE }).parentElement?.nextElementSibling;
  if (!(actions instanceof HTMLElement)) throw new Error("no header actions");
  return actions;
}

/** The connection indicator's badge and hint. */
function connection(): (string | null)[] {
  const indicator = within(headerActions()).getByRole("status");
  return Array.from(indicator.children, (part) => part.textContent);
}

/** "آخر تحديث: …" next to the title, or null before the first snapshot. */
function updatedAt(): string | null {
  // The matcher sees the element's own (trimmed) text, "آخر تحديث:", without the time in its <bdi>.
  return within(headerActions()).queryByText(/^آخر تحديث:/)?.textContent ?? null;
}

/** A card by its title (CardTitle -> CardHeader -> Card). */
function card(title: string): HTMLElement {
  const element = screen.getByRole("heading", { level: 2, name: title }).parentElement?.parentElement;
  if (!element) throw new Error(`no card titled ${title}`);
  return element;
}

/** The count badge next to a list card's title. */
function countOf(title: string): string | null | undefined {
  return screen.getByRole("heading", { level: 2, name: title }).nextElementSibling?.textContent;
}

function rows(title: string): HTMLElement[] {
  return within(card(title)).getAllByRole("listitem");
}

/** The text of each line (paragraph) of a list row. */
function lines(row: HTMLElement): (string | null)[] {
  return Array.from(row.querySelectorAll("p"), (line) => line.textContent);
}

/** A row's link: its text and where it goes. */
function linkOf(row: HTMLElement): (string | null)[] | null {
  const link = within(row).queryByRole("link");
  return link ? [link.textContent, link.getAttribute("href")] : null;
}

/** A worker row's name (the first line without its badge) and its badge. */
function nameAndBadge(row: HTMLElement): (string | null)[] {
  const name = row.querySelector("p");
  return [name?.firstChild?.textContent ?? null, name?.querySelector("span")?.textContent ?? null];
}

/** The "late" badge of an active shift row. */
function lateBadge(row: HTMLElement): string | null {
  return row.querySelector(":scope > span")?.textContent ?? null;
}

function legend(): (string | null)[] {
  return within(screen.getByRole("list", { name: "ما يظهر على الخريطة" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

/** Distinct Latin-script words on the page (API codes or English placeholders would show up here). */
function latinWords(): string[] {
  return [...new Set(document.body.textContent?.match(/[A-Za-z]+/g) ?? [])].sort();
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.role = "FIELD_MANAGER";
  map.props = null;
  FakeEventSource.instances = [];
  sessionStore.clear();
  client.getOperationsLive.mockResolvedValue(SNAPSHOT);
  client.notificationsStreamUrl.mockImplementation((token: string) => `${STREAM_URL}?token=${token}`);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Live operations page", () => {
  it("shows the loading state while the snapshot loads, without an update time", () => {
    client.getOperationsLive.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: TITLE })).toBeTruthy();
    expect(screen.getByText("ما يحدث الآن: من في الدوام وأين سجّل آخر مرة، ومن تأخر، وما يحتاج إلى متابعة. تتحدث الصفحة تلقائيًا.")).toBeTruthy();
    expect(screen.getByText("جارٍ التحميل…").closest('[role="status"]')).toBeTruthy();
    expect(updatedAt()).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(client.getOperationsLive).toHaveBeenCalledTimes(1);
  });

  it("shows when the snapshot was taken, every card, the no-money note, Arabic text only and Western digits only", async () => {
    await renderSnapshot();

    expect(screen.queryByText("جارٍ التحميل…")).toBeNull();
    expect(updatedAt()).toBe("آخر تحديث: 10:15");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "الخريطة",
      "العمال في الدوام",
      "استدعاءات طوارئ جارية",
      "الورديات الجارية",
      "عمال متأخرون",
      "دوام مفتوح أكثر من 9 ساعات",
      "محاولات مرفوضة (آخر 24 ساعة)",
      "مواقع مشبوهة (آخر 24 ساعة)",
      "تسجيلات دون اتصال بانتظار المراجعة",
    ]);
    expect(screen.getByText("صفحة تشغيلية: لا تظهر فيها أي مبالغ مالية.")).toBeTruthy();
    // "GPS" is part of the Arabic copy; no API code, enum value or English placeholder title reaches the page.
    expect(latinWords()).toEqual(["GPS"]);
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("lists the workers on shift with since when, their last recorded position, and a link to the entry", async () => {
    await renderSnapshot();

    expect(countOf(WORKERS_ON_SHIFT)).toBe("4");
    expect(rows(WORKERS_ON_SHIFT).map((row) => [nameAndBadge(row), lines(row).slice(1), linkOf(row)])).toEqual([
      [
        ["خالد ناصر", null],
        ["تنظيم حركة المرور صباحًا", "منذ 12 أكتوبر 2026 في 07:02 (3 س 13 د)", "آخر موقع: بدء الدوام الساعة 07:02، نتيجة فحص الموقع: سليم"],
        ["عرض الحضور", "/attendance/te-1"],
      ],
      // A call-out: the emergency badge, and the shift by its Arabic type, never the API's placeholder title.
      [
        ["سامر حداد", "استدعاء طوارئ"],
        ["استدعاء طوارئ", "منذ 12 أكتوبر 2026 في 06:30 (3 س 45 د)", "آخر موقع: بدء الدوام الساعة 07:30، نتيجة فحص الموقع: سليم"],
        ["عرض الحضور", "/attendance/te-2"],
      ],
      [
        ["مروان خليل", null],
        ["صيانة الإشارات", "منذ 12 أكتوبر 2026 في 00:00 (10 س 15 د)", "آخر موقع: بدء الدوام الساعة 00:00، نتيجة فحص الموقع: مُعلَّم للمراجعة"],
        ["عرض الحضور", "/attendance/te-3"],
      ],
      [
        ["ليلى سعيد", "استدعاء طوارئ"],
        ["استدعاء طوارئ", "منذ 12 أكتوبر 2026 في 08:50 (1 س 25 د)", "لا يوجد موقع مسجّل."],
        ["عرض الحضور", "/attendance/te-4"],
      ],
    ]);
  });

  it("lists the active emergencies with their authorization, start and a link to the call-out", async () => {
    await renderSnapshot();

    const title = "استدعاءات طوارئ جارية";
    expect(countOf(title)).toBe("2");
    expect(rows(title).map((row) => [lines(row), linkOf(row)])).toEqual([
      [
        ["سامر حداد", "تكليف بمناوبة ليلية", "بدأ 12 أكتوبر 2026 في 07:30"],
        ["عرض الاستدعاء", "/emergencies/co-1"],
      ],
      [
        ["ليلى سعيد", "إذن من المدير", "بدأ 12 أكتوبر 2026 في 09:50"],
        ["عرض الاستدعاء", "/emergencies/co-2"],
      ],
    ]);
  });

  it("lists the active shifts with their window, how many are clocked in and how many are late", async () => {
    await renderSnapshot();

    const title = "الورديات الجارية";
    expect(countOf(title)).toBe("2");
    expect(rows(title).map((row) => [linkOf(row), lines(row), lateBadge(row)])).toEqual([
      [["تنظيم حركة المرور صباحًا", "/shifts/s-1"], ["تقاطع الشمال", "من 07:00 إلى 16:00", "في الدوام 1 من 2"], "متأخر واحد"],
      // No site line, and no late badge when nobody is late.
      [["صيانة الإشارات", "/shifts/s-2"], ["من 00:00 إلى 09:00", "في الدوام 1 من 1"], null],
    ]);
  });

  it("counts the late workers of a shift with the Arabic plural", async () => {
    const lateCounts = [1, 2, 3, 10, 11, 99, 100, 102];
    client.getOperationsLive.mockResolvedValue({
      ...SNAPSHOT,
      activeShifts: lateCounts.map((lateCount, index) => ({ ...SNAPSHOT.activeShifts[0], id: `s-late-${index}`, expectedCount: 120, lateCount })),
    });
    await renderSnapshot();

    expect(rows("الورديات الجارية").map(lateBadge)).toEqual([
      "متأخر واحد",
      "متأخران",
      "3 متأخرين",
      "10 متأخرين",
      "11 متأخرًا",
      "99 متأخرًا",
      "100 متأخر",
      "102 متأخر",
    ]);
  });

  it("lists the late workers with the shift start, the grace period and how late they are", async () => {
    await renderSnapshot();

    expect(countOf("عمال متأخرون")).toBe("1");
    expect(rows("عمال متأخرون").map((row) => [lines(row), linkOf(row)])).toEqual([
      [["يوسف عودة", "تنظيم حركة المرور صباحًا", "بدأت الوردية الساعة 07:00، ومهلة التأخير 15 دقيقة؛ التأخير حتى الآن 3 س 15 د."], null],
    ]);
  });

  it("lists the entries open for more than 9 hours with how long they have been open", async () => {
    await renderSnapshot();

    const title = "دوام مفتوح أكثر من 9 ساعات";
    expect(countOf(title)).toBe("1");
    expect(rows(title).map((row) => [lines(row), linkOf(row)])).toEqual([
      [
        ["مروان خليل", "صيانة الإشارات", "مفتوح منذ 10 س 15 د"],
        ["عرض الحضور", "/attendance/te-3"],
      ],
    ]);
  });

  it("lists the rejected attempts with the Arabic reason, the rounded distance or accuracy, the shift and the time", async () => {
    await renderSnapshot();

    const title = "محاولات مرفوضة (آخر 24 ساعة)";
    expect(countOf(title)).toBe("3");
    expect(rows(title).map((row) => [lines(row), linkOf(row)])).toEqual([
      [
        ["خالد ناصر", "بدء الدوام: خارج نطاق الموقع", "المسافة 229 م (المسموح 150 م)", "وردية تنظيم حركة المرور صباحًا، الساعة 06:55"],
        ["عرض الحضور", "/attendance/te-1"],
      ],
      [
        ["مروان خليل", "إنهاء الدوام: دقة GPS ضعيفة", "دقة GPS 87 م (المطلوب 50 م)", "وردية صيانة الإشارات، الساعة 09:05"],
        ["عرض الحضور", "/attendance/te-3"],
      ],
      // No time entry to open: no link.
      [["يوسف عودة", "بدء الدوام: ساعة الجهاز غير مضبوطة", "وردية تنظيم حركة المرور صباحًا، الساعة 10:10"], null],
    ]);
  });

  it("names a rejection code it does not know with the generic Arabic reason, never the code", async () => {
    client.getOperationsLive.mockResolvedValue({ ...SNAPSHOT, recentRejectedAttempts: [{ ...SNAPSHOT.recentRejectedAttempts[2], code: "SOME_FUTURE_CODE" }] });
    await renderSnapshot();

    expect(lines(rows("محاولات مرفوضة (آخر 24 ساعة)")[0])[1]).toBe("بدء الدوام: رُفضت المحاولة");
    expect(document.body.textContent).not.toContain("SOME_FUTURE_CODE");
  });

  it("lists the suspicious locations, a mock location by name, with how and when they were sent", async () => {
    await renderSnapshot();

    const title = "مواقع مشبوهة (آخر 24 ساعة)";
    expect(countOf(title)).toBe("2");
    expect(rows(title).map((row) => [lines(row), linkOf(row)])).toEqual([
      [
        ["مروان خليل", "بدء الدوام: مُعلَّم للمراجعة", "عبر الإنترنت، الساعة 00:00"],
        ["عرض الحضور", "/attendance/te-3"],
      ],
      [
        ["نادر سليمان", "إنهاء الدوام: موقع وهمي", "دون اتصال، الساعة 05:40"],
        ["عرض الحضور", "/attendance/te-8"],
      ],
    ]);
  });

  it("lists the offline stamps awaiting review with their status, the Arabic rejection reason and both times", async () => {
    await renderSnapshot();

    const title = "تسجيلات دون اتصال بانتظار المراجعة";
    expect(countOf(title)).toBe("2");
    expect(rows(title).map((row) => [lines(row), linkOf(row)])).toEqual([
      [
        ["نادر سليمان", "إنهاء الدوام: مُعلَّم للمراجعة", "سُجِّل 12 أكتوبر 2026 في 05:40، وزُومِن 12 أكتوبر 2026 في 06:20"],
        ["عرض الحضور", "/attendance/te-8"],
      ],
      [
        ["خالد ناصر", "بدء الدوام: مرفوض", "تعذّر التحقق من التسجيل الذي تمّ دون اتصال.", "سُجِّل 11 أكتوبر 2026 في 06:58، وزُومِن 11 أكتوبر 2026 في 12:00"],
        null,
      ],
    ]);
  });

  it("puts the geofences, temporary points, last positions and call-out starts on the map and lists them under it", async () => {
    await renderSnapshot();

    expect(screen.getByTestId("operations-map").getAttribute("aria-label")).toBe("خريطة العمليات المباشرة");
    expect(legend()).toEqual([
      "نطاق الموقع: تقاطع الشمال، نصف القطر 150 م",
      "نقطة تسجيل مؤقتة «البوابة الشرقية» لوردية «تنظيم حركة المرور صباحًا»",
      "خالد ناصر، وردية «تنظيم حركة المرور صباحًا»، آخر تسجيل الساعة 07:02",
      "استدعاء طوارئ جارٍ: سامر حداد، وردية «استدعاء طوارئ»، آخر تسجيل الساعة 07:30",
      "مروان خليل، وردية «صيانة الإشارات»، آخر تسجيل الساعة 00:00",
      // Layla's call-out has no clock event yet: it is placed where it started. Samer's is not placed twice.
      "استدعاء طوارئ جارٍ: ليلى سعيد، بدأ الساعة 09:50",
    ]);

    // The colors the map's help text explains: blue geofence, green temporary point, pink emergency, orange to review.
    expect(map.props?.circles?.map(({ color, radiusMeters }) => [color, radiusMeters])).toEqual([
      [EVIDENCE_COLORS.geofence, 150],
      [EVIDENCE_COLORS.temporaryPoint, 100],
    ]);
    expect(map.props?.points?.map(({ color, latitude, longitude, accuracyMeters }) => [color, latitude, longitude, accuracyMeters])).toEqual([
      [EVIDENCE_COLORS.clockIn, 32.0858, 34.7818, 10],
      [EVIDENCE_COLORS.emergency, 32.0849, 34.7805, 8],
      [EVIDENCE_COLORS.flagged, 32.0712, 34.7925, 35],
      [EVIDENCE_COLORS.emergency, 32.0901, 34.7952, null],
    ]);
    expect(map.props?.help).toBe(
      "تعرض الخريطة آخر موقع سُجِّل لكل عامل في الدوام عند بدء الدوام أو إنهائه فقط، دون تتبّع مستمر. الدائرة الزرقاء نطاق الموقع، والخضراء نقطة تسجيل مؤقتة، والوردية استدعاء طوارئ جارٍ، والبرتقالية موقع يحتاج إلى مراجعة.",
    );
  });

  it("shows each list's empty text with a zero count, and no map when there is nothing to place", async () => {
    client.getOperationsLive.mockResolvedValue(QUIET);
    await renderSnapshot();

    for (const [title, empty] of [
      ["العمال في الدوام", "لا يوجد عمال في الدوام الآن."],
      ["استدعاءات طوارئ جارية", "لا توجد استدعاءات طوارئ جارية."],
      ["الورديات الجارية", "لا توجد ورديات جارية الآن."],
      ["عمال متأخرون", "لا يوجد عمال متأخرون."],
      ["دوام مفتوح أكثر من 9 ساعات", "لا يوجد دوام مفتوح أكثر من 9 ساعات."],
      ["محاولات مرفوضة (آخر 24 ساعة)", "لا توجد محاولات مرفوضة في آخر 24 ساعة."],
      ["مواقع مشبوهة (آخر 24 ساعة)", "لا توجد مواقع مشبوهة في آخر 24 ساعة."],
      ["تسجيلات دون اتصال بانتظار المراجعة", "لا توجد تسجيلات دون اتصال بانتظار المراجعة."],
    ]) {
      expect(countOf(title)).toBe("0");
      expect(within(card(title)).getByText(empty)).toBeTruthy();
      expect(within(card(title)).queryAllByRole("listitem")).toHaveLength(0);
    }
    expect(within(card("الخريطة")).getByText("لا توجد مواقع لعرضها على الخريطة.")).toBeTruthy();
    expect(screen.queryByTestId("operations-map")).toBeNull();
    expect(screen.queryByRole("list", { name: "ما يظهر على الخريطة" })).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    client.getOperationsLive.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Internal server error"));
    renderPage();

    expect(await screen.findByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("حدث خطأ ما");
    expect(screen.queryByText("Internal server error")).toBeNull();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 2, name: WORKERS_ON_SHIFT })).toBeTruthy();
    expect(client.getOperationsLive).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows access denied when the API answers 403", async () => {
    client.getOperationsLive.mockRejectedValue(apiError(403, "FORBIDDEN", "Forbidden resource"));
    renderPage();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText("Forbidden resource")).toBeNull();
    expect(screen.queryByRole("button", { name: "إعادة المحاولة" })).toBeNull();
  });

  it("shows an Owner exactly the page a Field Manager sees, with no money for either", async () => {
    // Even a response that carried an amount would show no money: the page has no place for it, for anyone.
    client.getOperationsLive.mockResolvedValue({
      ...SNAPSHOT,
      activeEmergencies: SNAPSHOT.activeEmergencies.map((callout) => ({ ...callout, estimatedCostAgorot: 11_111 })),
    });

    auth.role = "FIELD_MANAGER";
    const manager = await renderSnapshot();
    expect(document.body.textContent).not.toContain("₪");
    const managerPage = manager.container.innerHTML;
    manager.unmount();

    auth.role = "OWNER";
    const owner = await renderSnapshot();
    expect(document.body.textContent).not.toContain("₪");
    expect(owner.container.innerHTML).toBe(managerPage);
  });
});

describe("Live operations page: real-time connection", () => {
  it("shows «غير متصل» when the browser has no EventSource, and still shows the snapshot", async () => {
    signIn();
    await renderSnapshot();

    // jsdom has no EventSource, so this is the page as such a browser shows it.
    expect(typeof EventSource).toBe("undefined");
    expect(connection()).toEqual(NOT_CONNECTED);
    expect(client.notificationsStreamUrl).not.toHaveBeenCalled();
    expect(updatedAt()).toBe("آخر تحديث: 10:15");
  });

  it("does not open the stream without a session token, and shows «غير متصل»", async () => {
    stubEventSource();
    await renderSnapshot();

    expect(connection()).toEqual(NOT_CONNECTED);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(client.notificationsStreamUrl).not.toHaveBeenCalled();
  });

  it("shows «جارٍ الاتصال…» until the stream opens, «متصل» once it is open and «غير متصل» when it fails", async () => {
    stubEventSource();
    signIn();
    renderPage();

    expect(connection()).toEqual(["جارٍ الاتصال…", "جارٍ الاتصال بالتحديثات المباشرة."]);
    // The access token travels in the URL (EventSource cannot send headers).
    expect(client.notificationsStreamUrl).toHaveBeenCalledWith("test-access-token");
    expect(FakeEventSource.instances.map((source) => source.url)).toEqual([`${STREAM_URL}?token=test-access-token`]);
    await screen.findByRole("heading", { level: 2, name: WORKERS_ON_SHIFT });

    const [source] = FakeEventSource.instances;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      source.open();
      expect(connection()).toEqual(["متصل", "تصل التحديثات مباشرة."]);
      // A first opening is not a reconnection: nothing was missed, so nothing is refetched, even after the 500 ms wait.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(client.getOperationsLive).toHaveBeenCalledTimes(1);

      source.fail();
      expect(connection()).toEqual(NOT_CONNECTED);
      expect(source.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts 60 s without any event as a lost connection; pings and «operations» events keep it alive", async () => {
    stubEventSource();
    signIn();
    await renderSnapshot();
    const [source] = FakeEventSource.instances;

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      source.open();
      act(() => {
        vi.advanceTimersByTime(59_000);
      });
      source.emit("ping");
      act(() => {
        vi.advanceTimersByTime(59_000);
      });
      source.emit("operations");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_000);
      });
      expect(connection()).toEqual(["متصل", "تصل التحديثات مباشرة."]);
      expect(source.closed).toBe(false);

      // A full minute since the last event: the stream is closed and counted as lost.
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(connection()).toEqual(NOT_CONNECTED);
      expect(source.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refetches the snapshot 500 ms after the last «operations» event, once for a burst of events", async () => {
    stubEventSource();
    signIn();
    client.getOperationsLive.mockResolvedValueOnce(SNAPSHOT).mockResolvedValueOnce(AFTER_YOUSEF_CLOCKED_IN);
    await renderSnapshot();
    const [source] = FakeEventSource.instances;
    source.open();
    expect(rows("عمال متأخرون")).toHaveLength(1);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      source.emit("operations");
      act(() => {
        vi.advanceTimersByTime(300);
      });
      // A second event before the wait is over starts it again.
      source.emit("operations");
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(client.getOperationsLive).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(client.getOperationsLive).toHaveBeenCalledTimes(2);
      // Let the new snapshot reach the page.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(client.getOperationsLive).toHaveBeenCalledTimes(2);
    expect(updatedAt()).toBe("آخر تحديث: 10:16");
    expect(countOf(WORKERS_ON_SHIFT)).toBe("5");
    expect(within(card("عمال متأخرون")).getByText("لا يوجد عمال متأخرون.")).toBeTruthy();
    // Each event is also a sign of life.
    expect(connection()).toEqual(["متصل", "تصل التحديثات مباشرة."]);
  });

  it("reconnects after a failure with the session's current token, and refetches once to catch up on missed events", async () => {
    stubEventSource();
    signIn("first-token");
    await renderSnapshot();
    const [first] = FakeEventSource.instances;
    first.open();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      first.fail();
      expect(connection()).toEqual(NOT_CONNECTED);
      expect(FakeEventSource.instances).toHaveLength(1);

      // Meanwhile the API client refreshed the session's access token.
      signIn("refreshed-token");
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(FakeEventSource.instances.map((source) => source.url)).toEqual([`${STREAM_URL}?token=first-token`, `${STREAM_URL}?token=refreshed-token`]);
      expect(connection()).toEqual(["جارٍ الاتصال…", "جارٍ الاتصال بالتحديثات المباشرة."]);

      FakeEventSource.instances[1].open();
      expect(connection()).toEqual(["متصل", "تصل التحديثات مباشرة."]);
      expect(client.getOperationsLive).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(client.getOperationsLive).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
