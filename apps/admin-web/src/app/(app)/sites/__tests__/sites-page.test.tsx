import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type Project, type Site } from "@fieldmaster/api-client";
import ar from "@/i18n/messages/ar.json";
import { renderWithIntl } from "@/test/render-with-intl";
import SitesPage from "../page";

const auth = vi.hoisted(() => ({
  role: "OWNER" as string,
  client: {} as Record<string, ReturnType<typeof import("vitest").vi.fn>>,
}));

vi.mock("@/lib/auth-context", () => ({
  useAuth: () => ({ client: auth.client, session: { role: auth.role } }),
}));

// Leaflet is covered by geofence-map-picker.test.tsx; here the map is a stub.
vi.mock("next/dynamic", () => ({
  default: () =>
    function GeofenceMapStub({ labelId }: { labelId?: string }) {
      return <div data-testid="geofence-map" aria-labelledby={labelId} />;
    },
}));

const PROJECTS: Project[] = [
  { id: "p1", name: "Ayalon works", client: "Netivei Israel", projectCode: "AYL-01", status: "ACTIVE", budgetAgorot: 123450 },
];
const SITES: Site[] = [{ id: "s1", projectId: "p1", name: "North interchange", latitude: 32.0853, longitude: 34.7818, defaultGeofenceRadiusMeters: 1500 }];

function apiError(status: number, code: string, message = "Server says no") {
  return new ApiRequestError(status, { statusCode: status, code, message, details: {}, correlationId: "c" });
}

function setup({ role = "OWNER", projects = PROJECTS, sites = SITES }: { role?: string; projects?: Project[]; sites?: Site[] } = {}) {
  auth.role = role;
  auth.client = {
    listProjects: vi.fn().mockResolvedValue(projects),
    listSites: vi.fn().mockResolvedValue(sites),
    createProject: vi.fn().mockResolvedValue({ id: "p2" }),
    createSite: vi.fn().mockResolvedValue({ id: "s2" }),
    createGeofence: vi.fn().mockResolvedValue({ id: "g2" }),
  };
  return auth.client;
}

function renderPage() {
  return renderWithIntl(<SitesPage />, { queryClient: true });
}

/** The page text with the given API/user data removed, i.e. only the UI's own text. */
function uiTextWithout(...data: string[]): string {
  return data.reduce((text, value) => text.split(value).join(""), document.body.textContent ?? "");
}

describe("Sites & Projects page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders in Arabic for an Owner, with the budget and coordinates kept left-to-right", async () => {
    setup();
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "المواقع والمشاريع" })).toBeTruthy();
    const projectList = await screen.findByRole("list", { name: "قائمة المشاريع" });
    expect(within(projectList).getByText("Ayalon works")).toBeTruthy();
    expect(within(projectList).getByText("العميل: Netivei Israel", { exact: false })).toBeTruthy();

    const budget = screen.getByText("₪ 1,234.50");
    expect(budget.closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(budget.parentElement?.textContent).toBe("الميزانية: ₪ 1,234.50");
    expect(screen.getByText("AYL-01").closest("bdi")?.getAttribute("dir")).toBe("ltr");

    expect(await screen.findByText("North interchange")).toBeTruthy();
    expect(screen.getByText("32.0853, 34.7818").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("نطاق الموقع: 1,500 م", { exact: false })).toBeTruthy();

    // Form labels are associated with their inputs; the map is labelled by the visible caption.
    expect(screen.getByLabelText("اسم المشروع")).toBeTruthy();
    expect(screen.getByLabelText("خط العرض").getAttribute("dir")).toBe("ltr");
    expect(screen.getByTestId("geofence-map").getAttribute("aria-labelledby")).toBe("site-map-label");
    expect(document.getElementById("site-map-label")?.textContent).toBe("مركز نطاق الموقع");

    // No English UI text leaks: once the API data (names, client, project code) is removed,
    // no Latin letters are left anywhere on the page.
    expect(uiTextWithout("Ayalon works", "Netivei Israel", "AYL-01", "North interchange")).not.toMatch(/[A-Za-z]/);
  });

  it("never shows a project budget to a Field Manager", async () => {
    const client = setup({ role: "FIELD_MANAGER" });
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: ar.sites.title })).toBeTruthy();
    const projectList = await screen.findByRole("list", { name: ar.sites.projects.listLabel });
    expect(within(projectList).getByText("Ayalon works")).toBeTruthy();
    expect(await screen.findByText("نطاق الموقع: 1,500 م", { exact: false })).toBeTruthy();
    // The mocked API still returns budgetAgorot; the UI must hide it anyway.
    expect(client.listProjects).toHaveBeenCalled();
    expect(screen.queryByText(/الميزانية/)).toBeNull();
    expect(screen.queryByText(/₪/)).toBeNull();
    expect(document.body.textContent).not.toContain("₪");
    expect(document.body.textContent).not.toContain("1,234.50");
  });

  it("shows page-specific empty states", async () => {
    setup({ projects: [], sites: [] });
    renderPage();
    expect(await screen.findByText("لا توجد مشاريع بعد")).toBeTruthy();
    expect(await screen.findByText("لا توجد مواقع بعد")).toBeTruthy();
    expect(screen.getByText("أنشئ مشروعًا أولًا، ثم أضف إليه موقعًا.")).toBeTruthy();
  });

  it("shows a translated error with a working retry", async () => {
    const client = setup();
    client.listProjects.mockRejectedValueOnce(apiError(500, "INTERNAL_ERROR", "Database exploded"));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.")).toBeTruthy();
    expect(screen.queryByText("Database exploded")).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("list", { name: "قائمة المشاريع" })).toBeTruthy();
    expect(client.listProjects).toHaveBeenCalledTimes(2);
  });

  it("shows access denied when the API answers 403", async () => {
    const client = setup();
    client.listSites.mockRejectedValue(apiError(403, "FORBIDDEN"));
    renderPage();
    expect(await screen.findByText(ar.states.accessDeniedTitle)).toBeTruthy();
  });

  it("creates a project with the same payload as before and confirms it", async () => {
    const client = setup();
    const { form } = ar.sites.projects;
    renderPage();
    await screen.findByRole("list", { name: ar.sites.projects.listLabel });
    const submit = screen.getByRole("button", { name: form.submit }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(form.name), { target: { value: "الطريق الدائري" } });
    fireEvent.change(screen.getByLabelText(form.code), { target: { value: "RR-7" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(client.createProject).toHaveBeenCalledWith({ name: "الطريق الدائري", client: undefined, projectCode: "RR-7" }));
    expect(await screen.findByText(ar.sites.projects.messages.created)).toBeTruthy();
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2));
  });

  it("shows a translated message (not the API text) when creating a project fails", async () => {
    const client = setup();
    client.createProject.mockRejectedValue(apiError(400, "VALIDATION_FAILED", "projectCode must be unique"));
    renderPage();
    await screen.findByRole("list", { name: "قائمة المشاريع" });
    fireEvent.change(screen.getByLabelText("اسم المشروع"), { target: { value: "طريق" } });
    fireEvent.change(screen.getByLabelText("رمز المشروع"), { target: { value: "X-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء المشروع" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("بعض البيانات المُدخلة غير صالحة. راجع الحقول وحاول مرة أخرى.");
  });

  it("creates a site and its geofence from the form values", async () => {
    const client = setup();
    const { form } = ar.sites.sites;
    renderPage();
    await screen.findByText("North interchange");
    fireEvent.change(screen.getByLabelText(form.project), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(form.name), { target: { value: "البوابة 3" } });
    fireEvent.change(screen.getByLabelText(form.latitude), { target: { value: "31.5" } });
    fireEvent.change(screen.getByLabelText(form.radius), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: form.submit }));

    await waitFor(() =>
      expect(client.createGeofence).toHaveBeenCalledWith({ siteId: "s2", centerLatitude: 31.5, centerLongitude: 34.7818, radiusMeters: 250 }),
    );
    expect(client.createSite).toHaveBeenCalledWith({ projectId: "p1", name: "البوابة 3", latitude: 31.5, longitude: 34.7818, defaultGeofenceRadiusMeters: 250 });
    expect(await screen.findByText(ar.sites.sites.messages.created)).toBeTruthy();
  });
});
