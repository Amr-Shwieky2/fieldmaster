import * as Location from "expo-location";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { ApiRequestError, type CreateWorkLocationInput, type Project, type WorkLocation, type WorkLocationDefaults } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import { confirmationTiming } from "../../components/locations/SavedConfirmation";
import { FALLBACK_REGION } from "../../components/locations/position";
import { resetLocationHistory } from "../../lib/location";
import type { RootStackParamList } from "../../navigation/types";
import { WorkLocationEditorScreen } from "../WorkLocationEditorScreen";
import { deferred, doubleTap, expectArabicOnly, renderedStrings, renderInArabic } from "./clock-screens-test-utils";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = {
  getWorkLocationDefaults: jest.fn(),
  listProjects: jest.fn(),
  getWorkLocation: jest.fn(),
  createWorkLocation: jest.fn(),
  updateWorkLocation: jest.fn(),
};
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } }) }));

const mockAccess = { permissions: new Set<string>(), restricted: false };
jest.mock("../../lib/access-context", () => ({
  useAccess: () => ({ can: (permission: string) => mockAccess.permissions.has(permission), restricted: mockAccess.restricted }),
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

/** The react-native-maps fake (jest/react-native-maps-mock.ts): it records `animateToRegion`. */
const { mapsMock } = jest.requireMock<{ mapsMock: { animatedTo: unknown[]; reset: () => void } }>("react-native-maps");

type Navigation = NativeStackScreenProps<RootStackParamList, "WorkLocationEditor">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

// ── Data ────────────────────────────────────────────────────────────────────

const DEFAULTS: WorkLocationDefaults = { defaultGeofenceRadiusMeters: 150, minRadiusMeters: 50, maxRadiusMeters: 1000 };
const HERE = { latitude: 32.0853, longitude: 34.7818 };

const PROJECTS: Project[] = [
  { id: "project-1", name: "مشروع الكرمل", client: "بلدية حيفا", projectCode: "P-1", status: "ACTIVE" },
  { id: "project-2", name: "مشروع يافا", client: null, projectCode: "P-2", status: "ACTIVE" },
];

const EXISTING: WorkLocation = {
  id: "site-1",
  projectId: "project-1",
  projectName: "مشروع الكرمل",
  name: "مستودع الميناء",
  address: "شارع الميناء 4، حيفا",
  latitude: 32.82,
  longitude: 35.0,
  instructions: "الدخول من البوابة الشرقية",
  emergencyContact: "أبو سليم 0501234567",
  geofence: { id: "geofence-1", centerLatitude: 32.8201, centerLongitude: 35.0002, radiusMeters: 120, version: 2 },
};

const GRANTED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.GRANTED, granted: true, canAskAgain: true, expires: "never" };
const DENIED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: true, expires: "never" };
const BLOCKED: Location.LocationPermissionResponse = { status: Location.PermissionStatus.DENIED, granted: false, canAskAgain: false, expires: "never" };

function positionAt(point: { latitude: number; longitude: number }): Location.LocationObject {
  return {
    coords: { ...point, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: Date.now(),
    mocked: false,
  };
}

const LTR = (value: string) => `⁦${value}⁩`;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function renderEditor(params?: { siteId?: string }) {
  await renderInArabic(
    <WorkLocationEditorScreen navigation={navigation as unknown as Navigation} route={{ key: "WorkLocationEditor-1", name: "WorkLocationEditor", params }} />,
  );
  // Ready once the form and the map are shown.
  await screen.findByTestId("work-location-save");
  await screen.findByTestId("map");
}

const marker = () => screen.getByTestId("map-marker");
const circle = () => screen.getByTestId("map-circle");
const saveButton = () => screen.getByTestId("work-location-save");

async function typeInto(testID: string, text: string) {
  await fireEvent.changeText(screen.getByTestId(testID), text);
}

async function dragPinTo(coordinate: { latitude: number; longitude: number }) {
  await fireEvent(marker(), "dragStart", { nativeEvent: { coordinate: marker().props.coordinate } });
  await fireEvent(marker(), "dragEnd", { nativeEvent: { coordinate } });
}

async function tapMapAt(coordinate: { latitude: number; longitude: number }) {
  await fireEvent(screen.getByTestId("map"), "press", { nativeEvent: { coordinate } });
}

async function slideRadiusTo(meters: number) {
  await fireEvent(screen.getByTestId("radius-slider"), "valueChange", meters);
}

beforeEach(() => {
  for (const fn of Object.values(mockClient)) fn.mockReset();
  mockAccess.permissions = new Set([Permission.MANAGE_SITES]);
  mockAccess.restricted = false;
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  confirmationTiming.ms = 60_000;
  mapsMock.reset();
  resetLocationHistory();
  mockClient.getWorkLocationDefaults.mockResolvedValue(DEFAULTS);
  mockClient.listProjects.mockResolvedValue(PROJECTS);
  mockClient.getWorkLocation.mockResolvedValue(EXISTING);
  mockClient.createWorkLocation.mockImplementation(async (input: CreateWorkLocationInput) => ({ ...EXISTING, id: "site-new", name: input.name }));
  mockClient.updateWorkLocation.mockResolvedValue(EXISTING);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(GRANTED);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(positionAt(HERE));
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest.mocked(Linking.openSettings).mockResolvedValue(undefined);
});

// ── A new work location ─────────────────────────────────────────────────────

describe("WorkLocationEditorScreen: a new work location", () => {
  it("starts on the phone's position with the default radius between the organization's bounds", async () => {
    await renderEditor();

    expect(screen.getByRole("header", { name: "موقع عمل جديد" })).toBeOnTheScreen();
    expect(screen.getByTestId("map").props.initialRegion).toMatchObject(HERE);
    expect(marker().props.coordinate).toEqual(HERE);
    expect(marker().props.draggable).toBe(true);
    expect(circle().props.center).toEqual(HERE);
    expect(circle().props.radius).toBe(150);
    expect(screen.getByTestId("radius-value")).toHaveTextContent("150 م");
    expect(screen.getByText("من 50 إلى 1000 م")).toBeOnTheScreen();
    const slider = screen.getByTestId("radius-slider");
    expect(slider.props.minimumValue).toBe(50);
    expect(slider.props.maximumValue).toBe(1000);
    expect(slider.props.value).toBe(150);
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockClient.getWorkLocationDefaults).toHaveBeenCalledWith();
    expect(mockClient.listProjects).toHaveBeenCalledWith();
    expect(mockClient.getWorkLocation).not.toHaveBeenCalled();
    expectArabicOnly();
  });

  it("creates the location in one request: the dragged pin, the slider's radius, the chosen project", async () => {
    await renderEditor();
    const dragged = { latitude: 32.0861, longitude: 34.7832 };
    await dragPinTo(dragged);
    expect(marker().props.coordinate).toEqual(dragged);
    expect(circle().props.center).toEqual(dragged);

    await slideRadiusTo(260);
    expect(screen.getByTestId("radius-value")).toHaveTextContent("260 م");
    expect(circle().props.radius).toBe(260);
    // The buttons move it by one step (10 m over this range).
    await fireEvent.press(screen.getByRole("button", { name: "توسيع نطاق الموقع" }));
    expect(screen.getByTestId("radius-value")).toHaveTextContent("270 م");
    await fireEvent.press(screen.getByRole("button", { name: "تصغير نطاق الموقع" }));
    expect(circle().props.radius).toBe(260);

    await typeInto("work-location-name", "  ورشة يافا  ");
    await typeInto("work-location-address", "شارع يافا 12");
    await typeInto("work-location-instructions", "الدخول من البوابة الخلفية");
    await typeInto("work-location-emergency-contact", "أبو خليل 0521234567");
    await fireEvent.press(screen.getByTestId("project-project-2"));
    await fireEvent.press(saveButton());

    expect(mockClient.createWorkLocation).toHaveBeenCalledTimes(1);
    expect(mockClient.createWorkLocation).toHaveBeenCalledWith({
      projectId: "project-2",
      name: "ورشة يافا",
      address: "شارع يافا 12",
      latitude: dragged.latitude,
      longitude: dragged.longitude,
      geofenceRadiusMeters: 260,
      instructions: "الدخول من البوابة الخلفية",
      emergencyContact: "أبو خليل 0521234567",
    });
    expect(mockClient.updateWorkLocation).not.toHaveBeenCalled();

    const done = within(await screen.findByTestId("saved-confirmation"));
    expect(done.getByText("تم إنشاء موقع العمل")).toBeOnTheScreen();
    expect(done.getByText("ورشة يافا")).toBeOnTheScreen();
    expect(done.getByText("نطاق الموقع: 260 م")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("moves the pin with a tap on the map and back to the phone with «استخدم موقعي الحالي»", async () => {
    await renderEditor();
    const tapped = { latitude: 32.09, longitude: 34.79 };
    await tapMapAt(tapped);
    expect(marker().props.coordinate).toEqual(tapped);

    const moved = { latitude: 32.0712, longitude: 34.7699 };
    jest.mocked(Location.getCurrentPositionAsync).mockResolvedValue(positionAt(moved));
    await fireEvent.press(screen.getByRole("button", { name: "استخدم موقعي الحالي" }));
    await waitFor(() => expect(marker().props.coordinate).toEqual(moved));
    expect(mapsMock.animatedTo.at(-1)).toMatchObject(moved);

    await typeInto("work-location-name", "ساحة الميناء");
    await fireEvent.press(screen.getByTestId("project-project-1"));
    await fireEvent.press(saveButton());
    expect(mockClient.createWorkLocation).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "ساحة الميناء",
      latitude: moved.latitude,
      longitude: moved.longitude,
      geofenceRadiusMeters: 150,
    });
  });

  it("requires the name and a project: nothing is sent until both are given", async () => {
    await renderEditor();
    await fireEvent.press(saveButton());

    expect(screen.getByText("اسم الموقع مطلوب.")).toBeOnTheScreen();
    expect(screen.getByText("اختر مشروعًا لموقع العمل.")).toBeOnTheScreen();
    expect(screen.getByText("أكمل الحقول المطلوبة المميّزة بالأحمر ثم حاول مرة أخرى.")).toBeOnTheScreen();
    expect(mockClient.createWorkLocation).not.toHaveBeenCalled();
    expectArabicOnly();

    // Blank is not a name.
    await typeInto("work-location-name", "   ");
    await fireEvent.press(screen.getByTestId("project-project-1"));
    await fireEvent.press(saveButton());
    expect(screen.getByText("اسم الموقع مطلوب.")).toBeOnTheScreen();
    expect(screen.queryByText("اختر مشروعًا لموقع العمل.")).not.toBeOnTheScreen();
    expect(mockClient.createWorkLocation).not.toHaveBeenCalled();

    await typeInto("work-location-name", "مخزن العدّة");
    expect(screen.queryByText("اسم الموقع مطلوب.")).not.toBeOnTheScreen();
    await fireEvent.press(saveButton());
    expect(mockClient.createWorkLocation).toHaveBeenCalledTimes(1);
    expect(mockClient.createWorkLocation.mock.calls[0][0]).toMatchObject({ projectId: "project-1", name: "مخزن العدّة" });
  });

  it("picks the only project the member has without a tap", async () => {
    mockClient.listProjects.mockResolvedValue([PROJECTS[0]]);
    await renderEditor();
    expect(screen.getByTestId("project-project-1").props.accessibilityState).toMatchObject({ checked: true });
    await typeInto("work-location-name", "مخزن العدّة");
    await fireEvent.press(saveButton());
    expect(mockClient.createWorkLocation.mock.calls[0][0]).toMatchObject({ projectId: "project-1" });
  });

  it("with the location permission refused, says so and lets the manager place the pin by hand", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(DENIED);
    await renderEditor();

    expect(screen.getByText(ar.workLocation.permissionDenied)).toBeOnTheScreen();
    expect(screen.getByTestId("map").props.initialRegion).toEqual(FALLBACK_REGION);
    expect(screen.queryByTestId("map-marker")).not.toBeOnTheScreen();
    expect(screen.getByText("اضغط على الخريطة لوضع الدبوس في مكان موقع العمل.")).toBeOnTheScreen();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
    expectArabicOnly();

    await typeInto("work-location-name", "نقطة الحراسة");
    await fireEvent.press(screen.getByTestId("project-project-1"));
    await fireEvent.press(saveButton());
    expect(screen.getByText("حدّد مكان موقع العمل على الخريطة.")).toBeOnTheScreen();
    expect(mockClient.createWorkLocation).not.toHaveBeenCalled();

    const placed = { latitude: 31.7683, longitude: 35.2137 };
    await tapMapAt(placed);
    expect(marker().props.coordinate).toEqual(placed);
    expect(circle().props.radius).toBe(150);
    await fireEvent.press(saveButton());
    expect(mockClient.createWorkLocation).toHaveBeenCalledWith({
      projectId: "project-1",
      name: "نقطة الحراسة",
      latitude: placed.latitude,
      longitude: placed.longitude,
      geofenceRadiusMeters: 150,
    });
  });

  it("with the permission refused for good, offers the phone's settings", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(BLOCKED);
    await renderEditor();
    expect(screen.getByText(ar.workLocation.permissionSettings)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "فتح الإعدادات" }));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it("says when the phone's location services are off", async () => {
    jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(DENIED);
    jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false);
    await renderEditor();
    expect(screen.getByText(ar.workLocation.servicesOff)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("disables the button while saving (a double tap sends once) and shows API errors in Arabic", async () => {
    const created = deferred<WorkLocation>();
    mockClient.createWorkLocation.mockReturnValue(created.promise);
    await renderEditor();
    await typeInto("work-location-name", "ورشة يافا");
    await fireEvent.press(screen.getByTestId("project-project-2"));

    await doubleTap(saveButton());
    expect(mockClient.createWorkLocation).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole("button", { name: "جارٍ الحفظ…" });
    expect(busy).toBeDisabled();
    expect(busy).toBeBusy();

    await act(async () =>
      created.reject(new ApiRequestError(403, { statusCode: 403, code: "SCOPE_RESTRICTED", message: "Restricted to some projects", correlationId: "c" })),
    );
    expect(screen.getByText(ar.errors.SCOPE_RESTRICTED)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "إنشاء موقع العمل" })).toBeEnabled();
    expect(screen.queryByTestId("saved-confirmation")).not.toBeOnTheScreen();
    expectArabicOnly();

    mockClient.createWorkLocation.mockRejectedValue(
      new ApiRequestError(400, { statusCode: 400, code: "VALIDATION_FAILED", message: "geofenceRadiusMeters must not be greater than 1000", correlationId: "c" }),
    );
    await fireEvent.press(saveButton());
    expect(await screen.findByText(ar.errors.VALIDATION_FAILED)).toBeOnTheScreen();
    expect(screen.queryByText(ar.errors.SCOPE_RESTRICTED)).not.toBeOnTheScreen();
    expectArabicOnly();
  });

  it("goes back by itself after the confirmation, once", async () => {
    confirmationTiming.ms = 5;
    await renderEditor();
    await typeInto("work-location-name", "ورشة يافا");
    await fireEvent.press(screen.getByTestId("project-project-2"));
    await fireEvent.press(saveButton());
    await screen.findByTestId("saved-confirmation");
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it("goes back at once with «رجوع» on the confirmation, and not a second time", async () => {
    confirmationTiming.ms = 30;
    await renderEditor();
    await typeInto("work-location-name", "ورشة يافا");
    await fireEvent.press(screen.getByTestId("project-project-2"));
    await fireEvent.press(saveButton());
    await fireEvent.press(within(await screen.findByTestId("saved-confirmation")).getByRole("button", { name: "رجوع" }));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });
});

// ── A new project ───────────────────────────────────────────────────────────

describe("WorkLocationEditorScreen: a new project with the location", () => {
  it("quick-creates the project with its budget in agorot for a member who may see money", async () => {
    mockAccess.permissions = new Set([Permission.MANAGE_SITES, Permission.VIEW_FINANCIALS]);
    await renderEditor();
    await fireEvent.press(screen.getByTestId("project-mode-new"));
    expect(screen.queryByTestId("project-project-1")).not.toBeOnTheScreen();

    await typeInto("new-project-name", "ترميم مدرسة الحي");
    await typeInto("new-project-client", "وزارة التربية");
    await typeInto("new-project-budget", "12,500.50");
    expect(screen.getByText(`الميزانية: ${LTR("₪ 12,500.50")}`)).toBeOnTheScreen();
    await typeInto("work-location-name", "مدرسة الحي");
    await fireEvent.press(saveButton());

    expect(mockClient.createWorkLocation).toHaveBeenCalledWith({
      newProject: { name: "ترميم مدرسة الحي", client: "وزارة التربية", budgetAgorot: 1250050 },
      name: "مدرسة الحي",
      latitude: HERE.latitude,
      longitude: HERE.longitude,
      geofenceRadiusMeters: 150,
    });
    expect(mockClient.createWorkLocation.mock.calls[0][0]).not.toHaveProperty("projectId");
  });

  it("refuses a budget it cannot read, and sends none when it is left empty", async () => {
    mockAccess.permissions = new Set([Permission.MANAGE_SITES, Permission.VIEW_FINANCIALS]);
    await renderEditor();
    await fireEvent.press(screen.getByTestId("project-mode-new"));
    await typeInto("new-project-name", "ترميم مدرسة الحي");
    await typeInto("work-location-name", "مدرسة الحي");

    await typeInto("new-project-budget", "12.505");
    await fireEvent.press(saveButton());
    expect(screen.getByText("أدخل مبلغًا صحيحًا بالشيكل، مثل 12500 أو 12500.50.")).toBeOnTheScreen();
    expect(mockClient.createWorkLocation).not.toHaveBeenCalled();

    // Arabic-Indic digits and the Arabic decimal sign are read too.
    await typeInto("new-project-budget", "٣٠٠٠٫٥");
    expect(screen.getByText(`الميزانية: ${LTR("₪ 3,000.50")}`)).toBeOnTheScreen();
    await typeInto("new-project-budget", "");
    await fireEvent.press(saveButton());
    expect(mockClient.createWorkLocation.mock.calls[0][0].newProject).toEqual({ name: "ترميم مدرسة الحي" });
  });

  it("without VIEW_FINANCIALS the budget field is absent and no budget is ever sent", async () => {
    mockAccess.permissions = new Set([Permission.MANAGE_SITES]);
    await renderEditor();
    await fireEvent.press(screen.getByTestId("project-mode-new"));

    expect(screen.getByTestId("new-project-name")).toBeOnTheScreen();
    expect(screen.queryByTestId("new-project-budget")).not.toBeOnTheScreen();
    expect(screen.queryByText(/الميزانية/)).not.toBeOnTheScreen();
    expect(renderedStrings().join("\n")).not.toMatch(/₪|الميزانية|الشيكل/);

    await typeInto("new-project-name", "ترميم مدرسة الحي");
    await typeInto("work-location-name", "مدرسة الحي");
    await fireEvent.press(saveButton());
    const sent = mockClient.createWorkLocation.mock.calls[0][0] as CreateWorkLocationInput;
    expect(sent.newProject).toEqual({ name: "ترميم مدرسة الحي" });
    expect(sent.newProject).not.toHaveProperty("budgetAgorot");
    expectArabicOnly();
  });

  it("requires the new project's name", async () => {
    await renderEditor();
    await fireEvent.press(screen.getByTestId("project-mode-new"));
    await typeInto("work-location-name", "مدرسة الحي");
    await fireEvent.press(saveButton());
    expect(screen.getByText("اسم المشروع الجديد مطلوب.")).toBeOnTheScreen();
    expect(mockClient.createWorkLocation).not.toHaveBeenCalled();
  });

  it("opens on a new project when the organization has none yet", async () => {
    mockClient.listProjects.mockResolvedValue([]);
    await renderEditor();
    expect(screen.getByTestId("project-mode-new").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByTestId("new-project-name")).toBeOnTheScreen();
  });

  it("hides the quick-create from a member restricted to some projects: they pick one of theirs", async () => {
    mockAccess.restricted = true;
    mockAccess.permissions = new Set([Permission.MANAGE_SITES, Permission.VIEW_FINANCIALS]);
    await renderEditor();

    expect(screen.queryByTestId("project-mode-new")).not.toBeOnTheScreen();
    expect(screen.queryByText("مشروع جديد")).not.toBeOnTheScreen();
    expect(screen.queryByTestId("new-project-name")).not.toBeOnTheScreen();
    expect(screen.getByText("يمكنك اختيار أحد المشاريع المسندة إليك فقط.")).toBeOnTheScreen();

    await typeInto("work-location-name", "مدرسة الحي");
    await fireEvent.press(screen.getByTestId("project-project-2"));
    await fireEvent.press(saveButton());
    const sent = mockClient.createWorkLocation.mock.calls[0][0] as CreateWorkLocationInput;
    expect(sent.projectId).toBe("project-2");
    expect(sent).not.toHaveProperty("newProject");
    expectArabicOnly();
  });

  it("tells a restricted member without any project that there is nothing to pick", async () => {
    mockAccess.restricted = true;
    mockClient.listProjects.mockResolvedValue([]);
    await renderEditor();
    expect(screen.getByText("لا توجد مشاريع متاحة لك بعد.")).toBeOnTheScreen();
    expect(screen.queryByTestId("new-project-name")).not.toBeOnTheScreen();
    await typeInto("work-location-name", "مدرسة الحي");
    await fireEvent.press(saveButton());
    expect(screen.getByText("اختر مشروعًا لموقع العمل.")).toBeOnTheScreen();
    expect(mockClient.createWorkLocation).not.toHaveBeenCalled();
  });
});

// ── Editing ─────────────────────────────────────────────────────────────────

describe("WorkLocationEditorScreen: editing a work location", () => {
  it("starts on the site with its current geofence and fields, without asking for the phone's position", async () => {
    await renderEditor({ siteId: "site-1" });

    expect(mockClient.getWorkLocation).toHaveBeenCalledWith("site-1");
    expect(mockClient.listProjects).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("header", { name: "تعديل موقع العمل" })).toBeOnTheScreen();
    expect(screen.getByTestId("map").props.initialRegion).toMatchObject({ latitude: 32.8201, longitude: 35.0002 });
    expect(marker().props.coordinate).toEqual({ latitude: 32.8201, longitude: 35.0002 });
    expect(circle().props.radius).toBe(120);
    expect(screen.getByTestId("radius-value")).toHaveTextContent("120 م");
    expect(screen.getByTestId("work-location-name").props.value).toBe("مستودع الميناء");
    expect(screen.getByTestId("work-location-address").props.value).toBe("شارع الميناء 4، حيفا");
    expect(screen.getByTestId("work-location-instructions").props.value).toBe("الدخول من البوابة الشرقية");
    expect(screen.getByTestId("work-location-emergency-contact").props.value).toBe("أبو سليم 0501234567");
    // The project is shown, not chosen again.
    expect(screen.getByText("مشروع الكرمل")).toBeOnTheScreen();
    expect(screen.queryByTestId("project-mode-new")).not.toBeOnTheScreen();
    expect(screen.getByText("تغيير المكان أو النطاق يسري على تسجيلات الحضور القادمة فقط.")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("sends only the fields that changed (a cleared field as null)", async () => {
    await renderEditor({ siteId: "site-1" });
    await typeInto("work-location-name", "مستودع الميناء الجديد");
    await typeInto("work-location-address", "");
    await slideRadiusTo(200);
    await fireEvent.press(screen.getByRole("button", { name: "حفظ التغييرات" }));

    expect(mockClient.updateWorkLocation).toHaveBeenCalledTimes(1);
    expect(mockClient.updateWorkLocation).toHaveBeenCalledWith("site-1", { name: "مستودع الميناء الجديد", address: null, geofenceRadiusMeters: 200 });
    expect(mockClient.createWorkLocation).not.toHaveBeenCalled();
    const done = within(await screen.findByTestId("saved-confirmation"));
    expect(done.getByText("تم حفظ التغييرات")).toBeOnTheScreen();
    expect(done.getByText("مستودع الميناء الجديد")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("sends the new center alone when only the pin moved", async () => {
    await renderEditor({ siteId: "site-1" });
    const moved = { latitude: 32.8212, longitude: 35.0011 };
    await dragPinTo(moved);
    await fireEvent.press(saveButton());
    expect(mockClient.updateWorkLocation).toHaveBeenCalledWith("site-1", { latitude: moved.latitude, longitude: moved.longitude });
  });

  it("sends nothing when nothing changed, and says so", async () => {
    await renderEditor({ siteId: "site-1" });
    await fireEvent.press(saveButton());
    expect(screen.getByText("لم تغيّر شيئًا لحفظه.")).toBeOnTheScreen();
    expect(mockClient.updateWorkLocation).not.toHaveBeenCalled();
  });

  it("gives a site without a geofence one on save (its center and radius)", async () => {
    mockClient.getWorkLocation.mockResolvedValue({ ...EXISTING, geofence: null });
    await renderEditor({ siteId: "site-1" });
    expect(marker().props.coordinate).toEqual({ latitude: 32.82, longitude: 35.0 });
    expect(circle().props.radius).toBe(150);
    expect(screen.getByText("لا يوجد نطاق لهذا الموقع بعد، وسيُنشأ عند الحفظ.")).toBeOnTheScreen();
    await fireEvent.press(saveButton());
    expect(mockClient.updateWorkLocation).toHaveBeenCalledWith("site-1", { latitude: 32.82, longitude: 35.0, geofenceRadiusMeters: 150 });
  });

  it("shows a load failure with a retry", async () => {
    mockClient.getWorkLocation.mockRejectedValueOnce(new ApiRequestError(404, { statusCode: 404, code: "NOT_FOUND", message: "Site not found.", correlationId: "c" }));
    await renderInArabic(
      <WorkLocationEditorScreen navigation={navigation as unknown as Navigation} route={{ key: "WorkLocationEditor-1", name: "WorkLocationEditor", params: { siteId: "site-1" } }} />,
    );
    expect(await screen.findByText(`تعذّر تحميل بيانات موقع العمل.\n${ar.errors.NOT_FOUND}`)).toBeOnTheScreen();
    expectArabicOnly();
    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByTestId("work-location-save")).toBeOnTheScreen();
    expect(mockClient.getWorkLocation).toHaveBeenCalledTimes(2);
  });
});

describe("WorkLocationEditorScreen: permission", () => {
  it("without MANAGE_SITES shows that access is denied, asks the API nothing and does not locate the phone", async () => {
    mockAccess.permissions = new Set([Permission.VIEW_OPERATIONS]);
    await renderInArabic(
      <WorkLocationEditorScreen navigation={navigation as unknown as Navigation} route={{ key: "WorkLocationEditor-1", name: "WorkLocationEditor", params: undefined }} />,
    );
    expect(screen.getByText(ar.states.accessDeniedTitle)).toBeOnTheScreen();
    expect(screen.queryByTestId("work-location-save")).not.toBeOnTheScreen();
    for (const fn of Object.values(mockClient)) expect(fn).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expectArabicOnly();
  });
});
