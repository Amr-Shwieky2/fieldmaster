import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicInvitation } from "@fieldmaster/api-client";
import { createIntlWrapper } from "@/test/render-with-intl";
import { apiError, hasArabicIndicDigits, json, mockApi, requestsTo, textOf, type FetchMock, type Handler } from "@/test/api-mock";
import { JoinPage } from "@/components/join/join-page";

const TOKEN = "tok-123";
const BASE = `/onboarding/invitations/${TOKEN}`;
const ORGANIZATION = "شركة البناء الحديث";

const INVITATION: PublicInvitation = {
  organizationName: ORGANIZATION,
  prefilledPhoneNumber: null,
  expiresAt: "2026-10-20T09:00:00Z",
  privacyNoticeVersion: "2026-10",
  maxUploadBytes: 10 * 1024 * 1024,
  allowedContentTypes: { IDENTITY_DOCUMENT: ["image/jpeg", "image/png", "application/pdf"], PROFILE_PHOTO: ["image/jpeg", "image/png"] },
};

function renderJoin(token = TOKEN) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <JoinPage token={token} />
    </QueryClientProvider>,
    { wrapper: createIntlWrapper() },
  );
}

/** The public API: the invitation, uploads (numbered in order) and the application. */
function routes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  let uploads = 0;
  return {
    [`GET ${BASE}`]: () => json(200, INVITATION),
    [`POST ${BASE}/uploads`]: (init) => {
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      uploads += 1;
      return json(201, { fileAssetId: `fa-${uploads}`, purpose: form.get("purpose"), contentType: file.type, sizeBytes: file.size });
    },
    [`POST ${BASE}/redeem`]: () => json(201, { submitted: true }),
    ...overrides,
  };
}

function makeFile(name: string, type: string, size = 2048): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
function type(label: string, value: string) {
  fireEvent.change(input(label), { target: { value } });
}
/** Types into a field and leaves it (its check then shows). */
function typeAndLeave(label: string, value: string) {
  const element = input(label);
  fireEvent.change(element, { target: { value } });
  fireEvent.blur(element);
}
function choose(label: string, file: File) {
  fireEvent.change(input(label), { target: { files: [file] } });
}
/** The validation message the field points to, or null. */
function errorOf(label: string): string | null {
  const element = input(label);
  if (element.getAttribute("aria-invalid") !== "true") return null;
  const ids = (element.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id.endsWith("-error"));
  return ids.length ? textOf(document.getElementById(ids[0])) : null;
}

const NAME = "الاسم القانوني الكامل";
const PREFERRED = "الاسم المفضل (اختياري)";
const PHONE = "رقم الهاتف";
const ID_NUMBER = "رقم الهوية أو الجواز";
const ID_DOCUMENT = "صورة الهوية";
const PHOTO = "الصورة الشخصية (اختياري)";
const BANK = "اسم البنك";
const BRANCH = "رقم الفرع";
const ACCOUNT = "رقم الحساب";
const HOLDER = "اسم صاحب الحساب";
const CONSENT = "قرأت إشعار الخصوصية، وأوافق على جمع بياناتي ومعالجتها كما هو موضّح فيه.";

const ISRAELI_INVALID = "رقم الهوية غير صحيح. يُرجى التأكد من الأرقام التسعة، ومنها رقم التحقق.";
const PALESTINIAN_INVALID = "رقم الهوية الفلسطينية يتكون من 9 أرقام.";
const PASSPORT_INVALID = "رقم جواز السفر يتكون من 5 إلى 20 حرفًا لاتينيًا أو رقمًا.";
const ALL_ZEROS = "رقم غير صالح: لا يمكن أن يتكون من أصفار فقط.";

async function openForm() {
  return screen.findByRole("heading", { level: 1, name: `الانضمام إلى ${ORGANIZATION}` });
}

/** A complete, valid application (a Palestinian ID, both files uploaded). */
async function fillValidForm() {
  await openForm();
  type(NAME, "  نادية خوري  ");
  type(PREFERRED, "نادية");
  type(PHONE, "050-123 4567");
  fireEvent.click(screen.getByRole("radio", { name: "هوية فلسطينية" }));
  type(ID_NUMBER, "123456789");
  choose(ID_DOCUMENT, makeFile("id.jpg", "image/jpeg"));
  choose(PHOTO, makeFile("me.png", "image/png"));
  await waitFor(() => expect(screen.getAllByText("تم الرفع")).toHaveLength(2));
  type(BANK, "بنك فلسطين");
  type(BRANCH, "789");
  type(ACCOUNT, "99887766");
  type(HOLDER, "نادية خوري");
  fireEvent.click(screen.getByRole("checkbox", { name: CONSENT }));
}

/** A complete, valid application when the invitation fixes the phone number (an Israeli ID, no photo). */
async function fillValidFormWithFixedPhone() {
  await openForm();
  type(NAME, "نادية خوري");
  type(ID_NUMBER, "123456782");
  choose(ID_DOCUMENT, makeFile("id.png", "image/png"));
  expect(await screen.findByText("تم الرفع")).toBeTruthy();
  type(BANK, "بنك لئومي");
  type(BRANCH, "12");
  type(ACCOUNT, "445566");
  type(HOLDER, "نادية خوري");
  fireEvent.click(screen.getByRole("checkbox", { name: CONSENT }));
}

/** Starts over with a new page (and a new query cache). */
function cleanupAndRender() {
  cleanup();
  return renderJoin();
}

function noAuthorizationHeader(fetchMock: FetchMock) {
  for (const [, init] of fetchMock.mock.calls) expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
}

describe("Public join page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["an invalid, used, expired or revoked link (404)", () => apiError(404, "INVITATION_INVALID_OR_EXPIRED", "Invitation not found")],
    ["a malformed link (400)", () => apiError(400, "VALIDATION_FAILED", "Bad token")],
  ])("shows one friendly page, without details or data, for %s", async (_case, answer) => {
    const fetchMock = mockApi(routes({ [`GET ${BASE}`]: answer }));
    renderJoin();

    const heading = await screen.findByRole("heading", { level: 1, name: "رابط الانضمام غير صالح" });
    expect(screen.getByText("قد يكون الرابط منتهي الصلاحية، أو استُخدم من قبل، أو أُلغي. يُرجى طلب رابط جديد من صاحب العمل.")).toBeTruthy();
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Invitation not found|Bad token/)).toBeNull();
    expect(screen.queryByText(ORGANIZATION)).toBeNull();
    expect(requestsTo(fetchMock, "GET", BASE)).toHaveLength(1);
    noAuthorizationHeader(fetchMock);
  });

  it("offers a retry when the server cannot be reached, then shows the form", async () => {
    let calls = 0;
    mockApi(routes({ [`GET ${BASE}`]: () => (++calls === 1 ? Promise.reject(new TypeError("Failed to fetch")) : json(200, INVITATION)) }));
    renderJoin();

    expect(await screen.findByRole("heading", { level: 1, name: "تعذّر فتح صفحة الانضمام الآن" })).toBeTruthy();
    expect(screen.getByText("تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await openForm()).toBeTruthy();
  });

  it("shows a phone-sized form: Arabic labels, input hints for mobile keyboards, the ID types and the privacy notice", async () => {
    const fetchMock = mockApi(routes());
    renderJoin();

    await openForm();
    expect(textOf(screen.getByText(/^يصلح هذا الرابط حتى/))).toBe("يصلح هذا الرابط حتى 20 أكتوبر 2026 في 12:00.");
    for (const section of ["البيانات الشخصية", "الهوية", "الحساب البنكي لإيداع الراتب", "إشعار الخصوصية"]) {
      expect(screen.getByRole("heading", { level: 2, name: section })).toBeTruthy();
    }

    const name = input(NAME);
    expect(name.getAttribute("autocomplete")).toBe("name");
    expect(name.getAttribute("aria-required")).toBe("true");
    expect(name.className).toContain("text-base");
    expect(input(PREFERRED).getAttribute("aria-required")).toBeNull();
    const phone = input(PHONE);
    expect([phone.type, phone.getAttribute("inputmode"), phone.getAttribute("autocomplete"), phone.getAttribute("dir")]).toEqual(["tel", "tel", "tel", "ltr"]);
    expect(phone.readOnly).toBe(false);

    // ID types from the shared labels, in this order; Israeli by default.
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual(["هوية إسرائيلية", "هوية فلسطينية", "جواز سفر"]);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false]);
    const idNumber = input(ID_NUMBER);
    expect([idNumber.getAttribute("inputmode"), idNumber.getAttribute("autocomplete"), idNumber.getAttribute("dir")]).toEqual(["numeric", "off", "ltr"]);
    expect(screen.getByText("حتى 9 أرقام، آخرها رقم التحقق.")).toBeTruthy();

    // Files: images (a phone offers its camera) or a PDF for the ID; images only for the photo.
    expect(input(ID_DOCUMENT).accept).toBe("image/jpeg,image/png,application/pdf");
    expect(input(PHOTO).accept).toBe("image/jpeg,image/png");
    expect(input(ID_DOCUMENT).getAttribute("capture")).toBeNull();
    expect(screen.getAllByText("اختيار ملف أو التقاط صورة")).toHaveLength(2);
    expect(screen.getByText("صورة واضحة للوثيقة أو ملف PDF (الصيغ المقبولة: JPEG وPNG وPDF، حتى 10 ميغابايت).")).toBeTruthy();

    for (const label of [BRANCH, ACCOUNT]) expect(input(label).getAttribute("inputmode")).toBe("numeric");
    for (const label of [ID_NUMBER, BANK, BRANCH, ACCOUNT, HOLDER]) expect(input(label).getAttribute("autocomplete")).toBe("off");

    // The privacy notice, its version, and an unchecked consent.
    expect(screen.getByText(`يجمع ${ORGANIZATION} («صاحب العمل») البيانات في هذه الصفحة عبر نظام FieldMaster لإدارة فرق العمل الميدانية.`)).toBeTruthy();
    expect(textOf(screen.getByText(/^إصدار الإشعار/))).toBe("إصدار الإشعار: 2026-10");
    expect(screen.getByText("2026-10").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    const consent = screen.getByRole("checkbox", { name: CONSENT }) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    expect(screen.getByRole("button", { name: "إرسال الطلب" }).className).toContain("w-full");
    expect(hasArabicIndicDigits(document.body.textContent)).toBe(false);
    noAuthorizationHeader(fetchMock);
  });

  it("checks each field once it is left, with the message next to it", async () => {
    mockApi(routes());
    renderJoin();
    await openForm();

    expect(errorOf(NAME)).toBeNull();
    typeAndLeave(NAME, "   ");
    expect(errorOf(NAME)).toBe("الاسم القانوني الكامل مطلوب.");
    typeAndLeave(PHONE, "12345");
    expect(errorOf(PHONE)).toBe("رقم الهاتف غير صحيح. مثال صحيح: 050-1234567 أو +972501234567.");
    typeAndLeave(PHONE, "050-123 4567");
    expect(errorOf(PHONE)).toBeNull();
    typeAndLeave(BRANCH, "12345");
    expect(errorOf(BRANCH)).toBe("رقم الفرع يتكون من 1 إلى 4 أرقام.");
    // Digits typed on an Arabic keyboard become 0-9.
    typeAndLeave(BRANCH, "١٢٣");
    expect(input(BRANCH).value).toBe("123");
    expect(errorOf(BRANCH)).toBeNull();
    typeAndLeave(ACCOUNT, "1");
    expect(errorOf(ACCOUNT)).toBe("رقم الحساب يتكون من 2 إلى 20 رقمًا.");
    typeAndLeave(BANK, "");
    expect(errorOf(BANK)).toBe("اسم البنك مطلوب.");
    // Fields not visited yet stay quiet.
    expect(errorOf(HOLDER)).toBeNull();
    expect(errorOf(ID_NUMBER)).toBeNull();
  });

  it("checks an Israeli ID number's check digit", async () => {
    mockApi(routes());
    renderJoin();
    await openForm();

    typeAndLeave(ID_NUMBER, "123456789");
    expect(errorOf(ID_NUMBER)).toBe(ISRAELI_INVALID);
    typeAndLeave(ID_NUMBER, "123456782");
    expect(errorOf(ID_NUMBER)).toBeNull();
  });

  it("accepts a Palestinian ID without a check digit, and checks the number again when the type changes", async () => {
    mockApi(routes());
    renderJoin();
    await openForm();

    typeAndLeave(ID_NUMBER, "123456789");
    expect(errorOf(ID_NUMBER)).toBe(ISRAELI_INVALID);
    fireEvent.click(screen.getByRole("radio", { name: "هوية فلسطينية" }));
    expect(errorOf(ID_NUMBER)).toBeNull();
    expect(screen.getByText("9 أرقام كما تظهر على البطاقة.")).toBeTruthy();

    typeAndLeave(ID_NUMBER, "12345678");
    expect(errorOf(ID_NUMBER)).toBe(PALESTINIAN_INVALID);
    fireEvent.click(screen.getByRole("radio", { name: "جواز سفر" }));
    expect(errorOf(ID_NUMBER)).toBeNull();
    expect(input(ID_NUMBER).getAttribute("inputmode")).toBe("text");
    typeAndLeave(ID_NUMBER, "AB12");
    expect(errorOf(ID_NUMBER)).toBe(PASSPORT_INVALID);
    typeAndLeave(ID_NUMBER, "12345678");
    fireEvent.click(screen.getByRole("radio", { name: "هوية إسرائيلية" }));
    expect(errorOf(ID_NUMBER)).toBe(ISRAELI_INVALID);
  });

  it.each(["هوية إسرائيلية", "هوية فلسطينية", "جواز سفر"])("refuses 000000000 as a %s number", async (idType) => {
    mockApi(routes());
    renderJoin();
    await openForm();

    fireEvent.click(screen.getByRole("radio", { name: idType }));
    typeAndLeave(ID_NUMBER, "000000000");
    expect(errorOf(ID_NUMBER)).toBe(ALL_ZEROS);
  });

  it("refuses a file that is too large or of the wrong type before uploading it", async () => {
    const fetchMock = mockApi(routes());
    renderJoin();
    await openForm();

    choose(ID_DOCUMENT, makeFile("scan.jpg", "image/jpeg", 11 * 1024 * 1024));
    const tooLarge = await screen.findByText("حجم الملف أكبر من 10 ميغابايت. يُرجى اختيار ملف أصغر.");
    // The file's status explains it at once (the field is invalid); the form's own message comes on submit.
    expect(input(ID_DOCUMENT).getAttribute("aria-invalid")).toBe("true");
    expect(input(ID_DOCUMENT).getAttribute("aria-describedby")).toContain(tooLarge.closest("[aria-live]")?.id);
    expect(errorOf(ID_DOCUMENT)).toBeNull();
    choose(ID_DOCUMENT, makeFile("notes.txt", "text/plain"));
    expect(await screen.findByText("نوع الملف غير مقبول. المقبول: صورة JPEG أو PNG، أو ملف PDF.")).toBeTruthy();
    choose(PHOTO, makeFile("me.pdf", "application/pdf"));
    expect(await screen.findByText("نوع الملف غير مقبول. المقبول: صورة JPEG أو PNG.")).toBeTruthy();
    expect(screen.getByText("notes.txt").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(requestsTo(fetchMock, "POST", `${BASE}/uploads`)).toEqual([]);
  });

  it("shows each upload's progress and result, translates a refused file and lets the worker replace or remove a file", async () => {
    let release: () => void = () => {};
    let uploads = 0;
    const fetchMock = mockApi(
      routes({
        [`POST ${BASE}/uploads`]: () => {
          uploads += 1;
          if (uploads === 1)
            return new Promise<Response>((resolve) => {
              release = () => resolve(json(201, { fileAssetId: "fa-1", purpose: "IDENTITY_DOCUMENT", contentType: "image/jpeg", sizeBytes: 2048 }));
            });
          if (uploads === 2) return apiError(422, "FILE_REJECTED", "Malware scan failed");
          return json(201, { fileAssetId: `fa-${uploads}`, purpose: "IDENTITY_DOCUMENT", contentType: "application/pdf", sizeBytes: 2048 });
        },
      }),
    );
    renderJoin();
    await openForm();

    choose(ID_DOCUMENT, makeFile("id.jpg", "image/jpeg"));
    expect(await screen.findByText("جارٍ رفع الملف…")).toBeTruthy();
    const [upload] = requestsTo(fetchMock, "POST", `${BASE}/uploads`);
    const form = upload.body as FormData;
    expect(form.get("purpose")).toBe("IDENTITY_DOCUMENT");
    expect((form.get("file") as File).name).toBe("id.jpg");
    release();
    expect(await screen.findByText("تم الرفع")).toBeTruthy();
    expect(screen.getByText("استبدال الملف")).toBeTruthy();

    choose(ID_DOCUMENT, makeFile("id-2.jpg", "image/jpeg"));
    expect(await screen.findByText("تعذّر رفع الملف: رُفض الملف بعد فحصه. ارفع ملفاً آخر.")).toBeTruthy();
    expect(screen.queryByText("Malware scan failed")).toBeNull();
    choose(ID_DOCUMENT, makeFile("id.pdf", "application/pdf"));
    expect(await screen.findByText("تم الرفع")).toBeTruthy();
    expect(screen.getByText("id.pdf")).toBeTruthy();

    // The optional photo can be removed again.
    choose(PHOTO, makeFile("me.png", "image/png"));
    await waitFor(() => expect(screen.getAllByText("تم الرفع")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "إزالة الملف" }));
    expect(screen.getAllByText("تم الرفع")).toHaveLength(1);
    expect(screen.queryByText("me.png")).toBeNull();
  });

  it("does not send an incomplete application: every problem is shown and the first field gets the focus", async () => {
    let release: () => void = () => {};
    const fetchMock = mockApi(
      routes({
        [`POST ${BASE}/uploads`]: () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(json(201, { fileAssetId: "fa-1", purpose: "PROFILE_PHOTO", contentType: "image/png", sizeBytes: 10 }));
          }),
      }),
    );
    renderJoin();
    await openForm();

    choose(PHOTO, makeFile("me.png", "image/png"));
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect((await screen.findByRole("alert")).textContent).toBe("يُرجى تصحيح الحقول المعلَّمة قبل الإرسال.");
    expect(document.activeElement).toBe(input(NAME));
    expect(errorOf(NAME)).toBe("الاسم القانوني الكامل مطلوب.");
    expect(errorOf(PHONE)).toBe("رقم الهاتف مطلوب.");
    expect(errorOf(ID_NUMBER)).toBe("رقم الهوية أو الجواز مطلوب.");
    expect(errorOf(ID_DOCUMENT)).toBe("صورة الهوية مطلوبة.");
    expect(errorOf(PHOTO)).toBe("يُرجى الانتظار حتى ينتهي رفع الملف.");
    expect(errorOf(BANK)).toBe("اسم البنك مطلوب.");
    expect(errorOf(BRANCH)).toBe("رقم الفرع يتكون من 1 إلى 4 أرقام.");
    expect(errorOf(ACCOUNT)).toBe("رقم الحساب يتكون من 2 إلى 20 رقمًا.");
    expect(errorOf(HOLDER)).toBe("اسم صاحب الحساب مطلوب.");
    const consent = screen.getByRole("checkbox", { name: CONSENT });
    expect(consent.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("الموافقة على إشعار الخصوصية مطلوبة لإرسال الطلب.")).toBeTruthy();
    expect(errorOf(PREFERRED)).toBeNull();
    release();
    expect(await screen.findByText("تم الرفع")).toBeTruthy();
    expect(errorOf(PHOTO)).toBeNull();
    expect(requestsTo(fetchMock, "POST", `${BASE}/redeem`)).toEqual([]);
  });

  it("sends the application with the uploaded files, then confirms it without showing the ID or bank details again", async () => {
    const fetchMock = mockApi(routes());
    renderJoin();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "تم استلام طلبك" });
    const [redeem] = requestsTo(fetchMock, "POST", `${BASE}/redeem`);
    expect(redeem.body).toEqual({
      phoneNumber: "+972501234567",
      fullLegalName: "نادية خوري",
      preferredName: "نادية",
      governmentIdType: "PALESTINIAN_ID",
      governmentIdNumber: "123456789",
      identityDocumentAssetId: "fa-1",
      profilePhotoAssetId: "fa-2",
      bankName: "بنك فلسطين",
      branchNumber: "789",
      accountNumber: "99887766",
      accountHolderName: "نادية خوري",
      consentAccepted: true,
      privacyNoticeVersion: "2026-10",
    });
    expect(requestsTo(fetchMock, "POST", `${BASE}/uploads`).map((request) => (request.body as FormData).get("purpose"))).toEqual([
      "IDENTITY_DOCUMENT",
      "PROFILE_PHOTO",
    ]);
    noAuthorizationHeader(fetchMock);

    // The confirmation: what happens next, and the number to sign in with.
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(`وصل طلب الانضمام إلى ${ORGANIZATION}. شكرًا.`)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "ماذا بعد؟" })).toBeTruthy();
    expect(screen.getByText("يُراجَع الطلب والمستندات لدى صاحب العمل.")).toBeTruthy();
    expect(textOf(screen.getByText(/^بعد الموافقة/))).toBe("بعد الموافقة، يكون تسجيل الدخول إلى تطبيق FieldMaster برقم الهاتف +972501234567.");
    expect(screen.getByText("+972501234567").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    // Nothing the worker typed about their identity or bank is on the page any more.
    expect(document.querySelectorAll("input")).toHaveLength(0);
    for (const sensitive of ["123456789", "99887766", "789", "بنك فلسطين", "id.jpg"]) expect(document.body.textContent).not.toContain(sensitive);
  });

  it("uses the number the invitation fixed, read-only", async () => {
    const fetchMock = mockApi(routes({ [`GET ${BASE}`]: () => json(200, { ...INVITATION, prefilledPhoneNumber: "+972529876543" }) }));
    renderJoin();
    await openForm();

    const phone = input(PHONE);
    expect(phone.readOnly).toBe(true);
    expect(phone.value).toBe("+972529876543");
    expect(screen.getByText("هذا الرقم محدَّد في الدعوة، ويكون تسجيل الدخول إلى التطبيق به.")).toBeTruthy();
    await fillValidFormWithFixedPhone();
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));

    await screen.findByRole("heading", { level: 1, name: "تم استلام طلبك" });
    const body = requestsTo(fetchMock, "POST", `${BASE}/redeem`)[0].body as Record<string, unknown>;
    expect(body.phoneNumber).toBe("+972529876543");
    expect(body.governmentIdType).toBe("ISRAELI_ID");
    expect(body).not.toHaveProperty("preferredName");
    expect(body).not.toHaveProperty("profilePhotoAssetId");
  });

  it("explains the API's upload refusals like its own checks: the server's size limit, a refused type, too many uploads", async () => {
    let uploads = 0;
    mockApi(
      routes({
        [`POST ${BASE}/uploads`]: () => {
          uploads += 1;
          if (uploads === 1) return apiError(413, "FILE_TOO_LARGE", "Too large", { maxBytes: 5 * 1024 * 1024 });
          if (uploads === 2)
            return apiError(415, "FILE_TYPE_NOT_ALLOWED", "Not allowed", { allowedContentTypes: ["image/jpeg", "image/png", "application/pdf"] });
          return apiError(429, "RATE_LIMITED", "Too many files");
        },
      }),
    );
    renderJoin();
    await openForm();

    // The browser called it a JPEG under the limit; the API, reading the content, refused it.
    choose(ID_DOCUMENT, makeFile("scan.jpg", "image/jpeg"));
    expect(await screen.findByText("حجم الملف أكبر من 5 ميغابايت. يُرجى اختيار ملف أصغر.")).toBeTruthy();
    choose(ID_DOCUMENT, makeFile("scan.png", "image/png"));
    expect(await screen.findByText("نوع الملف غير مقبول. المقبول: صورة JPEG أو PNG، أو ملف PDF.")).toBeTruthy();
    choose(ID_DOCUMENT, makeFile("scan-2.png", "image/png"));
    expect(await screen.findByText("تعذّر رفع الملف: عدد الطلبات كبير جدًا. انتظر قليلًا ثم حاول مرة أخرى.")).toBeTruthy();
    expect(input(ID_DOCUMENT).getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByText(/Too large|Not allowed|Too many files/)).toBeNull();
  });

  it("shows the ID number the API refused next to its field, in words for the chosen type, until it is changed", async () => {
    let calls = 0;
    const fetchMock = mockApi(
      routes({
        [`POST ${BASE}/redeem`]: () =>
          ++calls === 1
            ? apiError(400, "VALIDATION_FAILED", "governmentIdNumber is not valid", { field: "governmentIdNumber" })
            : json(201, { submitted: true }),
      }),
    );
    renderJoin();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    await waitFor(() => expect(errorOf(ID_NUMBER)).toBe(PALESTINIAN_INVALID));
    expect(document.activeElement).toBe(input(ID_NUMBER));
    expect(screen.getByRole("alert").textContent).toBe("يُرجى تصحيح الحقول المعلَّمة قبل الإرسال.");
    expect(screen.queryByText("governmentIdNumber is not valid")).toBeNull();
    // Sending again unchanged is stopped on the page.
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect(requestsTo(fetchMock, "POST", `${BASE}/redeem`)).toHaveLength(1);

    type(ID_NUMBER, "987654321");
    expect(errorOf(ID_NUMBER)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect(await screen.findByRole("heading", { level: 1, name: "تم استلام طلبك" })).toBeTruthy();
    expect((requestsTo(fetchMock, "POST", `${BASE}/redeem`)[1].body as Record<string, unknown>).governmentIdNumber).toBe("987654321");
  });

  it("asks for a file again when the API cannot find its upload", async () => {
    let calls = 0;
    const fetchMock = mockApi(
      routes({
        [`POST ${BASE}/redeem`]: () =>
          ++calls === 1 ? apiError(400, "UPLOAD_NOT_FOUND", "Upload not found", { field: "identityDocumentAssetId" }) : json(201, { submitted: true }),
      }),
    );
    renderJoin();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect(await screen.findByText("تعذّر رفع الملف: لم نجد الملف المرفوع. ارفعه مرة أخرى.")).toBeTruthy();
    expect(errorOf(ID_DOCUMENT)).toBe("لم يُرفع هذا الملف. يُرجى اختيار ملف آخر.");
    expect(document.activeElement).toBe(input(ID_DOCUMENT));
    expect(screen.getByRole("alert").textContent).toBe("يُرجى تصحيح الحقول المعلَّمة قبل الإرسال.");
    expect(screen.getAllByText("تم الرفع")).toHaveLength(1);

    choose(ID_DOCUMENT, makeFile("id-again.jpg", "image/jpeg"));
    await waitFor(() => expect(screen.getAllByText("تم الرفع")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect(await screen.findByRole("heading", { level: 1, name: "تم استلام طلبك" })).toBeTruthy();
    expect((requestsTo(fetchMock, "POST", `${BASE}/redeem`)[1].body as Record<string, unknown>).identityDocumentAssetId).toBe("fa-3");
  });

  it("explains a phone number already registered with the employer: on the field when typed, above the button when fixed by the invitation", async () => {
    const conflict = () => apiError(409, "CONFLICT", "This phone number already has a membership in this organization.");
    mockApi(routes({ [`POST ${BASE}/redeem`]: conflict }));
    const view = renderJoin();
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    const taken = "رقم الهاتف هذا مسجّل بالفعل لدى صاحب العمل، فلا يمكن تقديم طلب انضمام جديد به. يُرجى التواصل مع صاحب العمل.";
    await waitFor(() => expect(errorOf(PHONE)).toBe(taken));
    expect(document.activeElement).toBe(input(PHONE));
    // Never the generic "the data changed" text of a 409.
    expect(screen.queryByText(/البيانات تغيّرت/)).toBeNull();
    type(PHONE, "052-765 4321");
    expect(errorOf(PHONE)).toBeNull();
    view.unmount();

    mockApi(routes({ [`GET ${BASE}`]: () => json(200, { ...INVITATION, prefilledPhoneNumber: "+972529876543" }), [`POST ${BASE}/redeem`]: conflict }));
    renderJoin();
    await fillValidFormWithFixedPhone();
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect((await screen.findByRole("alert")).textContent).toBe(taken);
  });

  it("explains a refused fixed number, then shows the bad-link page when the link stopped working", async () => {
    let calls = 0;
    mockApi(
      routes({
        [`GET ${BASE}`]: () => json(200, { ...INVITATION, prefilledPhoneNumber: "+972529876543" }),
        [`POST ${BASE}/redeem`]: () =>
          ++calls === 1
            ? apiError(400, "VALIDATION_FAILED", "phoneNumber must be the phone number the invitation was created for.", { field: "phoneNumber" })
            : apiError(404, "INVITATION_INVALID_OR_EXPIRED", "Invitation not found"),
      }),
    );
    renderJoin();
    await fillValidFormWithFixedPhone();

    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    await waitFor(() => expect(errorOf(PHONE)).toBe("رقم الهاتف لا يطابق الرقم المحدَّد في الدعوة. يُرجى طلب رابط جديد من صاحب العمل."));
    expect(input(NAME).value).toBe("نادية خوري");

    // A refusal the page cannot place on a field is shown translated, never in English.
    calls = 1;
    mockApi(
      routes({
        [`GET ${BASE}`]: () => json(200, { ...INVITATION, prefilledPhoneNumber: "+972529876543" }),
        [`POST ${BASE}/redeem`]: () =>
          ++calls === 2 ? apiError(503, "SERVICE_UNAVAILABLE", "Down") : apiError(404, "INVITATION_INVALID_OR_EXPIRED", "Invitation not found"),
      }),
    );
    cleanupAndRender();
    await fillValidFormWithFixedPhone();
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect((await screen.findByRole("alert")).textContent).toBe("تعذّر إرسال الطلب: الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.");
    fireEvent.click(screen.getByRole("button", { name: "إرسال الطلب" }));
    expect(await screen.findByRole("heading", { level: 1, name: "رابط الانضمام غير صالح" })).toBeTruthy();
    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(within(document.body).queryByText(/Invitation not found|Down|must be the phone/)).toBeNull();
  });
});
