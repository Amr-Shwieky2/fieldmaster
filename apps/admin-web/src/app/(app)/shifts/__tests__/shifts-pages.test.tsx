import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type Project, type Shift, type Site, type Worker } from "@fieldmaster/api-client";
import { AccountStatus, CheckInMethod, OrgRole, ShiftStatus, ShiftType } from "@fieldmaster/shared-types";
import ar from "@/i18n/messages";
import { renderWithIntl } from "@/test/render-with-intl";
import ShiftsPage from "../page";
import ShiftDetailPage from "../[id]/page";
import NewShiftPage from "../new/page";

const mocks = vi.hoisted(() => ({
  client: {} as Record<string, ReturnType<typeof import("vitest").vi.fn>>,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ client: mocks.client, session: { role: "FIELD_MANAGER" } }),
}));

const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: "sh1" }),
  usePathname: () => "/shifts",
  useSearchParams: () => new URLSearchParams(),
}));

const SITE_WITH_GEOFENCE: Site = {
  id: "s1",
  projectId: "p1",
  name: "North interchange",
  latitude: 32.0853,
  longitude: 34.7818,
  defaultGeofenceRadiusMeters: 100,
  geofences: [{ id: "g1", siteId: "s1", centerLatitude: 32.0853, centerLongitude: 34.7818, radiusMeters: 100, minAccuracyMeters: 50 }],
};
const SITE_WITHOUT_GEOFENCE: Site = { id: "s2", projectId: "p1", name: "Depot", latitude: 32.1, longitude: 34.8, defaultGeofenceRadiusMeters: 100, geofences: [] };
const PROJECTS: Project[] = [{ id: "p1", name: "Ayalon works", client: null, projectCode: "AYL-01", status: "ACTIVE" }];

const SHIFT: Shift = {
  id: "sh1",
  organizationId: "o1",
  projectId: "p1",
  siteId: "s1",
  geofenceId: "g1",
  shiftType: ShiftType.NIGHT_TURAN,
  title: "Night signals",
  scheduledStart: "2026-10-05T17:00:00.000Z",
  scheduledEnd: "2026-10-06T03:00:00.000Z",
  checkInMethod: CheckInMethod.GEOFENCED,
  status: ShiftStatus.PENDING_APPROVAL,
  managerId: "m1",
  businessDate: "2026-10-05",
  assignments: [{ id: "a1", workerProfileId: "w1" }],
  site: SITE_WITH_GEOFENCE,
};

function worker(id: string, name: string, accountStatus: AccountStatus = AccountStatus.ACTIVE): Worker {
  return { id, organizationId: "o1", fullLegalName: name, preferredName: null, phoneNumber: "+972500000000", accountStatus, role: OrgRole.WORKER, createdAt: "2026-01-01T00:00:00.000Z" };
}
const WORKERS: Worker[] = [worker("w1", "Eli Ramzani"), worker("w2", "Omar Haddad"), worker("w3", "Suspended Sami", AccountStatus.SUSPENDED)];

function apiError(status: number, code: string, message = "Server says no") {
  return new ApiRequestError(status, { statusCode: status, code, message, details: {}, correlationId: "c" });
}

function setup() {
  mocks.client = {
    listShifts: vi.fn().mockResolvedValue([SHIFT]),
    getShift: vi.fn().mockResolvedValue(SHIFT),
    listWorkers: vi.fn().mockResolvedValue(WORKERS),
    assignWorkerToShift: vi.fn().mockResolvedValue({}),
    listProjects: vi.fn().mockResolvedValue(PROJECTS),
    listSites: vi.fn().mockResolvedValue([SITE_WITH_GEOFENCE, SITE_WITHOUT_GEOFENCE]),
    createShift: vi.fn().mockResolvedValue({ id: "sh9" }),
  };
  return mocks.client;
}

function render(ui: React.ReactElement) {
  return renderWithIntl(ui, { queryClient: true });
}

/** The page text with the given API/user data removed, i.e. only the UI's own text. */
function uiTextWithout(...data: string[]): string {
  return data.reduce((text, value) => text.split(value).join(""), document.body.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Scheduling (shifts list)", () => {
  it("renders in Arabic with translated enums, Western-digit dates and an accessible table", async () => {
    setup();
    render(<ShiftsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "الجدولة" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "وردية جديدة" }).getAttribute("href")).toBe("/shifts/new");

    const table = await screen.findByRole("table", { name: "الورديات مع النوع والموعد وعدد العمال المكلّفين والحالة" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["العنوان", "النوع", "البداية", "النهاية", "العمال المكلّفون", "الحالة"]);
    expect(headers.every((h) => h.getAttribute("scope") === "col" && h.className.includes("text-start"))).toBe(true);

    expect(within(table).getByRole("link", { name: "Night signals" }).getAttribute("href")).toBe("/shifts/sh1");
    expect(within(table).getByText("مناوبة ليلية")).toBeTruthy();
    expect(within(table).getByText("بانتظار الموافقة")).toBeTruthy();
    expect(within(table).getByText("5 أكتوبر 2026 في 20:00")).toBeTruthy();
    expect(table.textContent).not.toMatch(/NIGHT_TURAN|PENDING_APPROVAL|NIGHT TURAN/);
    expect(table.textContent).not.toMatch(/[٠-٩]/);

    // No English UI text leaks: once the API data (the typed shift title) is removed,
    // no Latin letters are left anywhere on the page.
    expect(uiTextWithout("Night signals")).not.toMatch(/[A-Za-z]/);
  });

  it("shows the translated type instead of the API's English title for emergency call-outs", async () => {
    const client = setup();
    client.listShifts.mockResolvedValue([
      { ...SHIFT, id: "sh2", shiftType: ShiftType.EMERGENCY_CALLOUT, title: "Emergency Call-out" },
      { ...SHIFT, id: "sh3", shiftType: ShiftType.EMERGENCY_CALLOUT, title: "Pole knocked down on Route 4" },
    ]);
    render(<ShiftsPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "استدعاء طوارئ" }).getAttribute("href")).toBe("/shifts/sh2");
    // A title a person typed is kept as written.
    expect(within(table).getByRole("link", { name: "Pole knocked down on Route 4" })).toBeTruthy();
    expect(table.textContent).not.toContain("Emergency Call-out");
  });

  it("shows the empty state", async () => {
    const client = setup();
    client.listShifts.mockResolvedValue([]);
    render(<ShiftsPage />);
    expect(await screen.findByText("لا توجد ورديات بعد")).toBeTruthy();
    expect(screen.getByText("أنشئ أول وردية للبدء.")).toBeTruthy();
  });

  it("shows a translated error (not the API text) and retries", async () => {
    const client = setup();
    client.listShifts.mockRejectedValueOnce(apiError(503, "SERVICE_UNAVAILABLE", "redis down"));
    render(<ShiftsPage />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(ar.errors.SERVICE_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByText("redis down")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: ar.states.retry }));
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(client.listShifts).toHaveBeenCalledTimes(2);
  });

  it("shows access denied on 403", async () => {
    const client = setup();
    client.listShifts.mockRejectedValue(apiError(403, "FORBIDDEN"));
    render(<ShiftsPage />);
    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
  });
});

describe("Shift detail", () => {
  it("renders in Arabic with translated status, type and check-in method", async () => {
    setup();
    render(<ShiftDetailPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Night signals" })).toBeTruthy();
    expect(screen.getByText("بانتظار الموافقة")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "تفاصيل الوردية" })).toBeTruthy();
    expect(screen.getByText("مناوبة ليلية")).toBeTruthy();
    expect(screen.getByText("نطاق الموقع")).toBeTruthy();
    expect(screen.getByText("North interchange")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "العمال المكلّفون (1)" })).toBeTruthy();
    expect(await screen.findByText("Eli Ramzani")).toBeTruthy();
    expect(screen.getByRole("link", { name: "كل الورديات" }).getAttribute("href")).toBe("/shifts");
    await waitFor(() => expect((screen.getByLabelText("تكليف عامل") as HTMLSelectElement).disabled).toBe(false));
    // No English UI text leaks: only API data (title, site and worker names) is in Latin letters.
    expect(uiTextWithout("Night signals", "North interchange", "Eli Ramzani", "Omar Haddad")).not.toMatch(/[A-Za-z]/);
  });

  it("only offers active, unassigned workers", async () => {
    setup();
    render(<ShiftDetailPage />);
    expect(await screen.findByRole("heading", { name: ar.shifts.detail.details })).toBeTruthy();
    const select = screen.getByLabelText(ar.shifts.detail.assign.label) as HTMLSelectElement;
    await waitFor(() => expect(select.disabled).toBe(false));
    // w1 is already assigned and w3 is suspended.
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([ar.shifts.detail.assign.placeholder, "Omar Haddad"]);
  });

  it("assigns a worker and confirms it", async () => {
    const client = setup();
    render(<ShiftDetailPage />);
    const select = (await screen.findByLabelText(ar.shifts.detail.assign.label)) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select, { target: { value: "w2" } });
    fireEvent.click(screen.getByRole("button", { name: ar.shifts.detail.assign.submit }));
    await waitFor(() => expect(client.assignWorkerToShift).toHaveBeenCalledWith("sh1", "w2"));
    expect(await screen.findByText(ar.shifts.detail.assign.success)).toBeTruthy();
    await waitFor(() => expect(client.getShift).toHaveBeenCalledTimes(2));
  });

  it("explains an overlapping assignment (CONFLICT) in Arabic", async () => {
    const client = setup();
    client.assignWorkerToShift.mockRejectedValue(apiError(409, "CONFLICT", "This worker is already assigned to an overlapping shift."));
    render(<ShiftDetailPage />);
    const select = (await screen.findByLabelText("تكليف عامل")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    fireEvent.change(select, { target: { value: "w2" } });
    fireEvent.click(screen.getByRole("button", { name: "تكليف" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("هذا العامل مكلّف بوردية أخرى في الوقت نفسه.");
  });

  it("says when there is nobody left to assign", async () => {
    const client = setup();
    client.listWorkers.mockResolvedValue([worker("w1", "Eli Ramzani")]);
    render(<ShiftDetailPage />);
    expect(await screen.findByText("لا يوجد عمال نشطون آخرون متاحون للتكليف.")).toBeTruthy();
  });

  it("shows a translated not-found error with retry and a way back", async () => {
    const client = setup();
    client.getShift.mockRejectedValueOnce(apiError(404, "NOT_FOUND", "Shift not found."));
    render(<ShiftDetailPage />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("لم نتمكن من العثور على العنصر المطلوب.")).toBeTruthy();
    expect(screen.queryByText("Shift not found.")).toBeNull();
    expect(screen.getByRole("link", { name: "كل الورديات" })).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Night signals" })).toBeTruthy();
  });

  it("shows access denied on 403", async () => {
    const client = setup();
    client.getShift.mockRejectedValue(apiError(403, "FORBIDDEN"));
    render(<ShiftDetailPage />);
    expect(await screen.findByText(ar.states.accessDeniedTitle)).toBeTruthy();
  });
});

describe("New shift", () => {
  it("renders in Arabic with translated options and LTR date inputs", async () => {
    setup();
    render(<NewShiftPage />);
    expect(screen.getByRole("heading", { level: 1, name: "وردية جديدة" })).toBeTruthy();
    const type = screen.getByLabelText("نوع الوردية") as HTMLSelectElement;
    expect(Array.from(type.options).map((o) => o.textContent)).toEqual(["وردية عادية", "مناوبة نهارية", "مناوبة ليلية"]);
    const method = screen.getByLabelText("طريقة تسجيل الحضور") as HTMLSelectElement;
    expect(Array.from(method.options).map((o) => o.textContent)).toEqual(["نطاق الموقع", "تسجيل مرن"]);
    expect(screen.getByLabelText("وقت البداية").getAttribute("dir")).toBe("ltr");
    expect(screen.getByLabelText("وقت النهاية").getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("link", { name: "كل الورديات" }).getAttribute("href")).toBe("/shifts");
    expect(screen.getByRole("button", { name: "إنشاء الوردية" })).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("المشروع") as HTMLSelectElement).options.length).toBe(2));
    // No English UI text leaks: only API data (the project name) is in Latin letters.
    expect(uiTextWithout("Ayalon works")).not.toMatch(/[A-Za-z]/);
  });

  it("cascades project -> site -> geofence and warns about a site without a geofence", async () => {
    const client = setup();
    const { fields, hints } = ar.shifts.form;
    render(<NewShiftPage />);
    await waitFor(() => expect((screen.getByLabelText(fields.project) as HTMLSelectElement).options.length).toBe(2));
    expect(screen.queryByLabelText(fields.site)).toBeNull();

    fireEvent.change(screen.getByLabelText(fields.project), { target: { value: "p1" } });
    await waitFor(() => expect(client.listSites).toHaveBeenCalledWith("p1"));
    const site = screen.getByLabelText(fields.site) as HTMLSelectElement;
    await waitFor(() => expect(site.options.length).toBe(3));

    fireEvent.change(site, { target: { value: "s2" } });
    expect(screen.getByText(hints.noGeofence)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(fields.checkInMethod), { target: { value: CheckInMethod.FLEXI_CHECK } });
    expect(screen.queryByText(hints.noGeofence)).toBeNull();
  });

  it("creates the shift with the selected geofence and opens it", async () => {
    const client = setup();
    const { fields } = ar.shifts.form;
    render(<NewShiftPage />);
    fireEvent.change(screen.getByLabelText(fields.title), { target: { value: "تنظيم حركة المرور صباحًا" } });
    fireEvent.change(screen.getByLabelText(fields.shiftType), { target: { value: ShiftType.DAY_TURAN } });
    await waitFor(() => expect((screen.getByLabelText(fields.project) as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(screen.getByLabelText(fields.project), { target: { value: "p1" } });
    await waitFor(() => expect((screen.getByLabelText(fields.site) as HTMLSelectElement).options.length).toBe(3));
    fireEvent.change(screen.getByLabelText(fields.site), { target: { value: "s1" } });
    fireEvent.change(screen.getByLabelText(fields.start), { target: { value: "2026-10-06T07:00" } });
    fireEvent.change(screen.getByLabelText(fields.end), { target: { value: "2026-10-06T15:00" } });
    fireEvent.click(screen.getByRole("button", { name: ar.shifts.form.submit }));

    await waitFor(() =>
      expect(client.createShift).toHaveBeenCalledWith({
        title: "تنظيم حركة المرور صباحًا",
        shiftType: ShiftType.DAY_TURAN,
        projectId: "p1",
        siteId: "s1",
        geofenceId: "g1",
        checkInMethod: CheckInMethod.GEOFENCED,
        scheduledStart: new Date("2026-10-06T07:00").toISOString(),
        scheduledEnd: new Date("2026-10-06T15:00").toISOString(),
      }),
    );
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/shifts/sh9"));
  });

  it("hints when the end is before the start and shows API errors translated", async () => {
    const client = setup();
    client.createShift.mockRejectedValue(apiError(400, "VALIDATION_FAILED", "scheduledEnd must be after scheduledStart."));
    render(<NewShiftPage />);
    fireEvent.change(screen.getByLabelText("عنوان الوردية"), { target: { value: "صيانة إشارات" } });
    fireEvent.change(screen.getByLabelText("وقت البداية"), { target: { value: "2026-10-06T15:00" } });
    fireEvent.change(screen.getByLabelText("وقت النهاية"), { target: { value: "2026-10-06T07:00" } });
    expect(screen.getByText("يجب أن يكون وقت النهاية بعد وقت البداية.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "إنشاء الوردية" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("بعض البيانات المُدخلة غير صالحة. راجع الحقول وحاول مرة أخرى.");
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows an inline error with retry when projects fail to load", async () => {
    const client = setup();
    client.listProjects.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR"));
    render(<NewShiftPage />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(ar.errors.INTERNAL_ERROR)).toBeTruthy();
    expect(screen.queryByText("Server says no")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: ar.common.retry }));
    await waitFor(() => expect((screen.getByLabelText(ar.shifts.form.fields.project) as HTMLSelectElement).options.length).toBe(2));
    expect(client.listProjects).toHaveBeenCalledTimes(2);
  });
});
