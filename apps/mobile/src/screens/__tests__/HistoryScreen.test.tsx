import type { ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type Shift, type TimeEntry } from "@fieldmaster/api-client";
import { IntlRoot } from "../../i18n/IntlRoot";
import ar from "../../i18n/messages";
import type { QueuedEvent } from "../../lib/offline-queue";
import { colors } from "../../lib/theme";
import { HistoryScreen } from "../HistoryScreen";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = { listTimeEntries: jest.fn() };
const mockAuth = { client: mockClient, logout: jest.fn(), session: { role: "WORKER" } };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => mockAuth }));

const mockSync: { isOnline: boolean; pendingCount: number; queue: QueuedEvent[] } = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

const navigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
const route = { key: "History-1", name: "History" as const, params: undefined };

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

function historyElement() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <HistoryScreen navigation={navigation as any} route={route} />;
}

async function renderHistory() {
  await render(historyElement(), { wrapper: ThrowingIntl });
}

/** Fills an ICU message's {placeholders} (simple arguments only). */
function fill(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

/** User data (shift titles, daily summaries) is shown inside a first-strong isolate so it keeps its own direction. */
const iso = (value: string) => `\u2068${value}\u2069`;
const stripIsolates = (value: string) => value.replace(/[\u2066-\u2069]/g, "");

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

/** No English UI text and no Arabic-Indic digits. Latin data (`data`) is removed first. */
function expectArabicUiOnly(data: string[] = []) {
  const stripData = (text: string) => data.reduce((acc, value) => acc.split(value).join(""), text);
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

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "shift-1",
    organizationId: "org-1",
    projectId: null,
    siteId: null,
    geofenceId: null,
    shiftType: "STANDARD",
    title: "صيانة إشارات شارع يافا",
    scheduledStart: "2026-01-15T08:30:00.000Z",
    scheduledEnd: "2026-01-15T17:30:00.000Z",
    checkInMethod: "GEOFENCED",
    status: "CLOSED",
    managerId: "manager-1",
    businessDate: "2026-01-15",
    ...overrides,
  } as Shift;
}

function entry(overrides: Partial<TimeEntry> & Pick<TimeEntry, "id">): TimeEntry {
  return {
    organizationId: "org-1",
    workerProfileId: "worker-1",
    shiftId: "shift-1",
    status: "APPROVED",
    businessDate: "2026-01-15",
    clockInAt: "2026-01-15T08:30:00.000Z",
    clockOutAt: "2026-01-15T17:30:00.000Z",
    rawDurationMinutes: 540,
    approvedRegularMinutes: 480,
    approvedOvertimeMinutes: 60,
    fullDayCredit: false,
    shift: shift(),
    dailySummary: null,
    ...overrides,
  } as TimeEntry;
}

/** A clock event saved on the phone (offline queue). */
function queued(overrides: Partial<QueuedEvent> & Pick<QueuedEvent, "eventType">): QueuedEvent {
  return {
    clientEventId: `evt-${overrides.eventType}`,
    shiftId: null,
    deviceTimestamp: "2026-01-15T17:30:00.000Z",
    latitude: 32.05,
    longitude: 34.75,
    accuracyMeters: 8,
    signature: "signature",
    localStatus: "PENDING",
    queuedAt: "2026-01-15T17:30:01.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function pullToRefresh() {
  const list = screen.getByTestId("history-list");
  await act(async () => {
    (list.props.refreshControl as { props: { onRefresh: () => void } }).props.onRefresh();
  });
}

const isRefreshing = () => (screen.getByTestId("history-list").props.refreshControl as { props: { refreshing: boolean } }).props.refreshing;

const networkError = () => new NetworkError(new TypeError("Network request failed"));

/** The card (host View) that holds a given text. */
function cardOf(text: string) {
  let node = screen.getByText(text).parent;
  while (node && !(node.props.style && JSON.stringify(node.props.style).includes(`"borderColor":"${colors.border}"`))) node = node.parent;
  if (!node) throw new Error(`no card for ${text}`);
  return node;
}

beforeEach(() => {
  mockSync.isOnline = true;
  mockSync.pendingCount = 0;
  mockSync.queue = [];
  mockClient.listTimeEntries.mockResolvedValue([]);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("HistoryScreen (Arabic, RTL)", () => {
  it("shows the title, a back button and the loading state while history loads", async () => {
    mockClient.listTimeEntries.mockReturnValue(new Promise(() => undefined));
    await renderHistory();

    expect(screen.getByRole("header", { name: ar.history.title })).toBeOnTheScreen();
    expect(screen.getByText("سجل الحضور")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "رجوع" })).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.getByText("جارٍ التحميل…")).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("loads every time entry with the same API call as before", async () => {
    await renderHistory();
    expect(await screen.findByText(ar.history.empty)).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(1);
    expect(mockClient.listTimeEntries).toHaveBeenCalledWith();
  });

  it("goes back with the back button", async () => {
    await renderHistory();
    await fireEvent.press(screen.getByRole("button", { name: ar.common.back }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("shows each entry in Arabic: title, status, business date, Jerusalem times, duration and daily summary", async () => {
    mockClient.listTimeEntries.mockResolvedValue([
      entry({ id: "approved", dailySummary: { text: "ركّبنا إشارتين جديدتين.", taskCategory: "TRAFFIC_LIGHT_INSTALLATION" } }),
    ]);
    await renderHistory();

    expect(await screen.findByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.TimeEntryStatus.APPROVED)).toBeOnTheScreen();
    expect(screen.getByText("تمت الموافقة")).toBeOnTheScreen();
    expect(screen.getByText("15 يناير 2026")).toBeOnTheScreen();
    // 08:30Z / 17:30Z in winter (UTC+2).
    expect(screen.getByText(fill(ar.history.hours, { start: "10:30", end: "19:30" }))).toBeOnTheScreen();
    expect(screen.getByText("من 10:30 إلى 19:30")).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.history.worked, { duration: "9 س 0 د" }))).toBeOnTheScreen();
    expect(screen.getByText("مدة الدوام: 9 س 0 د")).toBeOnTheScreen();
    const summary = screen.getByText(fill(ar.history.summary, { text: iso("ركّبنا إشارتين جديدتين.") }));
    expect(summary).toBeOnTheScreen();
    expect(summary).not.toHaveStyle({ fontStyle: "italic" });
    expect(screen.getByText(`ملخص العمل اليومي: ${iso("ركّبنا إشارتين جديدتين.")}`)).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("keeps a Latin shift title and daily summary in their own direction", async () => {
    mockClient.listTimeEntries.mockResolvedValue([
      entry({ id: "latin", shift: shift({ title: "12 Jaffa Rd" }), dailySummary: { text: "Gate (B) fixed", taskCategory: "OTHER" } }),
    ]);
    await renderHistory();

    expect(await screen.findByText("\u206812 Jaffa Rd\u2069")).toBeOnTheScreen();
    expect(screen.getByText("ملخص العمل اليومي: \u2068Gate (B) fixed\u2069")).toBeOnTheScreen();
    expectArabicUiOnly(["12 Jaffa Rd", "Gate (B) fixed"]);
  });

  it("lists entries newest first", async () => {
    mockClient.listTimeEntries.mockResolvedValue([
      entry({ id: "old", businessDate: "2026-01-10", shift: shift({ title: "وردية قديمة" }) }),
      entry({ id: "newest", businessDate: "2026-02-03", shift: shift({ title: "أحدث وردية" }) }),
      entry({ id: "middle-early", businessDate: "2026-01-20", clockInAt: "2026-01-20T05:00:00.000Z", shift: shift({ title: "وردية الصباح" }) }),
      entry({ id: "middle-late", businessDate: "2026-01-20", clockInAt: "2026-01-20T12:00:00.000Z", shift: shift({ title: "وردية الظهر" }) }),
    ]);
    await renderHistory();

    await screen.findByText(iso("أحدث وردية"));
    const titles = screen
      .getAllByText(/وردية/)
      .map((el) => stripIsolates((el.children as unknown[]).join("")))
      .filter((text) => !text.includes(":"));
    expect(titles).toEqual(["أحدث وردية", "وردية الظهر", "وردية الصباح", "وردية قديمة"]);
    expect(screen.getByText("3 فبراير 2026")).toBeOnTheScreen();
    expect(screen.getAllByText("20 يناير 2026")).toHaveLength(2);
    expect(screen.getByText("10 يناير 2026")).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("gives every status its Arabic label and colour", async () => {
    mockClient.listTimeEntries.mockResolvedValue([
      entry({ id: "a", status: "ACTIVE", clockOutAt: null, rawDurationMinutes: null, shift: shift({ title: "أولى" }), businessDate: "2026-01-05" }),
      entry({ id: "b", status: "PENDING_APPROVAL", shift: shift({ title: "ثانية" }), businessDate: "2026-01-04" }),
      entry({ id: "c", status: "APPROVED", shift: shift({ title: "ثالثة" }), businessDate: "2026-01-03" }),
      entry({ id: "d", status: "REJECTED", shift: shift({ title: "رابعة" }), businessDate: "2026-01-02" }),
      entry({ id: "e", status: "CORRECTION_REQUESTED", shift: shift({ title: "خامسة" }), businessDate: "2026-01-01" }),
    ]);
    await renderHistory();
    await screen.findByText(iso("أولى"));

    const expected: [string, string, string][] = [
      ["أولى", "جارٍ", colors.primary],
      ["ثانية", "بانتظار الموافقة", colors.warning],
      ["ثالثة", "تمت الموافقة", colors.success],
      ["رابعة", "مرفوض", colors.danger],
      ["خامسة", "مطلوب تصحيح", colors.warning],
    ];
    for (const [title, label, color] of expected) {
      const badge = within(cardOf(iso(title))).getByText(label);
      expect(badge.parent).toHaveStyle({ backgroundColor: color });
    }
    expect(screen.queryByText(/PENDING|APPROVED|REJECTED|ACTIVE|CORRECTION/)).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows a running entry as still going, without a duration line or a summary line", async () => {
    mockClient.listTimeEntries.mockResolvedValue([
      entry({ id: "running", status: "ACTIVE", clockOutAt: null, rawDurationMinutes: null, dailySummary: { text: null, taskCategory: "OTHER" } }),
    ]);
    await renderHistory();

    expect(await screen.findByText(fill(ar.history.hoursOpen, { start: "10:30" }))).toBeOnTheScreen();
    expect(screen.getByText("من 10:30 حتى الآن")).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.TimeEntryStatus.ACTIVE)).toBeOnTheScreen();
    expect(screen.queryByText(/مدة الدوام/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/—/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/ملخص العمل اليومي/)).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("formats summer times in Jerusalem and long durations", async () => {
    mockClient.listTimeEntries.mockResolvedValue([
      entry({ id: "night", businessDate: "2026-07-15", clockInAt: "2026-07-15T18:00:00.000Z", clockOutAt: "2026-07-16T04:15:00.000Z", rawDurationMinutes: 615 }),
    ]);
    await renderHistory();

    expect(await screen.findByText("15 يوليو 2026")).toBeOnTheScreen();
    expect(screen.getByText("من 21:00 إلى 07:15")).toBeOnTheScreen();
    expect(screen.getByText("مدة الدوام: 10 س 15 د")).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows the emergency placeholder title as استدعاء طوارئ and an entry without a shift as وردية", async () => {
    mockClient.listTimeEntries.mockResolvedValue([
      entry({ id: "emergency", businessDate: "2026-01-16", shift: shift({ title: "Emergency Call-out", shiftType: "EMERGENCY_CALLOUT" }) }),
      entry({ id: "no-shift", businessDate: "2026-01-15", shift: undefined }),
    ]);
    await renderHistory();

    expect(await screen.findByText(iso("استدعاء طوارئ"))).toBeOnTheScreen();
    expect(screen.queryByText("Emergency Call-out", { exact: false })).not.toBeOnTheScreen();
    expect(screen.getByText(iso(ar.common.shift))).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows the empty state when there are no records", async () => {
    await renderHistory();
    expect(await screen.findByText(ar.history.empty)).toBeOnTheScreen();
    expect(screen.getByText("لا توجد سجلات حضور بعد.")).toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows the load error in Arabic with a retry that goes through the loading state", async () => {
    mockClient.listTimeEntries.mockRejectedValueOnce(networkError());
    await renderHistory();

    expect(await screen.findByText(`${ar.history.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText("تعذّر تحميل سجل الحضور.\nتعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.")).toBeOnTheScreen();
    expect(screen.queryByText(ar.history.empty)).not.toBeOnTheScreen();
    expectArabicUiOnly();

    const next = deferred<TimeEntry[]>();
    mockClient.listTimeEntries.mockReturnValueOnce(next.promise);
    await fireEvent.press(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    expect(screen.queryByText(ar.history.loadError, { exact: false })).not.toBeOnTheScreen();
    expectArabicUiOnly();

    await act(async () => next.resolve([entry({ id: "approved" })]));
    expect(await screen.findByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(2);
    expect(mockClient.listTimeEntries).toHaveBeenLastCalledWith();
  });

  it("never shows the API's English error message", async () => {
    mockClient.listTimeEntries.mockRejectedValue(new ApiRequestError(500, { code: "INTERNAL_ERROR", message: "Internal server error" } as never));
    await renderHistory();

    expect(await screen.findByText(`${ar.history.loadError}\n${ar.errors.INTERNAL_ERROR}`)).toBeOnTheScreen();
    expect(screen.queryByText(/Internal server error/)).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("keeps the loaded records when a refresh fails, and reloads on pull to refresh", async () => {
    mockClient.listTimeEntries.mockResolvedValue([entry({ id: "approved" })]);
    await renderHistory();
    expect(await screen.findByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();

    mockClient.listTimeEntries.mockRejectedValue(networkError());
    await pullToRefresh();
    expect(await screen.findByText(`${ar.history.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(iso("صيانة إشارات شارع يافا"))).toBeOnTheScreen();
    expectArabicUiOnly();

    const next = deferred<TimeEntry[]>();
    mockClient.listTimeEntries.mockReturnValue(next.promise);
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(isRefreshing()).toBe(true);
    expect(screen.queryByLabelText(ar.states.loading)).not.toBeOnTheScreen();
    await act(async () => next.resolve([entry({ id: "other", shift: shift({ title: "وردية جديدة" }) })]));
    expect(await screen.findByText(iso("وردية جديدة"))).toBeOnTheScreen();
    expect(isRefreshing()).toBe(false);
    expect(screen.queryByText(ar.history.loadError, { exact: false })).not.toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(3);
    expectArabicUiOnly();
  });

  it("shows the offline banner with the pending count and opens the offline queue", async () => {
    mockSync.isOnline = false;
    mockSync.pendingCount = 2;
    mockClient.listTimeEntries.mockResolvedValue([entry({ id: "approved" })]);
    await renderHistory();

    expect(await screen.findByText(ar.connection.offline)).toBeOnTheScreen();
    expect(screen.getByText(fill(ar.connection.pending, { count: 2 }))).toBeOnTheScreen();
    expect(screen.getByText("بانتظار المزامنة: 2")).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offlineHint)).toBeOnTheScreen();
    expectArabicUiOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.connection.openQueue }));
    expect(navigation.navigate).toHaveBeenCalledWith("OfflineQueue");
  });

  it("shows the offline banner above the load error when offline", async () => {
    mockSync.isOnline = false;
    mockClient.listTimeEntries.mockRejectedValue(networkError());
    await renderHistory();

    expect(await screen.findByText(`${ar.history.loadError}\n${ar.errors.network}`)).toBeOnTheScreen();
    expect(screen.getByText(ar.connection.offline)).toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.pending, { exact: false })).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("shows the syncing banner when back online with records still pending", async () => {
    mockSync.pendingCount = 1;
    await renderHistory();
    expect(await screen.findByText(ar.connection.syncing)).toBeOnTheScreen();
    expect(screen.getByText("بانتظار المزامنة: 1")).toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.offline)).not.toBeOnTheScreen();
    expectArabicUiOnly();
  });

  it("hides the connection banner when online with nothing pending", async () => {
    await renderHistory();
    expect(await screen.findByText(ar.history.empty)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: ar.connection.openQueue })).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.offline)).not.toBeOnTheScreen();
    expect(screen.queryByText(ar.connection.syncing)).not.toBeOnTheScreen();
  });

  it("reloads once a queued clock-out has synced, so it appears in the list", async () => {
    mockSync.pendingCount = 1;
    mockSync.queue = [queued({ eventType: "CLOCK_OUT" })];
    mockClient.listTimeEntries.mockResolvedValue([entry({ id: "running", status: "ACTIVE", clockOutAt: null, rawDurationMinutes: null })]);
    await renderHistory();
    expect(await screen.findByText("من 10:30 حتى الآن")).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(1);

    mockClient.listTimeEntries.mockResolvedValue([entry({ id: "running", status: "PENDING_APPROVAL" })]);
    mockSync.pendingCount = 0;
    mockSync.queue = [{ ...mockSync.queue[0], localStatus: "VERIFIED" }];
    await screen.rerender(historyElement());

    expect(await screen.findByText("من 10:30 إلى 19:30")).toBeOnTheScreen();
    expect(screen.getByText("مدة الدوام: 9 س 0 د")).toBeOnTheScreen();
    expect(screen.getByText(ar.enums.TimeEntryStatus.PENDING_APPROVAL)).toBeOnTheScreen();
    expect(mockClient.listTimeEntries).toHaveBeenCalledTimes(2);
    expect(mockClient.listTimeEntries).toHaveBeenLastCalledWith();
    expectArabicUiOnly();
  });
});
