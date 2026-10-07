import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiRequestError, type NotificationItem } from "@fieldmaster/api-client";
import type { Locale } from "@/i18n/config";
import { renderWithIntl } from "@/test/render-with-intl";
import NotificationsPage from "../page";

const mocks = vi.hoisted(() => ({
  auth: { session: null as unknown, client: null as unknown },
}));

vi.mock("@/lib/auth-context", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/notifications",
}));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const CLOCK_OUT_DATA = {
  timeEntryId: "te-1",
  shiftId: "s-1",
  shiftTitle: "Ayalon North",
  workerProfileId: "wp-1",
  workerName: "Eli Ramzani",
  clockOutAt: "2026-10-05T13:30:00.000Z",
  durationMinutes: 630,
  regularMinutes: 540,
  overtimeMinutes: 90,
};

function notification(overrides: Partial<NotificationItem>): NotificationItem {
  return {
    id: "n1",
    type: "WORKER_CLOCKED_OUT",
    title: "Worker clocked out",
    body: 'Worker clocked out of "Ayalon North".\nTotal: 10h 30m\nRegular: 9h 0m\nOvertime: 1h 30m\nApproval is required.',
    dataJson: CLOCK_OUT_DATA,
    readAt: null,
    createdAt: minutesAgo(5),
    ...overrides,
  };
}

/** What a Field Manager receives: durations, never money. */
const FIELD_MANAGER_ROWS: NotificationItem[] = [
  notification({ id: "n1" }),
  notification({
    id: "n2",
    type: "PAYROLL_FINALIZED",
    title: "Payroll finalized",
    body: "Payroll for 2026-09 has been finalized.",
    dataJson: { yearMonth: "2026-09" },
    readAt: minutesAgo(60),
    createdAt: minutesAgo(120),
  }),
  // Created before notifications carried data: Arabic must not show the stored English text.
  notification({ id: "n3", type: "EMERGENCY_SHIFT_STARTED", title: "Emergency call-out started", body: "A worker started a Night Turan emergency call-out.", dataJson: {}, createdAt: minutesAgo(30) }),
];

/** What an Owner receives for the same clock-out: the same values plus the estimated cost. */
const OWNER_ROWS: NotificationItem[] = [
  notification({
    id: "o1",
    body: 'Worker clocked out of "Ayalon North".\nTotal: 10h 30m\nRegular: 9h 0m\nOvertime: 1h 30m\nEstimated cost: ₪573.75',
    dataJson: { ...CLOCK_OUT_DATA, estimatedCostAgorot: 57375 },
  }),
];

function apiError(status: number, code: string) {
  return new ApiRequestError(status, { statusCode: status, code, message: `API says ${code}`, details: {}, correlationId: "c" });
}

function setup(listNotifications: () => Promise<NotificationItem[]>, markNotificationRead = vi.fn(async () => ({ success: true }))) {
  const client = { listNotifications: vi.fn(listNotifications), markNotificationRead };
  mocks.auth = { session: { role: "FIELD_MANAGER" }, client };
  return client;
}

function renderPage(locale: Locale) {
  return renderWithIntl(<NotificationsPage />, { locale, queryClient: true });
}

/** Text content without bidi isolate marks. */
const visible = (element: HTMLElement) => (element.textContent ?? "").replace(/[⁦-⁩]/g, "");

describe("Notifications page", () => {
  beforeEach(() => {
    mocks.auth = { session: null, client: null };
  });

  it("renders in Arabic from the notification data, never showing the stored English text", async () => {
    setup(async () => FIELD_MANAGER_ROWS);
    renderPage("ar");

    expect(screen.getByRole("heading", { level: 1, name: "الإشعارات" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "قائمة الإشعارات، الأحدث أولًا" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    // Clock-out rendered from data, in Arabic, with Western digits and no cost (Field Manager data).
    expect(within(items[0]).getByText("أنهى عامل الدوام")).toBeTruthy();
    expect(visible(items[0])).toContain("أنهى Eli Ramzani الدوام في وردية «Ayalon North».");
    expect(visible(items[0])).toContain("ساعات إضافية: 1 س 30 د");
    expect(visible(items[0])).toContain("قبل 5 دقائق");
    expect(visible(items[0])).not.toContain("₪");
    expect(visible(items[0])).not.toMatch(/[٠-٩]/);

    expect(visible(items[1])).toContain("تم إقفال رواتب شهر سبتمبر 2026.");
    // Old notification without data: generic Arabic sentence.
    expect(visible(items[2])).toContain("بدأ أحد العمال استدعاء طوارئ.");

    expect(document.body.textContent).not.toMatch(/Worker clocked out|Approval is required|A worker started/);
    // Two unread, one read.
    expect(screen.getByText("غير مقروءة: 2")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "تحديد كمقروء" })).toHaveLength(2);
  });

  it("renders in English", async () => {
    setup(async () => FIELD_MANAGER_ROWS);
    renderPage("en");

    expect(screen.getByRole("heading", { level: 1, name: "Notifications" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Notifications, newest first" });
    const items = within(list).getAllByRole("listitem");
    expect(within(items[0]).getByText("Worker clocked out")).toBeTruthy();
    expect(visible(items[0])).toContain("Eli Ramzani clocked out of “Ayalon North”.");
    expect(visible(items[0])).toContain("5 minutes ago");
    expect(visible(items[1])).toContain("Payroll for September 2026 has been finalized.");
    // English may show the stored English text of an old notification.
    expect(visible(items[2])).toContain("A worker started a Night Turan emergency call-out.");
  });

  it("shows the Owner the estimated cost as ₪ 573.75 in both languages", async () => {
    setup(async () => OWNER_ROWS);
    renderPage("ar");
    expect(visible(await screen.findByRole("list"))).toContain("التكلفة التقديرية: ₪ 573.75");
    cleanup();

    renderPage("en");
    expect(visible(await screen.findByRole("list"))).toContain("Estimated cost: ₪ 573.75");
  });

  it("shows the empty state", async () => {
    setup(async () => []);
    renderPage("ar");
    expect(await screen.findByText("لا توجد إشعارات بعد")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows a translated error with a working retry", async () => {
    let calls = 0;
    const client = setup(async () => {
      calls += 1;
      if (calls === 1) throw apiError(500, "INTERNAL_ERROR");
      return FIELD_MANAGER_ROWS;
    });
    renderPage("en");

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Something went wrong")).toBeTruthy();
    expect(alert.textContent).not.toContain("API says");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("list")).toBeTruthy();
    expect(client.listNotifications).toHaveBeenCalledTimes(2);
  });

  it("shows access denied on a 403", async () => {
    setup(async () => {
      throw apiError(403, "FORBIDDEN");
    });
    renderPage("ar");
    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
  });

  it("marks a notification as read: pending label while saving, then an announcement", async () => {
    let resolveMark: (value: { success: boolean }) => void = () => undefined;
    const markNotificationRead = vi.fn(() => new Promise<{ success: boolean }>((resolve) => (resolveMark = resolve)));
    const client = setup(async () => FIELD_MANAGER_ROWS, markNotificationRead);
    renderPage("ar");

    const [first] = await screen.findAllByRole("button", { name: "تحديد كمقروء" });
    fireEvent.click(first);

    const pending = await screen.findByRole("button", { name: "جارٍ التحديد…" });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(markNotificationRead).toHaveBeenCalledWith("n1");

    resolveMark({ success: true });
    expect(await screen.findByText("تم تحديد الإشعار كمقروء.")).toBeTruthy();
    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledTimes(2));
  });

  it("shows a translated error when marking as read fails", async () => {
    const markNotificationRead = vi.fn(async () => {
      throw apiError(404, "NOT_FOUND");
    });
    setup(async () => FIELD_MANAGER_ROWS, markNotificationRead);
    renderPage("en");

    const [first] = await screen.findAllByRole("button", { name: "Mark as read" });
    fireEvent.click(first);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not mark the notification as read.")).toBeTruthy();
    expect(alert.textContent).not.toContain("API says");
  });
});
