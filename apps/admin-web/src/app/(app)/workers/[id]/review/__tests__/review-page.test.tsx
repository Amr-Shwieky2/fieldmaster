import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingReview } from "@fieldmaster/api-client";
import { OrgRole } from "@fieldmaster/shared-types";
import { AuthProvider } from "@/lib/auth-context";
import { createIntlWrapper } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits, json, mockApi, requestedPaths, requestsTo, seedSession, textOf, type Handler } from "@/test/api-mock";
import OnboardingReviewPage from "../page";

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/workers/wp-9/review",
  useParams: () => ({ id: "wp-9" }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OnboardingReviewPage />
      </AuthProvider>
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
}

function review(overrides: Partial<OnboardingReview> = {}): OnboardingReview {
  return {
    workerProfileId: "wp-9",
    membershipStatus: "PENDING_APPROVAL",
    fullLegalName: "نادية خوري",
    preferredName: "نادية",
    phoneNumber: "+972501234567",
    submittedAt: "2026-10-11T12:30:00Z",
    governmentIdType: "PALESTINIAN_ID",
    governmentIdNumber: "123456789",
    bankAccount: { bankName: "بنك فلسطين", branchNumber: "456", accountNumber: "12345678", accountHolderName: "نادية خوري" },
    consentAcceptedAt: "2026-10-11T12:29:00Z",
    privacyNoticeVersion: "2026-10",
    identityDocument: { fileAssetId: "fa-id", contentType: "image/jpeg", sizeBytes: 123456 },
    profilePhoto: { fileAssetId: "fa-photo", contentType: "image/png", sizeBytes: 54321 },
    ...overrides,
  };
}

const viewUrl =
  (id: string, contentType = "image/jpeg") =>
  () =>
    json(200, { url: `https://files.example/${id}?sig=1`, expiresInSeconds: 60, contentType });

function routes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /workers/wp-9/onboarding-review": () => json(200, review()),
    "GET /file-assets/fa-id/view-url": viewUrl("fa-id"),
    "GET /file-assets/fa-photo/view-url": viewUrl("fa-photo", "image/png"),
    "POST /workers/wp-9/approve": () => json(200, {}),
    "POST /workers/wp-9/reject": () => json(200, {}),
    ...overrides,
  };
}

/** The value next to a term in the details lists. */
function detail(term: string): string {
  const dt = screen.getByText(term, { selector: "dt" });
  return textOf(dt.nextElementSibling);
}

describe("Onboarding review page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    nav.replace.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** `window.open` returning a tab the page sends to the signed URL later (it is opened during the click: no popup block). */
  function stubNewTabs() {
    const tabs: Array<{ opener: unknown; closed: boolean; location: { href: string }; close: ReturnType<typeof vi.fn> }> = [];
    const openMock = vi.fn(() => {
      const tab = { opener: window as unknown, closed: false, location: { href: "" }, close: vi.fn() };
      tabs.push(tab);
      return tab;
    });
    vi.stubGlobal("open", openMock);
    return { tabs, openMock };
  }

  it("shows an Owner the decrypted application and the audit note, without asking for any document URL yet", async () => {
    seedSession(OrgRole.OWNER);
    const fetchMock = mockApi(routes());
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "طلب انضمام: نادية خوري" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى قائمة العمال" }).getAttribute("href")).toBe("/workers");
    expect(screen.getByText("بانتظار الموافقة")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe("كل عرض لهذه البيانات أو لمستنداتها يُسجَّل في سجل التدقيق.");

    expect(detail("الاسم القانوني الكامل")).toBe("نادية خوري");
    expect(detail("الاسم المفضل")).toBe("نادية");
    expect(detail("رقم الهاتف")).toBe("+972501234567");
    expect(screen.getByText("+972501234567").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(detail("تاريخ تقديم الطلب")).toBe("11 أكتوبر 2026 في 15:30");
    expect(detail("نوع الهوية")).toBe("هوية فلسطينية");
    expect(detail("رقم الهوية أو الجواز")).toBe("123456789");
    expect(screen.getByText("123456789").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(detail("اسم البنك")).toBe("بنك فلسطين");
    expect(detail("رقم الفرع")).toBe("456");
    expect(detail("رقم الحساب")).toBe("12345678");
    expect(detail("اسم صاحب الحساب")).toBe("نادية خوري");
    expect(textOf(screen.getByText(/^تمت الموافقة على إشعار الخصوصية/))).toBe("تمت الموافقة على إشعار الخصوصية (الإصدار 2026-10) في 11 أكتوبر 2026 في 15:29.");

    // Every view is audited and a signed URL lasts a minute: documents are fetched only when opened.
    expect(screen.getAllByRole("button", { name: "عرض الصورة" })).toHaveLength(2);
    expect(screen.queryByRole("img")).toBeNull();
    expect(requestedPaths(fetchMock)).toEqual(["GET /workers/wp-9/onboarding-review"]);
    expect(screen.getByRole("button", { name: "الموافقة على العامل" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "رفض الطلب" })).toBeTruthy();
    expect(screen.queryByText("PENDING_APPROVAL")).toBeNull();
    expect(screen.queryByText("PALESTINIAN_ID")).toBeNull();
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
  });

  it("opens a PDF identity document in a new tab only when asked", async () => {
    seedSession(OrgRole.OWNER);
    const { tabs, openMock } = stubNewTabs();
    const fetchMock = mockApi(
      routes({
        "GET /workers/wp-9/onboarding-review": () =>
          json(
            200,
            review({
              governmentIdType: "ISRAELI_ID",
              identityDocument: { fileAssetId: "fa-id", contentType: "application/pdf", sizeBytes: 9000 },
              profilePhoto: null,
            }),
          ),
        "GET /file-assets/fa-id/view-url": viewUrl("fa-id", "application/pdf"),
      }),
    );
    renderPage();

    const open = await screen.findByRole("button", { name: "فتح المستند" });
    expect(detail("نوع الهوية")).toBe("هوية إسرائيلية");
    expect(screen.getByText("المستند ملف PDF، ويُفتح في نافذة جديدة.")).toBeTruthy();
    expect(screen.getByText("لم تُرفع صورة شخصية.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(requestsTo(fetchMock, "GET", "/file-assets/fa-id/view-url")).toEqual([]);

    fireEvent.click(open);
    // The tab opens during the click, cut off from this page, and goes to the PDF once the URL arrives.
    expect(openMock).toHaveBeenCalledWith("", "_blank");
    expect(tabs[0].opener).toBeNull();
    await waitFor(() => expect(tabs[0].location.href).toBe("https://files.example/fa-id?sig=1"));
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(requestsTo(fetchMock, "GET", "/file-assets/fa-id/view-url")).toHaveLength(1);
  });

  it("shows an image from a fresh signed URL when the Owner opens it, and asks for a new one each time", async () => {
    seedSession(OrgRole.OWNER);
    const { tabs, openMock } = stubNewTabs();
    let urls = 0;
    const fetchMock = mockApi(
      routes({
        "GET /file-assets/fa-id/view-url": () =>
          json(200, { url: `https://files.example/fa-id?sig=${++urls}`, expiresInSeconds: 60, contentType: "image/jpeg" }),
      }),
    );
    renderPage();

    const [showId, showPhoto] = await screen.findAllByRole("button", { name: "عرض الصورة" });
    fireEvent.click(showId);
    const image = (await screen.findByAltText("صورة وثيقة الهوية المرفوعة في طلب نادية خوري")) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("https://files.example/fa-id?sig=1");
    expect(requestsTo(fetchMock, "GET", "/file-assets/fa-photo/view-url")).toEqual([]);

    // A new tab gets its own URL; the image on the page keeps its own.
    fireEvent.click(screen.getByRole("button", { name: "فتح في نافذة جديدة" }));
    expect(openMock).toHaveBeenCalledWith("", "_blank");
    await waitFor(() => expect(tabs[0].location.href).toBe("https://files.example/fa-id?sig=2"));

    // Hiding drops the URL; showing again asks for a new one.
    fireEvent.click(screen.getByRole("button", { name: "إخفاء الصورة" }));
    await waitFor(() => expect(screen.queryByAltText("صورة وثيقة الهوية المرفوعة في طلب نادية خوري")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "عرض الصورة" })[0]);
    expect(((await screen.findByAltText("صورة وثيقة الهوية المرفوعة في طلب نادية خوري")) as HTMLImageElement).getAttribute("src")).toBe(
      "https://files.example/fa-id?sig=3",
    );

    // An image that cannot be shown (its URL expired) is asked for again.
    fireEvent.error(screen.getByAltText("صورة وثيقة الهوية المرفوعة في طلب نادية خوري"));
    expect((await screen.findByRole("alert")).textContent).toContain("تعذّر عرض الصورة، فربما انتهت صلاحية رابطها.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة التحميل" }));
    expect(((await screen.findByAltText("صورة وثيقة الهوية المرفوعة في طلب نادية خوري")) as HTMLImageElement).getAttribute("src")).toBe(
      "https://files.example/fa-id?sig=4",
    );
    expect(requestsTo(fetchMock, "GET", "/file-assets/fa-id/view-url")).toHaveLength(4);

    fireEvent.click(showPhoto);
    expect(((await screen.findByAltText("الصورة الشخصية المرفوعة في طلب نادية خوري")) as HTMLImageElement).getAttribute("src")).toBe(
      "https://files.example/fa-photo?sig=1",
    );
  });

  it("closes the tab it opened when the document URL is refused, and shows why on the page", async () => {
    seedSession(OrgRole.OWNER);
    const { tabs } = stubNewTabs();
    mockApi(
      routes({
        "GET /workers/wp-9/onboarding-review": () =>
          json(200, review({ identityDocument: { fileAssetId: "fa-id", contentType: "application/pdf", sizeBytes: 9000 }, profilePhoto: null })),
        "GET /file-assets/fa-id/view-url": () => apiError(404, "NOT_FOUND", "File asset not found"),
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "فتح المستند" }));
    expect((await screen.findByRole("alert")).textContent).toBe("تعذّر فتح المستند: لم نتمكن من العثور على العنصر المطلوب.");
    expect(tabs).toHaveLength(1);
    expect(tabs[0].close).toHaveBeenCalled();
    expect(tabs[0].location.href).toBe("");
  });

  it("translates a refused document URL", async () => {
    seedSession(OrgRole.OWNER);
    mockApi(routes({ "GET /file-assets/fa-id/view-url": () => apiError(404, "NOT_FOUND", "File asset not found") }));
    renderPage();

    fireEvent.click((await screen.findAllByRole("button", { name: "عرض الصورة" }))[0]);
    expect((await screen.findByRole("alert")).textContent).toBe("تعذّر فتح المستند: لم نتمكن من العثور على العنصر المطلوب.");
    expect(screen.queryByText("File asset not found")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("approves only with a valid compensation, sent as integer agorot from today's business date", async () => {
    // 22:30 UTC on Oct 12 is already Oct 13 in Israel.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T22:30:00Z"));
    seedSession(OrgRole.OWNER);
    const fetchMock = mockApi(routes());
    renderPage();

    const approve = await screen.findByRole("button", { name: "الموافقة على العامل" });
    expect(textOf(screen.getByText(/^يسري الأجر من اليوم/))).toBe("يسري الأجر من اليوم، 13 أكتوبر 2026.");
    fireEvent.click(approve);
    const daily = screen.getByLabelText("أجر اليوم (بالشيكل)");
    const overtime = screen.getByLabelText("أجر الساعات الإضافية (بالشيكل للساعة)");
    expect(screen.getAllByText("أدخل المبلغ بالشيكل.")).toHaveLength(2);
    expect(daily.getAttribute("aria-invalid")).toBe("true");
    expect(overtime.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(daily);

    fireEvent.change(daily, { target: { value: "abc" } });
    fireEvent.change(overtime, { target: { value: "-5" } });
    expect(screen.getByText("أدخل المبلغ بالأرقام فقط، مثل 400 أو 45.50.")).toBeTruthy();
    expect(screen.getByText("لا يمكن أن يكون المبلغ سالبًا.")).toBeTruthy();
    fireEvent.change(daily, { target: { value: "450.555" } });
    expect(screen.getByText("أدخل خانتين عشريتين على الأكثر (الأغورات).")).toBeTruthy();
    fireEvent.click(approve);
    expect(requestsTo(fetchMock, "POST", "/workers/wp-9/approve")).toEqual([]);

    // Typed in shekels (Arabic-Indic digits too), sent as exact integer agorot.
    fireEvent.change(daily, { target: { value: "٤٥٠.٥" } });
    fireEvent.change(overtime, { target: { value: "62.35" } });
    expect(daily.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(approve);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
    expect(requestsTo(fetchMock, "POST", "/workers/wp-9/approve")[0].body).toEqual({
      compensationProfile: {
        compensationType: "DAILY",
        dailyBaseRateAgorot: 45050,
        overtimeHourlyRateAgorot: 6235,
        effectiveStartDate: "2026-10-13",
        changeReason: "موافقة أولية عند الانضمام",
      },
    });
    expect(screen.getByRole("status").textContent).toBe("تمت الموافقة على العامل.");
  });

  it("rejects only with a written reason", async () => {
    seedSession(OrgRole.OWNER);
    const fetchMock = mockApi(routes());
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "رفض الطلب" }));
    const reason = screen.getByLabelText("سبب الرفض");
    expect(screen.getByText("يُحفظ السبب مع القرار في سجل التدقيق.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الرفض" }));
    expect((await screen.findByRole("alert")).textContent).toBe("اكتب السبب قبل المتابعة.");
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(requestsTo(fetchMock, "POST", "/workers/wp-9/reject")).toEqual([]);

    fireEvent.change(reason, { target: { value: "  صورة الهوية غير واضحة  " } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الرفض" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/workers"));
    expect(requestsTo(fetchMock, "POST", "/workers/wp-9/reject")[0].body).toEqual({ reason: "صورة الهوية غير واضحة" });
    expect(requestsTo(fetchMock, "POST", "/workers/wp-9/approve")).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("تم رفض طلب العامل.");
  });

  it("sends a Field Manager to the dashboard without reading the application", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = mockApi(routes());
    renderPage();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText("نادية خوري")).toBeNull();
    expect(screen.queryByText("123456789")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("جارٍ التحميل…");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a decided application without the decision form", async () => {
    seedSession(OrgRole.OWNER);
    mockApi(routes({ "GET /workers/wp-9/onboarding-review": () => json(200, review({ membershipStatus: "ACTIVE" })) }));
    renderPage();

    expect(await screen.findByText("تمت معالجة هذا الطلب، وحالته الآن: نشط.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "الموافقة على العامل" })).toBeNull();
    expect(screen.queryByRole("button", { name: "رفض الطلب" })).toBeNull();
  });

  it("explains an application that does not exist (404), and translates other errors", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    mockApi(
      routes({
        "GET /workers/wp-9/onboarding-review": () =>
          ++calls === 1 ? apiError(500, "INTERNAL_ERROR", "boom") : apiError(404, "NOT_FOUND", "Application not found"),
      }),
    );
    renderPage();

    expect((await screen.findByRole("alert")).textContent).toContain("حدث خطأ في الخادم. يُرجى المحاولة لاحقًا.");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("لم نعثر على طلب الانضمام هذا.")).toBeTruthy();
    expect(screen.queryByText(/Application not found|boom/)).toBeNull();
    expect(within(document.body).queryByRole("button", { name: "الموافقة على العامل" })).toBeNull();
  });
});
