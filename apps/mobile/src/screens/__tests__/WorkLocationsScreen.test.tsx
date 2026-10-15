import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { ApiRequestError, NetworkError, type Project, type Site } from "@fieldmaster/api-client";
import { Permission } from "@fieldmaster/shared-types";
import ar from "../../i18n/messages";
import type { RootStackParamList } from "../../navigation/types";
import { WorkLocationsScreen } from "../WorkLocationsScreen";
import { deferred, expectArabicOnly, renderInArabic } from "./clock-screens-test-utils";

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockClient = { listSites: jest.fn(), listProjects: jest.fn() };
jest.mock("../../lib/auth-context", () => ({ useAuth: () => ({ client: mockClient, session: { role: "FIELD_MANAGER", workerProfileId: null } }) }));

let mockPermissions = new Set<string>([Permission.MANAGE_SITES]);
jest.mock("../../lib/access-context", () => ({
  useAccess: () => ({ can: (permission: string) => mockPermissions.has(permission), restricted: false }),
}));

const mockSync = { isOnline: true, pendingCount: 0, queue: [] };
jest.mock("../../lib/offline-sync-context", () => ({ useOfflineSync: () => mockSync }));

// Outside a navigator "focus" is the first render; refocus() replays the screen's focus callback (back from the editor).
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

type Navigation = NativeStackScreenProps<RootStackParamList, "WorkLocations">["navigation"];
let navigation: { navigate: jest.Mock; goBack: jest.Mock };

// ── Data ────────────────────────────────────────────────────────────────────

const FSI = "⁨";
const PDI = "⁩";
const auto = (value: string) => `${FSI}${value}${PDI}`;

const PROJECTS: Project[] = [
  { id: "project-1", name: "مشروع الكرمل", client: "بلدية حيفا", projectCode: "P-1", status: "ACTIVE" },
  { id: "project-2", name: "مشروع النقب", client: null, projectCode: "P-2", status: "ACTIVE" },
];

type SiteRow = Site & { address?: string | null };
const SITES: SiteRow[] = [
  { id: "site-1", projectId: "project-1", name: "مستودع الميناء", latitude: 32.82, longitude: 35.0, defaultGeofenceRadiusMeters: 100, address: "شارع الميناء 4، حيفا" },
  { id: "site-2", projectId: "project-2", name: "محطة بئر السبع", latitude: 31.25, longitude: 34.79, defaultGeofenceRadiusMeters: 150, address: null },
];

function renderScreen() {
  return renderInArabic(<WorkLocationsScreen navigation={navigation as unknown as Navigation} route={{ key: "WorkLocations-1", name: "WorkLocations", params: undefined }} />);
}

async function refocus() {
  await act(async () => {
    mockFocusEffect?.();
  });
}

async function pullToRefresh() {
  const list = screen.getByTestId("work-locations-list");
  await act(async () => {
    (list.props.refreshControl as { props: { onRefresh: () => void } }).props.onRefresh();
  });
}

const card = (siteId: string) => within(screen.getByTestId(`work-location-${siteId}`));

beforeEach(() => {
  for (const fn of Object.values(mockClient)) fn.mockReset();
  mockPermissions = new Set([Permission.MANAGE_SITES]);
  navigation = { navigate: jest.fn(), goBack: jest.fn() };
  mockClient.listSites.mockResolvedValue(SITES);
  mockClient.listProjects.mockResolvedValue(PROJECTS);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("WorkLocationsScreen (Arabic, RTL)", () => {
  it("shows the loading state, then every work location with its project and address", async () => {
    const sites = deferred<SiteRow[]>();
    mockClient.listSites.mockReturnValue(sites.promise);
    await renderScreen();
    expect(screen.getByRole("header", { name: "مواقع العمل" })).toBeOnTheScreen();
    expect(screen.getByLabelText(ar.states.loading)).toBeOnTheScreen();
    await act(async () => sites.resolve(SITES));

    expect(card("site-1").getByText("مستودع الميناء")).toBeOnTheScreen();
    expect(card("site-1").getByText(`المشروع: ${auto("مشروع الكرمل")}`)).toBeOnTheScreen();
    expect(card("site-1").getByText(`العنوان: ${auto("شارع الميناء 4، حيفا")}`)).toBeOnTheScreen();
    expect(card("site-2").getByText("محطة بئر السبع")).toBeOnTheScreen();
    expect(card("site-2").getByText(`المشروع: ${auto("مشروع النقب")}`)).toBeOnTheScreen();
    expect(card("site-2").getByText("لا يوجد عنوان")).toBeOnTheScreen();
    expect(mockClient.listSites).toHaveBeenCalledWith();
    expect(mockClient.listProjects).toHaveBeenCalledWith();
    expectArabicOnly();
  });

  it("opens the editor for a new location, and for a location the manager taps", async () => {
    await renderScreen();
    await screen.findByText("مستودع الميناء");

    await fireEvent.press(screen.getByRole("button", { name: "موقع عمل جديد" }));
    expect(navigation.navigate).toHaveBeenCalledWith("WorkLocationEditor");

    await fireEvent.press(screen.getByTestId("work-location-site-2"));
    expect(navigation.navigate).toHaveBeenLastCalledWith("WorkLocationEditor", { siteId: "site-2" });
    expect(screen.getByTestId("work-location-site-2").props.accessibilityHint).toBe("يفتح موقع العمل للتعديل");
  });

  it("reloads when the screen comes back into view (a location was just added) and on pull-to-refresh", async () => {
    await renderScreen();
    await screen.findByText("مستودع الميناء");
    expect(mockClient.listSites).toHaveBeenCalledTimes(1);

    const added: SiteRow = { ...SITES[1], id: "site-3", name: "ورشة الناصرة", address: "حي الصفافرة" };
    mockClient.listSites.mockResolvedValue([...SITES, added]);
    await refocus();
    expect(await screen.findByText("ورشة الناصرة")).toBeOnTheScreen();
    expect(mockClient.listSites).toHaveBeenCalledTimes(2);

    mockClient.listSites.mockResolvedValue([SITES[0]]);
    await pullToRefresh();
    expect(screen.queryByText("ورشة الناصرة")).not.toBeOnTheScreen();
    expect(screen.getByText("مستودع الميناء")).toBeOnTheScreen();
    expect(mockClient.listSites).toHaveBeenCalledTimes(3);
    expect((screen.getByTestId("work-locations-list").props.refreshControl as { props: { refreshing: boolean } }).props.refreshing).toBe(false);
  });

  it("shows an empty state that points to «موقع عمل جديد»", async () => {
    mockClient.listSites.mockResolvedValue([]);
    await renderScreen();
    expect(await screen.findByText("لا توجد مواقع عمل بعد.")).toBeOnTheScreen();
    expect(screen.getByText("أضف أول موقع عمل من زر «موقع عمل جديد».")).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("shows a load failure in Arabic with a retry", async () => {
    mockClient.listSites.mockRejectedValueOnce(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText(`تعذّر تحميل مواقع العمل.\n${ar.errors.network}`)).toBeOnTheScreen();
    expectArabicOnly();

    await fireEvent.press(screen.getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByText("مستودع الميناء")).toBeOnTheScreen();
    expect(screen.queryByText(`تعذّر تحميل مواقع العمل.\n${ar.errors.network}`)).not.toBeOnTheScreen();
  });

  it("explains a refusal with the API's code in Arabic (never its English text)", async () => {
    mockClient.listSites.mockRejectedValue(new ApiRequestError(403, { statusCode: 403, code: "FORBIDDEN", message: "Forbidden resource", correlationId: "c" }));
    await renderScreen();
    expect(await screen.findByText(`تعذّر تحميل مواقع العمل.\n${ar.errors.FORBIDDEN}`)).toBeOnTheScreen();
    expectArabicOnly();
  });

  it("still lists the sites when the project names cannot be read", async () => {
    mockClient.listProjects.mockRejectedValue(new NetworkError(new TypeError("Network request failed")));
    await renderScreen();
    expect(await screen.findByText("مستودع الميناء")).toBeOnTheScreen();
    expect(card("site-1").queryByText(/المشروع/)).not.toBeOnTheScreen();
    expect(card("site-1").getByText(`العنوان: ${auto("شارع الميناء 4، حيفا")}`)).toBeOnTheScreen();
  });

  it("without MANAGE_SITES shows that access is denied and asks the API nothing", async () => {
    mockPermissions = new Set([Permission.MANAGE_SHIFTS, Permission.VIEW_SHIFTS]);
    await renderScreen();
    expect(screen.getByText(ar.states.accessDeniedTitle)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "موقع عمل جديد" })).not.toBeOnTheScreen();
    expect(mockClient.listSites).not.toHaveBeenCalled();
    expect(mockClient.listProjects).not.toHaveBeenCalled();
    expectArabicOnly();
  });
});
