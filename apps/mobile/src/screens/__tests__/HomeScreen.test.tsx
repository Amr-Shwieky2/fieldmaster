import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type Shift, type TimeEntry } from "@fieldmaster/api-client";
import { IntlRoot } from "../../i18n/IntlRoot";
import ar from "../../i18n/messages";
import type { QueuedEvent } from "../../lib/offline-queue";
import { HomeScreen } from "../HomeScreen";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = { listTimeEntries: jest.fn(), listShifts: jest.fn() };
const mockLogout = jest.fn();
const mockAuth: { client: typeof mockClient; logout: jest.Mock; session: { role: string } | null } = {
  client: mockClient,
  logout: mockLogout,
  session: { role: "WORKER" },
};
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));

const mockSync: { isOnline: boolean; pendingCount: number; queue: QueuedEvent[] } = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

// Outside a navigator, "focus" is the first render; refocus() replays the screen's focus callback
// (the worker comes back from History, ClockIn, ...).
let mockFocusEffect: (() => void) | null = null;
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return {
    ...actual,
    useFocusEffect: (effect: () => void) => {
      mockFocusEffect = effect;
      useEffect(effect, [effect]);
    },
  };
});

const navigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
const route = { key: "Home-1", name: "Home" as const, params: undefined };

// ── Helpers ─────────────────────────────────────────────────────────────────

function ThrowingIntl({ children }: { children: ReactNode }) {
  return (
    <IntlRoot
      onError={(error) => {
        throw error;
      }}
    >
      {children}
    </IntlRoot>
  );
}

function homeElement() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <HomeScreen navigation={navigation as any} route={route} />;
}

async function renderHome() {
  await render(homeElement(), { wrapper: ThrowingIntl });
}

async function refocus() {
  await act(async () => {
    mockFocusEffect?.();
  });
}

const realNow = Date.now.bind(Date);

/** Moves "now" to a given instant (the clock keeps running from there). */
function setNow(instant: string) {
  const offset = new Date(instant).getTime() - realNow();
  jest.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
}

/** Fills an ICU message's {placeholders} (simple arguments only). */
function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

/** User data (shift titles, site names) is shown inside a first-strong isolate so it keeps its own direction. */
const iso = (value: string) => `\u2068${value}\u2069`;

type JsonNode = { type: string; props: Record<string, unknown>; children: (JsonNode | string)[] | null };

/** Every string a person can see or hear: text plus accessibility labels. */
function visibleStrings(): string[] {
  const out: string[] = [];
  const walk = (node: JsonNode | JsonNode[] | string | null) => {
    if (node === null) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const prop of ["accessibilityLabel", "accessibilityHint", "placeholder", "aria-label"]) {
      if (typeof node.props[prop] === "string") out.push(node.props[prop] as string);
    }
    node.children?.forEach(walk);
  };
  walk(screen.toJSON() as unknown as JsonNode | JsonNode[] | null);
  return out;
}

/** No English UI text and no Arabic-Indic digits. Latin data (the brand name, plus `data`) is removed first. */
function expectArabicUiOnly(data: string[] = []) {
  const stripData = (text: string) => [...data, "FieldMaster"].reduce((acc, value) => acc.split(value).join(""), text);
  const text = visibleStrings().join("\n");
  expect(stripData(text)).not.toMatch(/[A-Za-z]{2,}/);
  expect(text).not.toMatch(/[٠-٩۰-۹]/);
  const latinElements = screen.queryAllByText(/[A-Za-z]{2,}/).filter((el) => {
    const content = (el.children as unknown[]).filter((c) => typeof c === "string").join("");
    return stripData(content).match(/[A-Za-z]{2,}/);
  });
  expect(latinElements).toHaveLength(0);
  expect(screen.queryAllByText(/[٠-٩۰-۹]/)).toHaveLength(0);
}

function shift(overrides: Partial<Shift> & Pick<Shift, "id">): Shift {
  return {
    organizationId: "org-1",
    projectId: null,
    siteId: "site-1",
    geofenceId: null,
    shiftType: "STANDARD",
    title: "صيانة إشارات شارع يافا",
    scheduledStart: "2026-01-15T08:30:00.000Z",
    scheduledEnd: "2026-01-15T16:00:00.000Z",
    checkInMethod: "GEOFENCED",
    status: "PUBLISHED",
    managerId: "manager-1",
    businessDate: "2026-01-15",
    site: { id: "site-1", projectId: "project-1", name: "مفترق الساعة", latitude: 32.05, longitude: 34.75, defaultGeofenceRadiusMeters: 150 },
    ...overrides,
  } as Shift;
}

function activeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-1",
    organizationId: "org-1",
    workerProfileId: "worker-1",
    shiftId: "shift-1",
    status: "ACTIVE",
    businessDate: "2026-01-15",
    clockInAt: "2026-01-15T08:30:00.000Z",
    clockOutAt: null,
    rawDurationMinutes: null,
    approvedRegularMinutes: null,
    approvedOvertimeMinutes: null,
    fullDayCredit: false,
    shift: shift({ id: "shift-1" }),
    ...overrides,
  } as TimeEntry;
}

/** A clock event saved on the phone (offline queue). */
function queued(overrides: Partial<QueuedEvent> & Pick<QueuedEvent, "eventType">): QueuedEvent {
  return {
    clientEventId: `evt-${overrides.eventType}`,
    shiftId: null,
    deviceTimestamp: "2026-01-15T08:30:00.000Z",
    latitude: 32.05,
    longitude: 34.75,
    accuracyMeters: 8,
    signature: "signature",
    localStatus: "PENDING",
    queuedAt: "2026-01-15T08:30:01.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function pullToRefresh() {
  const list = screen.getByTestId("home-shifts");
  await act(async () => {
    (list.props.refreshControl as { props: { onRefresh: () => void } }).props.onRefresh();
  });
}

const isRefreshing = () => (screen.getByTestId("home-shifts").props.refreshControl as { props: { refreshing: boolean } }).props.refreshing;

const networkError = () => new NetworkError(new TypeError("Network request failed"));

beforeEach(() => {
  // The fixtures' business day: 15 January 2026, 14:00 in Jerusalem.
  setNow("2026-01-15T12:00:00.000Z");
  mockFocusEffect = null;
  mockAuth.session = { role: "WORKER" };
  mockSync.isOnline = true;
  mockSync.pendingCount = 0;
  mockSync.queue = [];
  mockClient.listTimeEntries.mockResolvedValue([]);
  mockClient.listShifts.mockResolvedValue([]);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("HomeScreen (Arabic, RTL)", () => {
  it("shows the loading state with the header and the history button while shifts load", async () => {
    mockClient.listTimeEntries.mockReturnValue(new Promise(() => undefined));
    mockClient.listShifts.mockReturnValue(new Promise(() => undefined));
    await renderHome();

    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByText("جارٍ التحميل…")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.app.brand })).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.OrgRole.WORKER)).toBeOnTheScreen();
    expect(screen.getByText("عامل")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.common.signOut })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.home.history })).toBeOnTheScreen();
    expect(screen.queryByText(ar.home.noActive)).not.toBeOnTheScreen();
    expectArabicUiOnly();

    await fireEvent.press(screen.getByRole("button", { name: "سجل الحضور" }));
    expect(navigation.navigate).toHaveBeenCalledWith("History");
  });

  it("loads active entries and shifts with the same API calls as before", async () => {
    await renderHome();
    expect(await screen.findByText(ar.home.noShifts)).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(1);
    expect(mockClient.listTimeEntries).toHaveBeenCalledWith({ status: "ACTIVE" });
    expect(mockClient.listShifts).toHaveBeenCalledTimes(1);
    expect(mockClient.listShifts).toHaveBeenCalledWith();
  });

  it("reloads with the same API calls when the screen is focused again", async () => {
    await renderHome();
    expect(await screen.findByText(ar.home.noShifts)).toBeOnTheScreen();

    mockClient.listShifts.mockResolvedValue([shift({ id: "day", title: "وردية بعد العودة" })]);
    await refocus();

    expect(await screen.findByText(iso("وردية بعد العودة"))).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(2);
    expect(mockClient.listTimeEntries).toHaveBeenLastCalledWith({ status: "ACTIVE" });
    expect(mockClient.listShifts).toHaveBeenCalledTimes(2);
    expect(mockClient.listShifts).toHaveBeenLastCalledWith();
    expectArabicUiOnly();
  });

  it("lists upcoming shifts (title, site, Jerusalem date and times) with a clock-in button each", async () => {
    mockClient.listShifts.mockResolvedValue([
      // Summer time (UTC+3): 21:30Z is 00:30 the next day in Jerusalem.
      shift({ id: "night", title: "مناوبة شارع هرتسل", scheduledStart: "2026-07-15T21:30:00.000Z", scheduledEnd: "2026-07-16T05:00:00.000Z", status: "OPEN", site: null, siteId: null }),
      shift({ id: "day" }),
      shift({ id: "emergency", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT", status: "ACTIVE", scheduledStart: "2026-03-01T06:00:00.000Z", scheduledEnd: "2026-03-01T10:00:00.000Z" }),
      shift({ id: "draft", title: "وردية مسودة", status: "DRAFT" }),
      shift({ id: "closed", title: "وردية مغلقة", status: "CLOSED" }),
    ]);
    await renderHome();

    expect(await screen.findByText(ar.home.noActive)).toBeOnTheScreen();
    expect(screen.getByText("لم تبدأ الدوام بعد.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: ar.home.yourShifts })).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "وردياتك" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.home.history })).toBeOnTheScreen();

    // Winter (UTC+2): 08:30Z -> 10:30, 16:00Z -> 18:00.
    expect(screen.getByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expect(screen.getAllByText(iso("مفترق الساعة"))).toHaveLength(2);
    expect(screen.getByText("15 يناير 2026")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.home.shiftHours, { start: "10:30", end: "18:00" }))).toBeOnTheScreen();
    expect(screen.getByText("من 10:30 إلى 18:00")).toBeOnTheScreen();

    // The API's English placeholder title becomes the Arabic shift type.
    expect(screen.getByText(iso("استدعاء طوارئ"))).toBeOnTheScreen();
    expect(screen.queryByText("Emergency Call-out", { exact: false })).not.toBeOnTheScreen();
    expect(screen.getByText("1 مارس 2026")).toBeOnTheScreen();
    expect(screen.getByText("من 08:00 إلى 12:00")).toBeOnTheScreen();

    // No site; summer time.
    expect(screen.getByText(ar.home.noSite)).toBeOnTheScreen();
    expect(screen.getByText("16 يوليو 2026")).toBeOnTheScreen();
    expect(screen.getByText("من 00:30 إلى 08:00")).toBeOnTheScreen();

    // Only PUBLISHED / OPEN / ACTIVE shifts, earliest first.
    expect(screen.queryByText("وردية مسودة", { exact: false })).not.toBeOnTheScreen();
    expect(screen.queryByText("وردية مغلقة", { exact: false })).not.toBeOnTheScreen();
    const clockInButtons = screen.getAllByRole("button", { name: /^بدء الدوام في / });
    expect(clockInButtons.map((b) => b.props.accessibilityLabel)).toEqual([
      fill(ar.home.clockInFor, { shift: "صيانة إشارات شارع يافا" }),
      fill(ar.home.clockInFor, { shift: "استدعاء طوارئ" }),
      fill(ar.home.clockInFor, { shift: "مناوبة شارع هرتسل" }),
    ]);
    expect(screen.getAllByText(ar.common.clockIn)).toHaveLength(3);
    expect(screen.getAllByText("بدء الدوام")).toHaveLength(3);
    expectArabicUiOnly();
  });

  it("keeps a Latin site name and shift title in their own direction", async () => {
    mockClient.listShifts.mockResolvedValue([
      shift({
        id: "latin",
        title: "Gate (B) repair",
        site: { id: "site-2", projectId: "project-1", name: "12 Jaffa Rd", latitude: 32.05, longitude: 34.75, defaultGeofenceRadiusMeters: 150 },
      }),
    ]);
    await renderHome();

    // Inside the isolate the text keeps its own (LTR) order instead of becoming "Jaffa Rd 12".
    expect(await screen.findByText("\u206812 Jaffa Rd\u2069")).toBeOnTheScreen();
    expect(screen.getByText("\u2068Gate (B) repair\u2069")).toBeOnTheScreen();
    // The clock-in screen gets the plain title.
    await fireEvent.press(screen.getByRole("button", { name: "بدء الدوام في Gate (B) repair" }));
    expect(navigation.navigate).toHaveBeenLastCalledWith("ClockIn", { shiftId: "latin", shiftTitle: "Gate (B) repair" });
    expectArabicUiOnly(["12 Jaffa Rd", "Gate (B) repair"]);
  });

  it("opens clock-in with the shift id and the title shown on the card", async () => {
    mockClient.listShifts.mockResolvedValue([
      shift({ id: "day" }),
      shift({ id: "emergency", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT", scheduledStart: "2026-01-16T08:30:00.000Z" }),
    ]);
    await renderHome();

    await fireEvent.press(await screen.findByRole("button", { name: "بدء الدوام في صيانة إشارات شارع يافا" }));
    expect(navigation.navigate).toHaveBeenLastCalledWith("ClockIn", { shiftId: "day", shiftTitle: "صيانة إشارات شارع يافا" });

    await fireEvent.press(screen.getByRole("button", { name: "بدء الدوام في استدعاء طوارئ" }));
    expect(navigation.navigate).toHaveBeenLastCalledWith("ClockIn", { shiftId: "emergency", shiftTitle: "استدعاء طوارئ" });
  });

  it("shows the active entry with its start time and a large clock-out button, and hides clock-in", async () => {
    mockClient.listTimeEntries.mockResolvedValue([activeEntry()]);
    mockClient.listShifts.mockResolvedValue([shift({ id: "shift-1", status: "ACTIVE" })]);
    await renderHome();

    expect(await screen.findByText(ar.home.activeLabel)).toBeOnTheScreen();
    expect(screen.getByText("أنت في الدوام الآن")).toBeOnTheScreen();
    expect(screen.getAllByText(iso("صيانة إشارات شارع يافا"))).toHaveLength(2);
    expect(screen.getByText(fill(ar.home.activeSince, { time: "10:30" }))).toBeOnTheScreen();
    expect(screen.getByText("بدأت الساعة 10:30")).toBeOnTheScreen();
    expect(screen.queryByText(ar.home.noActive)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.common.clockIn)).not.toBeOnTheScreen();

    const clockOut = screen.getByRole("button", { name: "إنهاء الدوام" });
    expect(clockOut).toHaveStyle({ minHeight: 56 });
    await fireEvent.press(clockOut);
    expect(navigation.navigate).toHaveBeenCalledWith("ClockOut");
    expectArabicUiOnly();
  });

  it("shows the date when the active entry started on another day (forgotten clock-out or a night shift)", async () => {
    // 20:00Z on 14 January is 22:00 in Jerusalem; "now" is 15 January.
    mockClient.listTimeEntries.mockResolvedValue([activeEntry({ businessDate: "2026-01-14", clockInAt: "2026-01-14T20:00:00.000Z" })]);
    await renderHome();

    expect(await screen.findByText(fill(ar.home.activeSinceDate, { dateTime: "14 يناير 2026 في 22:00" }))).toBeOnTheScreen();
    expect(screen.getByText("بدأت في 14 يناير 2026 في 22:00")).toBeOnTheScreen();
    expect(screen.queryByText("بدأت الساعة 22:00")).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows an active emergency call-out in Arabic, and a plain shift label when the entry has no shift", async () => {
    setNow("2026-07-16T06:00:00.000Z");
    mockClient.listTimeEntries.mockResolvedValue([
      activeEntry({ shift: shift({ id: "shift-9", title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" }), clockInAt: "2026-07-15T21:30:00.000Z" }),
    ]);
    await renderHome();
    expect(await screen.findByText(iso("استدعاء طوارئ"))).toBeOnTheScreen();
    // 21:30Z is 00:30 on 16 July in Jerusalem: the same day as "now".
    expect(screen.getByText("بدأت الساعة 00:30")).toBeOnTheScreen();
    expectArabicUiOnly();

    mockClient.listTimeEntries.mockResolvedValue([activeEntry({ shift: undefined, clockInAt: "2026-07-16T05:00:00.000Z" })]);
    await pullToRefresh();
    expect(await screen.findByText(iso(ar.common.shift))).toBeOnTheScreen();
    expect(screen.getByText(iso("وردية"))).toBeOnTheScreen();
    expect(screen.getByText("بدأت الساعة 08:00")).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows the empty state when no upcoming shifts are assigned", async () => {
    mockClient.listShifts.mockResolvedValue([shift({ id: "old", status: "CLOSED" })]);
    await renderHome();

    expect(await screen.findByText(ar.home.noShifts)).toBeOnTheScreen();
    expect(screen.getByText("لا توجد ورديات قادمة.")).toBeOnTheScreen();
    expect(screen.getByText(ar.home.noShiftsHint)).toBeOnTheScreen();
    expect(screen.getByText(ar.home.noActive)).toBeOnTheScreen();
    expect(screen.queryByText(ar.common.clockIn)).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows the load error in Arabic, keeps history reachable, and retries through the loading state", async () => {
    mockClient.listTimeEntries.mockRejectedValueOnce(networkError());
    mockClient.listShifts.mockResolvedValue([shift({ id: "day" })]);
    await renderHome();

    expect(await screen.findByText(`${ar.home.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText("تعذّر تحميل وردياتك.\nتعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.")).toBeOnTheScreen();
    // Nothing is known yet: no "not clocked in" claim and no empty-list message.
    expect(screen.queryByText(ar.home.noActive)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.home.noShifts)).not.toBeOnTheScreen();
    // History is still one tap away.
    await fireEvent.press(screen.getByRole("button", { name: ar.home.history }));
    expect(navigation.navigate).toHaveBeenCalledWith("History");
    expectArabicUiOnly();

    const next = deferred<TimeEntry[]>();
    mockClient.listTimeEntries.mockReturnValueOnce(next.promise);
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.queryByText(ar.home.loadError, { exact: false })).not.toBeOnTheScreen();
    expectArabicUiOnly();

    await act(async () => next.resolve([]));
    expect(await screen.findByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expect(screen.queryByText(ar.home.loadError, { exact: false })).not.toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(2);
  });

  it("shows the loading state, not a blank screen, when refocused after a failed first load", async () => {
    mockClient.listShifts.mockRejectedValueOnce(networkError());
    await renderHome();
    expect(await screen.findByText(`${ar.home.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();

    const next = deferred<Shift[]>();
    mockClient.listShifts.mockReturnValueOnce(next.promise);
    await refocus();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.home.history })).toBeOnTheScreen();
    expectArabicUiOnly();

    await act(async () => next.resolve([shift({ id: "day" })]));
    expect(await screen.findByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expect(mockClient.listShifts).toHaveBeenCalledTimes(2);
  });

  it("never shows the API's English error message", async () => {
    mockClient.listShifts.mockRejectedValue(new ApiRequestError(403, { code: "FORBIDDEN", message: "You do not have access" } as never));
    await renderHome();

    expect(await screen.findByText(`${ar.home.loadError}\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expect(screen.queryByText(/You do not have access/)).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("keeps the loaded shifts when a refresh fails, and retries with the refresh spinner", async () => {
    mockClient.listShifts.mockResolvedValue([shift({ id: "day" })]);
    await renderHome();
    expect(await screen.findByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();

    mockClient.listShifts.mockRejectedValue(networkError());
    await pullToRefresh();

    expect(await screen.findByText(`${ar.home.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.states.retry })).toBeOnTheScreen();
    expect(screen.getByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expect(screen.getByText(ar.home.noActive)).toBeOnTheScreen();
    expect(isRefreshing()).toBe(false);
    expectArabicUiOnly();

    const next = deferred<Shift[]>();
    mockClient.listShifts.mockReturnValue(next.promise);
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    // The data stays on screen with the spinner on top (no full loading state).
    expect(isRefreshing()).toBe(true);
    expect(screen.queryByLabelText(ar.states.loading)).not.toBeOnTheScreen();
    expect(screen.getByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();

    await act(async () => next.resolve([shift({ id: "new", title: "وردية جديدة" })]));
    expect(await screen.findByText(iso("وردية جديدة"))).toBeOnTheScreen();
    expect(isRefreshing()).toBe(false);
    expect(screen.queryByText(ar.home.loadError, { exact: false })).not.toBeOnTheScreen();
    expect(mockClient.listShifts).toHaveBeenCalledTimes(3);
    expectArabicUiOnly();
  });

  it("reloads on pull to refresh and shows the spinner while it runs", async () => {
    await renderHome();
    expect(await screen.findByText(ar.home.noShifts)).toBeOnTheScreen();

    const next = deferred<Shift[]>();
    mockClient.listShifts.mockReturnValue(next.promise);
    await pullToRefresh();
    expect(isRefreshing()).toBe(true);
    expectArabicUiOnly();

    await act(async () => next.resolve([shift({ id: "new", title: "وردية جديدة" })]));
    expect(await screen.findByText(iso("وردية جديدة"))).toBeOnTheScreen();
    expect(isRefreshing()).toBe(false);
    expect(mockClient.listShifts).toHaveBeenCalledTimes(2);
    expectArabicUiOnly();
  });

  it("shows the offline banner with the pending count and opens the offline queue", async () => {
    mockSync.isOnline = false;
    mockSync.pendingCount = 2;
    await renderHome();

    expect(await screen.findByText(ar.connection.offline)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.connection.pending, { count: 2 }))).toBeOnTheScreen();
    expect(screen.getByText("بانتظار المزامنة: 2")).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offlineHint)).toBeOnTheScreen();
    expectArabicUiOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).toHaveBeenCalledWith("OfflineQueue");
  });

  it("shows the syncing banner when back online with events still pending", async () => {
    mockSync.pendingCount = 1;
    await renderHome();
    expect(await screen.findByText(ar.connection.syncing)).toBeOnTheScreen();
    expect(screen.getByText("بانتظار المزامنة: 1")).toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.offline)).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("hides the connection banner when online with nothing pending", async () => {
    await renderHome();
    expect(await screen.findByText(ar.home.noShifts)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.connection.openQueue })).not.toBeOnTheScreen();
  });

  it("shows a clock-in waiting to sync instead of offering a second clock-in, and still allows clock-out", async () => {
    mockSync.pendingCount = 1;
    mockSync.queue = [queued({ eventType: "CLOCK_IN", shiftId: "day", deviceTimestamp: "2026-01-15T08:31:00.000Z" })];
    mockClient.listShifts.mockResolvedValue([shift({ id: "day" }), shift({ id: "other", title: "وردية أخرى" })]);
    await renderHome();

    expect(await screen.findByText(ar.home.pendingClockIn)).toBeOnTheScreen();
    expect(screen.getByText("بدء الدوام بانتظار المزامنة")).toBeOnTheScreen();
    expect(screen.getAllByText(iso("صيانة إشارات شارع يافا"))).toHaveLength(2);
    expect(screen.getByText("بدأت الساعة 10:31")).toBeOnTheScreen();
    expect(screen.getByText(ar.home.pendingHint)).toBeOnTheScreen();
    expect(screen.getByText("محفوظ على هاتفك وسيُرسل تلقائيًا.")).toBeOnTheScreen();
    // Not "not clocked in", and no clock-in button on any shift.
    expect(screen.queryByText(ar.home.noActive)).not.toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /^بدء الدوام في / })).not.toBeOnTheScreen();
    expectArabicUiOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.common.clockOut }));
    expect(navigation.navigate).toHaveBeenCalledWith("ClockOut");
  });

  it("shows a clock-in waiting to sync while offline, when the shifts cannot load", async () => {
    mockSync.isOnline = false;
    mockSync.pendingCount = 1;
    mockSync.queue = [queued({ eventType: "CLOCK_IN", shiftId: "day", deviceTimestamp: "2026-01-14T20:00:00.000Z" })];
    mockClient.listTimeEntries.mockRejectedValue(networkError());
    await renderHome();

    expect(await screen.findByText(`${ar.home.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expect(screen.getByText(ar.home.pendingClockIn)).toBeOnTheScreen();
    // The shift is unknown without the list: the plain label. Started yesterday: with the date.
    expect(screen.getByText(iso("وردية"))).toBeOnTheScreen();
    expect(screen.getByText("بدأت في 14 يناير 2026 في 22:00")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.common.clockOut })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.home.history })).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows a clock-out waiting to sync in place of the clock-out button", async () => {
    mockSync.pendingCount = 1;
    mockSync.queue = [
      queued({ eventType: "CLOCK_IN", shiftId: "shift-1", localStatus: "VERIFIED", deviceTimestamp: "2026-01-15T08:30:00.000Z" }),
      queued({ eventType: "CLOCK_OUT", deviceTimestamp: "2026-01-15T11:45:00.000Z" }),
    ];
    mockClient.listTimeEntries.mockResolvedValue([activeEntry()]);
    await renderHome();

    expect(await screen.findByText(ar.home.activeLabel)).toBeOnTheScreen();
    expect(screen.getByText(ar.home.pendingClockOut)).toBeOnTheScreen();
    expect(screen.getByText("إنهاء الدوام بانتظار المزامنة")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.home.endedAt, { time: "13:45" }))).toBeOnTheScreen();
    expect(screen.getByText("أنهيت دوامك الساعة 13:45")).toBeOnTheScreen();
    expect(screen.getByText(ar.home.pendingHint)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.common.clockOut })).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows a clock-out waiting to sync when the server has no active entry, and allows the next clock-in", async () => {
    mockSync.isOnline = false;
    mockSync.pendingCount = 2;
    mockSync.queue = [
      queued({ eventType: "CLOCK_IN", shiftId: "day", deviceTimestamp: "2026-01-14T06:00:00.000Z" }),
      queued({ eventType: "CLOCK_OUT", deviceTimestamp: "2026-01-14T15:00:00.000Z" }),
    ];
    mockClient.listShifts.mockResolvedValue([shift({ id: "day" })]);
    await renderHome();

    expect(await screen.findByText(ar.home.pendingClockOut)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.home.endedAtDate, { dateTime: "14 يناير 2026 في 17:00" }))).toBeOnTheScreen();
    expect(screen.getByText("أنهيت دوامك في 14 يناير 2026 في 17:00")).toBeOnTheScreen();
    expect(screen.queryByText(ar.home.pendingClockIn)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.home.noActive)).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "بدء الدوام في صيانة إشارات شارع يافا" })).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("reloads once the queued clock events have synced", async () => {
    mockSync.pendingCount = 1;
    mockSync.queue = [queued({ eventType: "CLOCK_IN", shiftId: "shift-1" })];
    mockClient.listShifts.mockResolvedValue([shift({ id: "shift-1" })]);
    await renderHome();
    expect(await screen.findByText(ar.home.pendingClockIn)).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(1);

    // A second event queued: nothing synced yet, no reload.
    mockSync.pendingCount = 2;
    mockSync.queue = [...mockSync.queue, queued({ eventType: "CLOCK_OUT", clientEventId: "evt-2", deviceTimestamp: "2026-01-15T09:00:00.000Z" })];
    await screen.rerender(homeElement());
    expect(screen.getByText(ar.home.pendingClockOut)).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(1);

    // Synced: the server now has the entry.
    mockClient.listTimeEntries.mockResolvedValue([activeEntry()]);
    mockSync.pendingCount = 0;
    mockSync.queue = [
      { ...mockSync.queue[0], localStatus: "VERIFIED" },
      { ...mockSync.queue[1], localStatus: "VERIFIED" },
    ];
    await screen.rerender(homeElement());

    expect(await screen.findByText(ar.home.activeLabel)).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(2);
    expect(mockClient.listTimeEntries).toHaveBeenLastCalledWith({ status: "ACTIVE" });
    expect(mockClient.listShifts).toHaveBeenLastCalledWith();
    expect(screen.queryByText(ar.home.pendingClockIn)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.home.pendingClockOut)).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: ar.common.clockOut })).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("opens the attendance history with a full-size button", async () => {
    await renderHome();
    const history = await screen.findByRole("button", { name: "سجل الحضور" });
    expect(history).toHaveStyle({ minHeight: 56 });
    await fireEvent.press(history);
    expect(navigation.navigate).toHaveBeenCalledWith("History");
  });

  it("asks before signing out", async () => {
    await renderHome();
    const signOut = await screen.findByRole("button", { name: "تسجيل الخروج" });
    expect(signOut).toHaveStyle({ minHeight: 56 });

    await fireEvent.press(signOut);
    expect(mockLogout).not.toHaveBeenCalled();
    expect(screen.getByText(ar.home.signOutConfirm)).toBeOnTheScreen();
    expect(screen.getByText("هل تريد تسجيل الخروج؟")).toBeOnTheScreen();
    expect(screen.queryByText(ar.home.signOutPending, { exact: false })).not.toBeOnTheScreen();
    expectArabicUiOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.common.cancel }));
    expect(screen.queryByText(ar.home.signOutConfirm)).not.toBeOnTheScreen();
    expect(mockLogout).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: ar.common.signOut }));
    await fireEvent.press(screen.getByRole("button", { name: "نعم، سجّل الخروج" }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("warns that records waiting to sync stay on the phone after signing out", async () => {
    mockSync.isOnline = false;
    mockSync.pendingCount = 3;
    await renderHome();
    await fireEvent.press(await screen.findByRole("button", { name: ar.common.signOut }));

    expect(screen.getByText(fill(ar.home.signOutPending, { count: 3 }))).toBeOnTheScreen();
    expect(screen.getByText("لديك تسجيلات بانتظار المزامنة: 3. لن تُرسل حتى تسجّل الدخول مرة أخرى.")).toBeOnTheScreen();
    expectArabicUiOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.home.signOutYes }));
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it("translates the role of a field manager", async () => {
    mockAuth.session = { role: "FIELD_MANAGER" };
    await renderHome();
    expect(await screen.findByText("مدير ميدان")).toBeOnTheScreen();
    expectArabicUiOnly();
  });
});
