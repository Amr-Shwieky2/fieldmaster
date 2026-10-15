import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type AssignableWorker, type Shift, type Site } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import { addDays, businessInstant, defaultShiftTimes, shiftWindow } from "../../components/locations/business-time";
import { parseShekels } from "../../components/locations/money";
import { nearestFirst } from "../../components/locations/position";
import { confirmationTiming } from "../../components/locations/SavedConfirmation";
import { resetLocationHistory } from "../../lib/location";
import type { RootStackParamList } from "../../navigation/types";
import { assignmentConflicts, NewShiftScreen } from "../NewShiftScreen";
import { deferred, doubleTap, expectArabicOnly, freezeDate, renderInArabic } from "./clock-screens-test-utils";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = { listSites: jest.fn(), listAssignableWorkers: jest.fn(), createShiftWithWorkers: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } }) }));

let mockPermissions = new Set<string>();
jest.mock("../../lib/access-context", () => ({
  useAccess: () => ({ can: (permission: string) => mockPermissions.has(permission), restricted: false }),
}));

const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

// Every location call the screen makes is a mock this file controls.
jest.mock("expo-location", () => ({
  ...jest.requireActual("expo-location"),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));

type Navigation = NativeStackScreenProps<RootStackParamList, "NewShift">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

// ── Data ────────────────────────────────────────────────────────────────────

// 10:20 in Jerusalem (summer time, UTC+3): a new shift starts at 11:00 and ends at 19:00.
const NOW = "2026-10-15T07:20:00.000Z";
const START_ISO = "2026-10-15T08:00:00.000Z";
const END_ISO = "2026-10-15T16:00:00.000Z";

const HERE = { latitude: 32.0853, longitude: 34.7818 };

type SiteRow = Site & { address?: string | null };
const site = (id: string, name: string, latitude: number, longitude: number, address: string | null = null): SiteRow => ({
  id,
  projectId: "project-1",
  name,
  latitude,
  longitude,
  defaultGeofenceRadiusMeters: 100,
  address,
});
// In the API's order (oldest first): the farthest first.
const SITES: SiteRow[] = [
  site("far", "مستودع حيفا", 32.794, 34.9896),
  site("near", "ورشة يافا", 32.05, 34.76, "شارع يافا 12"),
  site("nearest", "ساحة البلدية", 32.086, 34.782),
];

const WORKERS: AssignableWorker[] = [
  { workerProfileId: "worker-1", fullLegalName: "سامي حداد", conflicts: [] },
  {
    workerProfileId: "worker-2",
    fullLegalName: "رامي خوري",
    conflicts: [{ shiftId: "shift-9", title: "صيانة الشبكة", scheduledStart: "2026-10-15T09:00:00.000Z", scheduledEnd: "2026-10-15T13:00:00.000Z" }],
  },
  { workerProfileId: "worker-3", fullLegalName: "نادر عيسى", conflicts: [] },
];

const GRANTED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" };
const DENIED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: "never" };
const POSITION: Location.LocationObject = {
  coords: { ...HERE, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  timestamp: 0,
  mocked: false,
};

const auto = (value: string) => `⁨${value}⁩`;

const CONFLICT_409 = () =>
  new ApiRequestError(409, {
    statusCode: 409,
    code: "SHIFT_ASSIGNMENT_CONFLICT",
    message: "Some workers already have a shift at that time.",
    details: {
      conflicts: [
        {
          workerProfileId: "worker-1",
          shifts: [{ shiftId: "shift-7", title: "حراسة ليلية", scheduledStart: "2026-10-15T07:00:00.000Z", scheduledEnd: "2026-10-15T10:00:00.000Z" }],
        },
      ],
    },
    correlationId: "c",
  });

function createdShift(): Shift {
  return {
    id: "shift-new",
    organizationId: "org-1",
    projectId: "project-1",
    siteId: "near",
    geofenceId: "geofence-1",
    shiftType: "STANDARD",
    title: "ورشة يافا",
    scheduledStart: START_ISO,
    scheduledEnd: END_ISO,
    checkInMethod: "GEOFENCED",
    status: "PUBLISHED",
    managerId: "user-1",
    businessDate: "2026-10-15",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function renderNewShift() {
  await renderInArabic(<NewShiftScreen navigation={navigation as unknown as Navigation} route={{ key: "NewShift-1", name: "NewShift", params: undefined }} />);
}

/** Renders and waits for the sites list (the position read included). */
async function renderReady() {
  await renderNewShift();
  await screen.findByTestId("site-nearest");
}

const siteOrder = () => screen.getAllByTestId(/^site-/).map((element) => element.props.testID as string);
const publishButton = () => screen.getByTestId("publish-shift");

async function chooseSite(id: string) {
  await fireEvent.press(screen.getByTestId(`site-${id}`));
}

/** Waits for the workers list asked for the shift's times. */
async function workersShown() {
  return screen.findByTestId("worker-worker-1");
}

/** Opens a date/time field's picker and picks the instant (what the native picker reports). */
async function pick(field: "shift-date" | "shift-start" | "shift-end", iso: string) {
  await fireEvent.press(screen.getByTestId(field));
  await fireEvent(screen.getByTestId(`${field}-picker`), "change", { nativeEvent: { timestamp: Date.parse(iso) } });
  await fireEvent.press(screen.getByRole("button", { name: "تم" }));
}

beforeEach(() => {
  freezeDate(NOW);
  for (const fn of Object.values(mockClient)) fn.mockReset();
  mockPermissions = new Set([Permission.MANAGE_SHIFTS, Permission.VIEW_SHIFTS]);
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  confirmationTiming.ms = 60_000;
  resetLocationHistory();
  mockClient.listSites.mockResolvedValue(SITES);
  mockClient.listAssignableWorkers.mockResolvedValue(WORKERS);
  mockClient.createShiftWithWorkers.mockResolvedValue(createdShift());
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(GRANTED);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(POSITION);
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

// ── The site ────────────────────────────────────────────────────────────────

describe("NewShiftScreen: the site", () => {
  it("lists the sites nearest to the manager first, with the distance", async () => {
    await renderReady();

    expect(screen.getByRole("header", { name: "وردية جديدة" })).toBeOnTheScreen();
    expect(siteOrder()).toEqual(["site-nearest", "site-near", "site-far"]);
    expect(within(screen.getByTestId("site-nearest")).getByText("على بعد 80 م")).toBeOnTheScreen();
    expect(within(screen.getByTestId("site-near")).getByText("على بعد 4.4 كم")).toBeOnTheScreen();
    expect(within(screen.getByTestId("site-near")).getByText(auto("شارع يافا 12"))).toBeOnTheScreen();
    expect(within(screen.getByTestId("site-far")).getByText("على بعد 81.2 كم")).toBeOnTheScreen();
    expect(screen.getByText("الأقرب إليك أولًا.")).toBeOnTheScreen();
    expect(mockClient.listSites).toHaveBeenCalledWith();
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
    expectArabicOnly();
  });

  it("keeps the API's order without a position, and says why", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(DENIED);
    await renderReady();
    expect(siteOrder()).toEqual(["site-far", "site-near", "site-nearest"]);
    expect(screen.queryByText(/على بعد/)).not.toBeOnTheScreen();
    expect(screen.getByText("تعذّر تحديد موقعك، لذا تظهر المواقع بترتيبها المعتاد.")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("waits for the position before listing the sites, so they never reorder under a finger", async () => {
    const position = deferred<Location.LocationObject>();
    jest.mocked(Location.getCurrentPositionAsync).mockReturnValue(position.promise);
    await renderNewShift();
    expect(await screen.findByLabelText("جارٍ تحديد موقعك لترتيب المواقع حسب القرب…")).toBeOnTheScreen();
    expect(screen.queryByTestId("site-far")).not.toBeOnTheScreen();
    await act(async () => position.resolve(POSITION));
    expect(siteOrder()).toEqual(["site-nearest", "site-near", "site-far"]);
  });

  it("shows only the five nearest sites until «عرض كل المواقع»", async () => {
    const many = Array.from({ length: 7 }, (_, index) => site(`${index}`, `موقع رقم ${index + 1}`, HERE.latitude + index * 0.01, HERE.longitude));
    mockClient.listSites.mockResolvedValue(many);
    await renderNewShift();
    await screen.findByTestId("site-0");
    expect(siteOrder()).toEqual(["site-0", "site-1", "site-2", "site-3", "site-4"]);
    await fireEvent.press(screen.getByRole("button", { name: "عرض كل المواقع (7)" }));
    expect(siteOrder()).toHaveLength(7);
  });

  it("prefills the title with the chosen site's name until the manager types one", async () => {
    await renderReady();
    await chooseSite("near");
    expect(screen.getByTestId("site-near").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("shift-title").props.value).toBe("ورشة يافا");
    await chooseSite("far");
    expect(screen.getByTestId("shift-title").props.value).toBe("مستودع حيفا");

    await fireEvent.changeText(screen.getByTestId("shift-title"), "جرد المستودع");
    await chooseSite("nearest");
    expect(screen.getByTestId("shift-title").props.value).toBe("جرد المستودع");
  });

  it("shows a sites load failure in Arabic with a retry", async () => {
    mockClient.listSites.mockRejectedValueOnce(new ApiRequestError(403, { statusCode: 403, code: "FORBIDDEN", message: "Forbidden resource", correlationId: "c" }));
    await renderNewShift();
    expect(await screen.findByText(`تعذّر تحميل مواقع العمل.\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expectArabicOnly();
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByTestId("site-nearest")).toBeOnTheScreen();
  });

  it("says when there is no site yet", async () => {
    mockClient.listSites.mockResolvedValue([]);
    await renderNewShift();
    expect(await screen.findByText("لا توجد مواقع عمل بعد.")).toBeOnTheScreen();
    expect(screen.getByText("أضف موقع عمل أولًا، ثم أنشئ الوردية.")).toBeOnTheScreen();
  });
});

// ── Times and workers ───────────────────────────────────────────────────────

describe("NewShiftScreen: times and workers", () => {
  it("starts at the next full hour for eight hours, in Asia/Jerusalem time", async () => {
    await renderReady();
    expect(within(screen.getByTestId("shift-date")).getByText("15 أكتوبر 2026")).toBeOnTheScreen();
    expect(within(screen.getByTestId("shift-start")).getByText("11:00")).toBeOnTheScreen();
    expect(within(screen.getByTestId("shift-end")).getByText("19:00")).toBeOnTheScreen();
    expect(screen.getByTestId("shift-type-STANDARD").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.queryByTestId("shift-type-EMERGENCY_CALLOUT")).not.toBeOnTheScreen();
    expect(screen.getByTestId("check-in-method-GEOFENCED").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText(ar.enums.CheckInMethod.FLEXI_CHECK)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("asks for the workers only once a site is chosen, for the shift's instants", async () => {
    await renderReady();
    expect(screen.getByText("اختر الموقع والوقت لعرض العمال المتاحين.")).toBeOnTheScreen();
    expect(mockClient.listAssignableWorkers).not.toHaveBeenCalled();

    await chooseSite("near");
    await workersShown();
    expect(mockClient.listAssignableWorkers).toHaveBeenCalledTimes(1);
    expect(mockClient.listAssignableWorkers).toHaveBeenCalledWith(START_ISO, END_ISO);

    // Another site, same times: the same workers, not asked again.
    await chooseSite("far");
    expect(mockClient.listAssignableWorkers).toHaveBeenCalledTimes(1);
  });

  it("warns about a worker who already has a shift then, who can still be picked", async () => {
    await renderReady();
    await chooseSite("near");
    await workersShown();

    const busy = within(screen.getByTestId("worker-worker-2"));
    expect(busy.getByText("لديه وردية متداخلة")).toBeOnTheScreen();
    expect(busy.getByText(`${auto("صيانة الشبكة")}: 15 أكتوبر 2026، من 12:00 إلى 16:00`)).toBeOnTheScreen();
    expect(within(screen.getByTestId("worker-worker-1")).queryByText("لديه وردية متداخلة")).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId("worker-worker-2"));
    expect(screen.getByTestId("worker-worker-2").props.accessibilityState).toMatchObject({ checked: true });
    expect(
      screen.getByText("تنبيه: عدد العمال المختارين الذين لديهم ورديات متداخلة في هذا الوقت: 1. لن يقبل الخادم نشر الوردية قبل إزالتهم أو تغيير الوقت."),
    ).toBeOnTheScreen();
    expect(screen.getByText("العمال المختارون: 1")).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByTestId("worker-worker-2"));
    expect(screen.queryByText(/تنبيه:/)).not.toBeOnTheScreen();
  });

  it("asks again when the times change: a night shift ends the next day", async () => {
    await renderReady();
    await chooseSite("near");
    await workersShown();

    // The pickers work in Jerusalem time whatever the phone's zone.
    await fireEvent.press(screen.getByTestId("shift-start"));
    const picker = screen.getByTestId("shift-start-picker");
    expect(picker.props.timeZoneName).toBe("Asia/Jerusalem");
    expect(picker.props.mode).toBe("time");
    expect(picker.props.date).toBe(Date.parse(START_ISO));
    await fireEvent(picker, "change", { nativeEvent: { timestamp: Date.parse("2026-10-15T19:00:00.000Z") } });
    await fireEvent.press(screen.getByRole("button", { name: "تم" }));
    expect(screen.queryByTestId("shift-start-picker")).not.toBeOnTheScreen();
    expect(within(screen.getByTestId("shift-start")).getByText("22:00")).toBeOnTheScreen();

    await pick("shift-end", "2026-10-15T03:00:00.000Z");
    expect(within(screen.getByTestId("shift-end")).getByText("06:00")).toBeOnTheScreen();
    expect(screen.getByText("تنتهي في اليوم التالي (16 أكتوبر 2026)")).toBeOnTheScreen();
    await waitFor(() => expect(mockClient.listAssignableWorkers).toHaveBeenLastCalledWith("2026-10-15T19:00:00.000Z", "2026-10-16T03:00:00.000Z"));
    expectArabicOnly();
  });

  it("converts a winter date with Israel's winter offset", async () => {
    await renderReady();
    await chooseSite("near");
    await workersShown();
    await fireEvent.press(screen.getByTestId("shift-date"));
    expect(screen.getByTestId("shift-date-picker").props.mode).toBe("date");
    await fireEvent(screen.getByTestId("shift-date-picker"), "change", { nativeEvent: { timestamp: Date.parse("2026-11-10T10:00:00.000Z") } });
    expect(within(screen.getByTestId("shift-date")).getByText("10 نوفمبر 2026")).toBeOnTheScreen();
    await waitFor(() => expect(mockClient.listAssignableWorkers).toHaveBeenLastCalledWith("2026-11-10T09:00:00.000Z", "2026-11-10T17:00:00.000Z"));
  });

  it("refuses the same start and end time, without asking for workers", async () => {
    await renderReady();
    await chooseSite("near");
    await workersShown();
    await pick("shift-end", START_ISO);
    expect(screen.getByText("يجب أن يختلف وقت الانتهاء عن وقت البدء.")).toBeOnTheScreen();
    expect(screen.getByText("اختر الموقع والوقت لعرض العمال المتاحين.")).toBeOnTheScreen();
    expect(mockClient.listAssignableWorkers).toHaveBeenCalledTimes(1);
    await fireEvent.press(publishButton());
    expect(mockClient.createShiftWithWorkers).not.toHaveBeenCalled();
  });

  it("shows a workers load failure with a retry", async () => {
    mockClient.listAssignableWorkers.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderReady();
    await chooseSite("near");
    expect(await screen.findByText(`تعذّر تحميل العمال.\n${ar.errors.network}`)).toBeOnTheScreen();
    expectArabicOnly();
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    await workersShown();
    expect(mockClient.listAssignableWorkers).toHaveBeenCalledTimes(2);
  });
});

// ── Publishing ──────────────────────────────────────────────────────────────

describe("NewShiftScreen: publishing", () => {
  it("publishes the shift with its workers in one request, then confirms", async () => {
    await renderReady();
    await chooseSite("near");
    await workersShown();
    await fireEvent.press(screen.getByTestId("worker-worker-3"));
    await fireEvent.press(screen.getByTestId("worker-worker-1"));
    expect(screen.getByText("العمال المختارون: 2")).toBeOnTheScreen();
    await fireEvent.press(publishButton());

    expect(mockClient.createShiftWithWorkers).toHaveBeenCalledTimes(1);
    expect(mockClient.createShiftWithWorkers).toHaveBeenCalledWith({
      siteId: "near",
      title: "ورشة يافا",
      shiftType: "STANDARD",
      scheduledStart: START_ISO,
      scheduledEnd: END_ISO,
      checkInMethod: "GEOFENCED",
      workerProfileIds: ["worker-1", "worker-3"],
    });
    const done = within(await screen.findByTestId("saved-confirmation"));
    expect(done.getByText("تم نشر الوردية")).toBeOnTheScreen();
    expect(done.getByText("ورشة يافا")).toBeOnTheScreen();
    expect(done.getByText("15 أكتوبر 2026، من 11:00 إلى 19:00")).toBeOnTheScreen();
    expect(done.getByText("العمال المعيّنون: 2")).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(done.getByRole("button", { name: "رجوع" }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it("sends the chosen type, title and check-in method of a night shift", async () => {
    await renderReady();
    await chooseSite("far");
    await workersShown();
    await fireEvent.changeText(screen.getByTestId("shift-title"), "  مناوبة المستودع  ");
    await fireEvent.press(screen.getByTestId("shift-type-NIGHT_TURAN"));
    await fireEvent.press(screen.getByTestId("check-in-method-FLEXI_CHECK"));
    await pick("shift-start", "2026-10-15T19:00:00.000Z");
    await pick("shift-end", "2026-10-15T03:00:00.000Z");
    await waitFor(() => expect(mockClient.listAssignableWorkers).toHaveBeenLastCalledWith("2026-10-15T19:00:00.000Z", "2026-10-16T03:00:00.000Z"));
    await workersShown();
    await fireEvent.press(publishButton());

    expect(mockClient.createShiftWithWorkers).toHaveBeenCalledWith({
      siteId: "far",
      title: "مناوبة المستودع",
      shiftType: "NIGHT_TURAN",
      scheduledStart: "2026-10-15T19:00:00.000Z",
      scheduledEnd: "2026-10-16T03:00:00.000Z",
      checkInMethod: "FLEXI_CHECK",
      workerProfileIds: [],
    });
    expect(within(await screen.findByTestId("saved-confirmation")).getByText("15 أكتوبر 2026، من 22:00 إلى 06:00 في اليوم التالي")).toBeOnTheScreen();
  });

  it("requires a site and a title: nothing is sent", async () => {
    await renderReady();
    await fireEvent.press(publishButton());
    expect(screen.getByText("اختر موقع الوردية.")).toBeOnTheScreen();
    expect(screen.getByText("عنوان الوردية مطلوب.")).toBeOnTheScreen();
    expect(screen.getByText("أكمل الحقول المطلوبة ثم حاول مرة أخرى.")).toBeOnTheScreen();

    await chooseSite("near");
    await workersShown();
    await fireEvent.changeText(screen.getByTestId("shift-title"), "   ");
    await fireEvent.press(publishButton());
    expect(screen.queryByText("اختر موقع الوردية.")).not.toBeOnTheScreen();
    expect(screen.getByText("عنوان الوردية مطلوب.")).toBeOnTheScreen();
    expect(mockClient.createShiftWithWorkers).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("on 409 SHIFT_ASSIGNMENT_CONFLICT marks the refused workers with their shifts and creates nothing", async () => {
    mockClient.createShiftWithWorkers.mockRejectedValueOnce(CONFLICT_409());
    await renderReady();
    await chooseSite("near");
    await workersShown();
    await fireEvent.press(screen.getByTestId("worker-worker-1"));
    await fireEvent.press(screen.getByTestId("worker-worker-3"));
    await fireEvent.press(publishButton());

    expect(
      screen.getByText("لم تُنشر الوردية: لدى بعض العمال المختارين ورديات متداخلة (مميّزون في القائمة). أزلهم أو غيّر الوقت، ثم حاول مرة أخرى."),
    ).toBeOnTheScreen();
    const refused = within(screen.getByTestId("worker-worker-1"));
    expect(refused.getByText("رفض الخادم تعيينه")).toBeOnTheScreen();
    expect(refused.getByText(`${auto("حراسة ليلية")}: 15 أكتوبر 2026، من 10:00 إلى 13:00`)).toBeOnTheScreen();
    expect(within(screen.getByTestId("worker-worker-3")).queryByText("رفض الخادم تعيينه")).not.toBeOnTheScreen();
    expect(screen.getByText(/تنبيه: عدد العمال المختارين الذين لديهم ورديات متداخلة في هذا الوقت: 1\./)).toBeOnTheScreen();
    expect(screen.queryByTestId("saved-confirmation")).not.toBeOnTheScreen();
    expectArabicOnly();

    // Without the refused worker it goes through.
    await fireEvent.press(screen.getByTestId("worker-worker-1"));
    await fireEvent.press(publishButton());
    expect(mockClient.createShiftWithWorkers).toHaveBeenCalledTimes(2);
    expect(mockClient.createShiftWithWorkers.mock.calls[1][0].workerProfileIds).toEqual(["worker-3"]);
    expect(await screen.findByTestId("saved-confirmation")).toBeOnTheScreen();
  });

  it("forgets the server's refusal once the times change", async () => {
    mockClient.createShiftWithWorkers.mockRejectedValueOnce(CONFLICT_409());
    await renderReady();
    await chooseSite("near");
    await workersShown();
    await fireEvent.press(screen.getByTestId("worker-worker-1"));
    await fireEvent.press(publishButton());
    expect(within(screen.getByTestId("worker-worker-1")).getByText("رفض الخادم تعيينه")).toBeOnTheScreen();

    await pick("shift-start", "2026-10-15T09:00:00.000Z");
    await waitFor(() => expect(mockClient.listAssignableWorkers).toHaveBeenCalledTimes(2));
    await workersShown();
    expect(within(screen.getByTestId("worker-worker-1")).queryByText("رفض الخادم تعيينه")).not.toBeOnTheScreen();
    expect(screen.queryByText(/لم تُنشر الوردية/)).not.toBeOnTheScreen();
    // The selection stays (the worker is still offered).
    expect(screen.getByTestId("worker-worker-1").props.accessibilityState).toMatchObject({ checked: true });
  });

  it("disables the button while publishing (a double tap sends once) and shows other errors in Arabic", async () => {
    const created = deferred<Shift>();
    mockClient.createShiftWithWorkers.mockReturnValue(created.promise);
    await renderReady();
    await chooseSite("near");
    await workersShown();

    await doubleTap(publishButton());
    expect(mockClient.createShiftWithWorkers).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "جارٍ النشر…" })).toBeDisabled();

    await act(async () => created.reject(new ApiRequestError(403, { statusCode: 403, code: "SCOPE_RESTRICTED", message: "Not your project", correlationId: "c" })));
    expect(screen.getByText(ar.errors.SCOPE_RESTRICTED)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "نشر الوردية" })).toBeEnabled();
    expectArabicOnly();
  });

  it("goes back by itself after the confirmation", async () => {
    confirmationTiming.ms = 5;
    await renderReady();
    await chooseSite("near");
    await workersShown();
    await fireEvent.press(publishButton());
    await screen.findByTestId("saved-confirmation");
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it("without MANAGE_SHIFTS shows that access is denied and asks nothing", async () => {
    mockPermissions = new Set([Permission.VIEW_SHIFTS]);
    await renderNewShift();
    expect(screen.getByText(ar.states.accessDeniedTitle)).toBeOnTheScreen();
    expect(screen.queryByTestId("publish-shift")).not.toBeOnTheScreen();
    expect(mockClient.listSites).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expectArabicOnly();
  });
});

// ── Helpers behind the screens ──────────────────────────────────────────────

describe("business time (Asia/Jerusalem, whatever the phone's zone)", () => {
  it("turns a business day and time into the instant, summer and winter", () => {
    expect(businessInstant("2026-10-15", "11:00").toISOString()).toBe("2026-10-15T08:00:00.000Z");
    expect(businessInstant("2026-01-15", "10:30").toISOString()).toBe("2026-01-15T08:30:00.000Z");
    expect(businessInstant("2026-10-15", "00:00").toISOString()).toBe("2026-10-14T21:00:00.000Z");
  });

  it("ends a night shift on the next day, across the end of summer time too", () => {
    expect(shiftWindow("2026-10-15", "22:00", "06:00")).toEqual({
      start: new Date("2026-10-15T19:00:00.000Z"),
      end: new Date("2026-10-16T03:00:00.000Z"),
      endDay: "2026-10-16",
      overnight: true,
    });
    // Summer time ends on 25 October 2026 at 02:00: the night is nine hours long.
    const night = shiftWindow("2026-10-24", "22:00", "06:00");
    expect(night?.start.toISOString()).toBe("2026-10-24T19:00:00.000Z");
    expect(night?.end.toISOString()).toBe("2026-10-25T04:00:00.000Z");
    expect(shiftWindow("2026-10-15", "08:00", "08:00")).toBeNull();
    expect(shiftWindow("2026-02-30", "08:00", "16:00")).toBeNull();
    expect(shiftWindow("2026-10-15", "24:00", "16:00")).toBeNull();
  });

  it("starts a new shift at the next full hour, tomorrow after 23:00", () => {
    expect(defaultShiftTimes(new Date("2026-10-15T07:20:00.000Z"))).toEqual({ day: "2026-10-15", start: "11:00", end: "19:00" });
    expect(defaultShiftTimes(new Date("2026-10-15T20:30:00.000Z"))).toEqual({ day: "2026-10-16", start: "00:00", end: "08:00" });
    expect(defaultShiftTimes(new Date("2026-10-15T14:05:00.000Z"))).toEqual({ day: "2026-10-15", start: "18:00", end: "02:00" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("sites nearest first", () => {
  it("sorts by great-circle distance, keeping the API's order without a position", () => {
    expect(nearestFirst(SITES, HERE).map(({ item }) => item.id)).toEqual(["nearest", "near", "far"]);
    expect(nearestFirst(SITES, null).map(({ item, meters }) => [item.id, meters])).toEqual([
      ["far", null],
      ["near", null],
      ["nearest", null],
    ]);
  });
});

describe("the 409's refused workers", () => {
  it("reads details.conflicts, and nothing from another error", () => {
    expect(assignmentConflicts(CONFLICT_409())).toEqual(
      new Map([["worker-1", [{ shiftId: "shift-7", title: "حراسة ليلية", scheduledStart: "2026-10-15T07:00:00.000Z", scheduledEnd: "2026-10-15T10:00:00.000Z" }]]]),
    );
    expect(assignmentConflicts(new ApiRequestError(409, { statusCode: 409, code: "SHIFT_ASSIGNMENT_CONFLICT", message: "x", correlationId: "c" }))).toEqual(new Map());
    expect(assignmentConflicts(new ApiRequestError(409, { statusCode: 409, code: "CONFLICT", message: "x", correlationId: "c" }))).toBeNull();
    expect(assignmentConflicts(new Error("boom"))).toBeNull();
  });
});

describe("a budget typed in shekels", () => {
  it("becomes integer agorot, never a guess", () => {
    expect(parseShekels("12500")).toEqual({ kind: "ok", agorot: 1250000 });
    expect(parseShekels("12,500.50")).toEqual({ kind: "ok", agorot: 1250050 });
    expect(parseShekels("0.29")).toEqual({ kind: "ok", agorot: 29 });
    expect(parseShekels("12500,5")).toEqual({ kind: "ok", agorot: 1250050 });
    expect(parseShekels("١٢٥٠٠٫٥")).toEqual({ kind: "ok", agorot: 1250050 });
    expect(parseShekels(" ₪ 300 ")).toEqual({ kind: "ok", agorot: 30000 });
    expect(parseShekels("")).toEqual({ kind: "empty" });
    expect(parseShekels("12.505")).toEqual({ kind: "invalid" });
    expect(parseShekels("1,25,000")).toEqual({ kind: "invalid" });
    expect(parseShekels("-5")).toEqual({ kind: "invalid" });
    expect(parseShekels("21474836.48")).toEqual({ kind: "invalid" });
    expect(parseShekels("21474836.47")).toEqual({ kind: "ok", agorot: 2147483647 });
  });
});
