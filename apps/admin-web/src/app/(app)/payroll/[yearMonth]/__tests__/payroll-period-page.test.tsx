import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { OrgRole } from "@fieldmaster/shared-types";
import {
  OWNER_NAME,
  UUID,
  apiError,
  detail,
  finalizedDetail,
  json,
  latinWordsOnPage,
  mockApi,
  renderPeriodPage,
  reopenedDetail,
  requestsTo,
  run,
  seedSession,
  textOf,
} from "@/components/payroll/__tests__/payroll-test-utils";

// The URL is state: `router.replace` / `push` change what `useSearchParams` returns, and the page re-renders.
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { search: "" };
  const go = (url: string) => {
    const query = url.indexOf("?");
    state.search = query === -1 ? "" : url.slice(query + 1);
    for (const listener of listeners) listener();
  };
  return {
    state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace: vi.fn((url: string, _options?: { scroll?: boolean }) => go(url)),
    push: vi.fn((url: string) => go(url)),
  };
});
vi.mock("next/navigation", async () => {
  const { useMemo, useSyncExternalStore } = await import("react");
  return {
    useRouter: () => ({ replace: nav.replace, push: nav.push, refresh: () => {}, back: () => {}, prefetch: () => {} }),
    usePathname: () => "/payroll/2026-09",
    useParams: () => ({ yearMonth: "2026-09" }),
    useSearchParams: () => {
      const search = useSyncExternalStore(
        nav.subscribe,
        () => nav.state.search,
        () => nav.state.search,
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});

const LATEST = "/payroll-periods/2026-09";
const CALCULATION = "/payroll-periods/2026-09/calculation";

describe("Payroll month page", () => {
  beforeEach(() => {
    nav.state.search = "";
    nav.replace.mockClear();
    nav.push.mockClear();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the latest version: title, status, version, the allowed actions, a summary with LTR money and Arabic-only text", async () => {
    seedSession(OrgRole.OWNER);
    const fetchMock = mockApi({ [`GET ${LATEST}`]: () => json(200, detail()) });
    renderPeriodPage();

    expect(await screen.findByRole("heading", { level: 1, name: /رواتب سبتمبر 2026/ })).toBeTruthy();
    expect(screen.getByText("قيد المراجعة")).toBeTruthy();
    expect(screen.getByText("الإصدار 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى الرواتب" }).getAttribute("href")).toBe("/payroll");
    // allowedActions: calculate and finalize, not reopen; any calculated version can be exported.
    expect(screen.getByRole("button", { name: "احسب" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "اعتمد نهائياً" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "أعد فتح" })).toBeNull();
    expect(screen.getByRole("button", { name: "تصدير CSV" })).toBeTruthy();

    // The summary: the net, rendered left-to-right inside the Arabic sentence, who calculated it and how the version started.
    const net = screen.getByText("إجمالي الصافي:", { exact: false });
    expect(net.textContent).toBe("إجمالي الصافي: ₪ 9,783.00");
    expect(within(net).getByText("₪ 9,783.00").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("العمال: 2")).toBeTruthy();
    expect(textOf(screen.getByText(/^آخر احتساب:/))).toBe(`آخر احتساب: 2 أكتوبر 2026 في 11:30 بواسطة ${OWNER_NAME}`);
    expect(textOf(screen.getByText(/^أُعيد فتحه بواسطة/))).toBe(`أُعيد فتحه بواسطة ${OWNER_NAME} في 1 أكتوبر 2026 في 10:00 — السبب: تصحيح ساعات سامي`);

    // Tabs, kept in the URL: the workers first.
    const tabs = within(screen.getByRole("tablist", { name: "تفاصيل رواتب الإصدار" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["العمال", "المشاريع", "المواقع", "التعديلات", "الإصدارات"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tabs[0].id);

    // No banners for a clean calculation; nothing running, nothing failed.
    expect(screen.queryAllByRole("note")).toEqual([]);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // Only the latest version was requested (no polling when nothing runs, no version history until its tab opens).
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname.replace(/^.*\/api\/v1/, ""))).toEqual([LATEST]);

    // No raw enum values or Arabic-Indic digits; the only Latin text is a worker's name and "CSV".
    expect(screen.queryByText("REVIEW")).toBeNull();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    expect(screen.queryByRole("button", { name: /English/ })).toBeNull();
    expect(latinWordsOnPage()).toEqual({ text: ["CSV", "Eli", "Ramzani"], attributes: [] });
  });

  it("shows only the reopen action on a finalized version, with who finalized it and when", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ [`GET ${LATEST}`]: () => json(200, finalizedDetail()) });
    renderPeriodPage();

    expect(await screen.findByRole("button", { name: "أعد فتح" })).toBeTruthy();
    expect(screen.getByText("معتمدة نهائياً")).toBeTruthy();
    expect(screen.queryByText("FINALIZED")).toBeNull();
    expect(screen.queryByRole("button", { name: "احسب" })).toBeNull();
    expect(screen.queryByRole("button", { name: "اعتمد نهائياً" })).toBeNull();
    expect(screen.getByRole("button", { name: "تصدير CSV" })).toBeTruthy();
    expect(textOf(screen.getByText(/^الاعتماد النهائي:/))).toBe(`الاعتماد النهائي: 3 أكتوبر 2026 في 15:00 بواسطة ${OWNER_NAME}`);
  });

  it("shows a loading state, then a translated error with retry", async () => {
    seedSession(OrgRole.OWNER);
    let calls = 0;
    let release: () => void = () => {};
    mockApi({
      [`GET ${LATEST}`]: () =>
        ++calls === 1 ? new Promise<Response>((resolve) => (release = () => resolve(apiError(503, "SERVICE_UNAVAILABLE")))) : json(200, detail()),
    });
    renderPeriodPage();

    expect(await screen.findByText("جارٍ التحميل…")).toBeTruthy();
    release();
    expect((await screen.findByRole("alert")).textContent).toContain("الخدمة غير متاحة مؤقتًا. يُرجى المحاولة بعد قليل.");
    expect(screen.queryByText("English API message")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByRole("heading", { level: 1, name: /رواتب سبتمبر 2026/ })).toBeTruthy();
    expect(calls).toBe(2);
  });

  it("shows the access-denied state on 403", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ [`GET ${LATEST}`]: () => apiError(403, "FORBIDDEN") });
    renderPeriodPage();

    expect(await screen.findByText("غير مصرّح بالوصول")).toBeTruthy();
    expect(screen.getByRole("link", { name: "الانتقال إلى لوحة التحكم" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText("English API message")).toBeNull();
    expect(screen.queryByRole("button", { name: "احسب" })).toBeNull();
  });

  it("offers to calculate a month that was never calculated (404) and then shows the calculation's progress", async () => {
    seedSession(OrgRole.OWNER);
    const queued = run({ id: "run-1", version: 1, state: "QUEUED", progress: 0, processedWorkers: 0, totalWorkers: 4, startedAt: null, finishedAt: null });
    let calculated = false;
    const fetchMock = mockApi({
      [`GET ${LATEST}`]: () =>
        calculated
          ? json(
              200,
              detail({
                version: 1,
                status: "CALCULATING",
                previousVersion: null,
                reopenedAt: null,
                reopenedByName: null,
                reopenReason: null,
                calculatedAt: null,
                calculatedByName: null,
                calculation: queued,
                totals: null,
                workers: [],
                allowedActions: { calculate: false, finalize: false, reopen: false, addAdjustment: true },
              }),
            )
          : apiError(404, "NOT_FOUND", "Payroll period not found."),
      [`POST ${LATEST}/calculate`]: () => {
        calculated = true;
        return json(202, queued);
      },
      [`GET ${CALCULATION}`]: () => json(200, { ...queued, state: "RUNNING", progress: 25, processedWorkers: 1 }),
    });
    renderPeriodPage();

    expect(await screen.findByText("لم تُحتسب رواتب هذا الشهر بعد")).toBeTruthy();
    expect(screen.getByText("اضغط «احسب» لاحتساب رواتب هذا الشهر من الحضور المعتمد.")).toBeTruthy();
    expect(screen.queryByText("Payroll period not found.")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "رواتب سبتمبر 2026" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "العودة إلى الرواتب" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "احسب" }));
    const progress = await screen.findByRole("progressbar", { name: "تقدّم احتساب الرواتب" });
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    const [request] = requestsTo(fetchMock, "POST", `${LATEST}/calculate`);
    expect(request.headers["Idempotency-Key"]).toMatch(UUID);
    expect(await screen.findByText("الإصدار 1")).toBeTruthy();
    expect(screen.getByText("قيد الاحتساب")).toBeTruthy();
    // The calculation is polled while it runs.
    await waitFor(() => expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25"));
    expect(screen.getByText("1 من 4 عمال")).toBeTruthy();
  });

  it("on a month never calculated, a calculation already started elsewhere (409) is explained and its progress then shown", async () => {
    seedSession(OrgRole.OWNER);
    const elsewhere = run({ id: "run-5", version: 1, state: "RUNNING", progress: 30, processedWorkers: 3, totalWorkers: 10, finishedAt: null });
    let started = false;
    const running = detail({
      version: 1,
      status: "CALCULATING",
      calculation: elsewhere,
      totals: null,
      workers: [],
      allowedActions: { calculate: false, finalize: false, reopen: false, addAdjustment: true },
    });
    mockApi({
      // The refetch after the 409 answers a little later, so the explanation is on screen first.
      [`GET ${LATEST}`]: () => (started ? new Promise<Response>((resolve) => setTimeout(() => resolve(json(200, running)), 100)) : apiError(404, "NOT_FOUND")),
      [`POST ${LATEST}/calculate`]: () => {
        started = true;
        return apiError(409, "PAYROLL_CALCULATION_IN_PROGRESS");
      },
      [`GET ${CALCULATION}`]: () => json(200, elsewhere),
    });
    renderPeriodPage();

    fireEvent.click(await screen.findByRole("button", { name: "احسب" }));
    expect(await screen.findByText("يجري احتساب رواتب هذا الشهر الآن. انتظر حتى ينتهي ثم حاول مرة أخرى.")).toBeTruthy();
    expect((await screen.findByRole("progressbar")).getAttribute("aria-valuenow")).toBe("30");
    expect(screen.getByText("3 من 10 عمال")).toBeTruthy();
    expect(screen.queryByText("لم تُحتسب رواتب هذا الشهر بعد")).toBeNull();
  });

  it("polls a running calculation about every second until it succeeds, then shows the new results and stops polling", async () => {
    seedSession(OrgRole.OWNER);
    const running = run({ state: "RUNNING", progress: 20, processedWorkers: 1, totalWorkers: 5, finishedAt: null });
    let finished = false;
    let polls = 0;
    const fetchMock = mockApi({
      [`GET ${LATEST}`]: () =>
        json(
          200,
          finished
            ? detail({ calculation: run({ processedWorkers: 5, totalWorkers: 5 }) })
            : detail({
                status: "CALCULATING",
                calculation: running,
                allowedActions: { calculate: false, finalize: false, reopen: false, addAdjustment: true },
              }),
        ),
      [`GET ${CALCULATION}`]: () => {
        polls += 1;
        if (polls === 1) return json(200, { ...running, progress: 60, processedWorkers: 3 });
        finished = true;
        return json(200, run({ processedWorkers: 5, totalWorkers: 5 }));
      },
    });
    renderPeriodPage();

    // Running: a progress bar with the percentage and the workers processed (Arabic plural), no actions that would conflict.
    expect(await screen.findByText("3 من 5 عمال")).toBeTruthy();
    const progress = screen.getByRole("progressbar", { name: "تقدّم احتساب الرواتب" });
    expect(progress.getAttribute("aria-valuenow")).toBe("60");
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-valuetext")).toBe("60%، 3 من 5");
    expect(screen.getByText("60%").closest("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("جارٍ احتساب الرواتب…")).toBeTruthy();
    expect(screen.getByText("قيد الاحتساب")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "اعتمد نهائياً" })).toBeNull();

    // About a second later the run has succeeded: the month is refetched and the results replace the progress.
    const done = await screen.findByText("اكتمل احتساب الرواتب.", {}, { timeout: 3000 });
    expect(done.getAttribute("role")).toBe("status");
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(await screen.findByText("قيد المراجعة")).toBeTruthy();
    expect(screen.getByRole("button", { name: "اعتمد نهائياً" })).toBeTruthy();
    expect(polls).toBe(2);
    expect(requestsTo(fetchMock, "GET", LATEST)).toHaveLength(2);

    // Finished: no more polling.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(polls).toBe(2);
  });

  it("shows a failed calculation as an error with its translated reason and calculates again on request", async () => {
    seedSession(OrgRole.OWNER);
    const failed = run({ state: "FAILED", progress: 40, processedWorkers: 2, totalWorkers: 5, errorCode: "PAYROLL_CALCULATION_STALE" });
    const retried = run({
      id: "run-2",
      state: "QUEUED",
      progress: 0,
      processedWorkers: 0,
      totalWorkers: 0,
      requestedAt: "2026-10-13T09:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    });
    let retriedOnce = false;
    const fetchMock = mockApi({
      [`GET ${LATEST}`]: () =>
        json(
          200,
          retriedOnce
            ? detail({ status: "CALCULATING", calculation: { ...retried, state: "RUNNING" } })
            : detail({ status: "OPEN", calculation: failed, calculatedAt: null, totals: null, workers: [] }),
        ),
      [`POST ${LATEST}/calculate`]: () => {
        retriedOnce = true;
        return json(202, retried);
      },
      [`GET ${CALCULATION}`]: () => json(200, { ...retried, state: "RUNNING", progress: 10 }),
    });
    renderPeriodPage();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("تعذّر احتساب الرواتب")).toBeTruthy();
    expect(within(alert).getByText("توقف هذا الاحتساب قبل أن يكتمل، فحلّ محله احتساب جديد.")).toBeTruthy();
    expect(textOf(within(alert).getByText(/^توقف الاحتساب في/))).toBe("توقف الاحتساب في 2 أكتوبر 2026 في 11:30.");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText("PAYROLL_CALCULATION_STALE")).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: "احسب مرة أخرى" }));
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    expect(await screen.findByText("بدأ احتساب الرواتب.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("تعذّر احتساب الرواتب")).toBeNull());
    const [request] = requestsTo(fetchMock, "POST", `${LATEST}/calculate`);
    expect(request.headers["Idempotency-Key"]).toMatch(UUID);
  });

  it("falls back to the general calculation failure message for an unknown error code", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ [`GET ${LATEST}`]: () => json(200, detail({ calculation: run({ state: "FAILED", errorCode: "SOMETHING_NEW", finishedAt: null }) })) });
    renderPeriodPage();

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("تعذّر احتساب الرواتب بسبب خطأ غير متوقع. حاول مرة أخرى.")).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "احسب مرة أخرى" })).toBeTruthy();
  });

  it("explains that a calculation is already running (409) and shows its progress", async () => {
    seedSession(OrgRole.OWNER);
    const elsewhere = run({
      id: "run-7",
      state: "RUNNING",
      progress: 50,
      processedWorkers: 1,
      totalWorkers: 2,
      requestedAt: "2026-10-13T08:00:00.000Z",
      finishedAt: null,
    });
    let conflict = false;
    mockApi({
      [`GET ${LATEST}`]: () =>
        json(
          200,
          conflict
            ? detail({
                status: "CALCULATING",
                calculation: elsewhere,
                allowedActions: { calculate: false, finalize: false, reopen: false, addAdjustment: true },
              })
            : detail(),
        ),
      [`POST ${LATEST}/calculate`]: () => {
        conflict = true;
        return apiError(409, "PAYROLL_CALCULATION_IN_PROGRESS", "A calculation is already running.");
      },
      [`GET ${CALCULATION}`]: () => json(200, elsewhere),
    });
    renderPeriodPage();

    fireEvent.click(await screen.findByRole("button", { name: "احسب" }));
    expect((await screen.findByRole("alert")).textContent).toBe("يجري احتساب رواتب هذا الشهر الآن. انتظر حتى ينتهي ثم حاول مرة أخرى.");
    expect(screen.queryByText(/already running/)).toBeNull();
    expect((await screen.findByRole("progressbar")).getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("1 من 2 عاملين")).toBeTruthy();
  });

  it("finalizes only after a confirmation, then shows the finalized version and the reopen action", async () => {
    seedSession(OrgRole.OWNER);
    let finalized = false;
    let release: () => void = () => {};
    const fetchMock = mockApi({
      [`GET ${LATEST}`]: () => json(200, finalized ? finalizedDetail() : detail()),
      [`POST ${LATEST}/finalize`]: () =>
        new Promise<Response>((resolve) => {
          release = () => {
            finalized = true;
            resolve(json(201, finalizedDetail()));
          };
        }),
    });
    renderPeriodPage();

    const finalize = await screen.findByRole("button", { name: "اعتمد نهائياً" });
    expect(finalize.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(finalize);
    // A confirmation first: after finalizing, the version never changes.
    const confirmation = screen.getByRole("region", { name: "اعتماد رواتب سبتمبر 2026 نهائياً (الإصدار 2)؟" });
    expect(finalize.getAttribute("aria-expanded")).toBe("true");
    expect(finalize.getAttribute("aria-controls")).toBe(confirmation.id);
    expect(
      within(confirmation).getByText(
        "بعد الاعتماد النهائي لا يتغيّر هذا الإصدار. لتعديل الرواتب لاحقاً أعد فتحها، فيُنشأ إصدار جديد ويبقى هذا الإصدار محفوظاً للقراءة.",
      ),
    ).toBeTruthy();
    expect(requestsTo(fetchMock, "POST", `${LATEST}/finalize`)).toHaveLength(0);

    // Cancel sends nothing.
    fireEvent.click(within(confirmation).getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByRole("region", { name: /^اعتماد رواتب/ })).toBeNull();
    expect(requestsTo(fetchMock, "POST", `${LATEST}/finalize`)).toHaveLength(0);

    fireEvent.click(finalize);
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الاعتماد النهائي" }));
    expect(((await screen.findByRole("button", { name: "جارٍ الاعتماد النهائي…" })) as HTMLButtonElement).disabled).toBe(true);
    release();

    const message = await screen.findByText("اعتُمدت رواتب سبتمبر 2026 نهائياً (الإصدار 2).");
    expect(message.getAttribute("role")).toBe("status");
    expect(message.closest("[aria-live]")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "أعد فتح" })).toBeTruthy();
    expect(screen.getByText("معتمدة نهائياً")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "اعتمد نهائياً" })).toBeNull();
    expect(requestsTo(fetchMock, "POST", `${LATEST}/finalize`)).toHaveLength(1);
  });

  it("reopens only with a written reason, sends it trimmed and shows the new version as the latest", async () => {
    seedSession(OrgRole.OWNER);
    let reopened = false;
    const fetchMock = mockApi({
      [`GET ${LATEST}`]: () => json(200, reopened ? reopenedDetail() : finalizedDetail()),
      [`POST ${LATEST}/reopen`]: () => {
        reopened = true;
        return json(201, reopenedDetail());
      },
    });
    renderPeriodPage();

    const reopen = await screen.findByRole("button", { name: "أعد فتح" });
    fireEvent.click(reopen);
    expect(reopen.getAttribute("aria-expanded")).toBe("true");
    const reason = screen.getByLabelText("سبب إعادة الفتح");
    expect(reopen.getAttribute("aria-controls")).toBe(reason.closest("form")?.id);
    expect(screen.getByText("السبب مطلوب ويُحفظ مع الإصدار الجديد في سجل الإصدارات. يبقى الإصدار المعتمد كما هو للقراءة.")).toBeTruthy();

    // A blank reason is refused before any request.
    fireEvent.change(reason, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إعادة الفتح" }));
    expect(await screen.findByText("اكتب السبب قبل المتابعة.")).toBeTruthy();
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(requestsTo(fetchMock, "POST", `${LATEST}/reopen`)).toHaveLength(0);

    fireEvent.change(reason, { target: { value: "  تصحيح ساعات سامي  " } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إعادة الفتح" }));

    expect(await screen.findByText("أُعيد فتح الرواتب: الإصدار 3 هو الإصدار الحالي الآن، والإصدار 2 المعتمد محفوظ للقراءة.")).toBeTruthy();
    expect(requestsTo(fetchMock, "POST", `${LATEST}/reopen`).map((request) => request.body)).toEqual([{ reason: "تصحيح ساعات سامي" }]);
    // The new version is the working one: not calculated yet, it may be calculated.
    expect(screen.getByText("الإصدار 3")).toBeTruthy();
    expect(screen.getByText("مفتوحة")).toBeTruthy();
    expect(screen.getByRole("button", { name: "احسب" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "أعد فتح" })).toBeNull();
    expect(screen.queryByRole("button", { name: "تصدير CSV" })).toBeNull();
    expect(screen.getAllByText("لم يُحتسب هذا الإصدار بعد").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("سبب إعادة الفتح")).toBeNull();
  });

  it("translates a refused reopen", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({
      [`GET ${LATEST}`]: () => json(200, finalizedDetail()),
      [`POST ${LATEST}/reopen`]: () => apiError(409, "PAYROLL_PERIOD_NOT_FINALIZED", "Period is not finalized."),
    });
    renderPeriodPage();

    fireEvent.click(await screen.findByRole("button", { name: "أعد فتح" }));
    fireEvent.change(screen.getByLabelText("سبب إعادة الفتح"), { target: { value: "تصحيح" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد إعادة الفتح" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("يمكن إعادة فتح رواتب الشهر بعد اعتمادها نهائياً فقط."));
    expect(screen.queryByText("Period is not finalized.")).toBeNull();
  });

  it("shows an earlier version read-only, with a link to the current version and the tab kept with the version in the URL", async () => {
    seedSession(OrgRole.OWNER);
    nav.state.search = "version=1";
    // Even if the API listed actions, an earlier version offers none.
    const old = finalizedDetail({
      id: "pv-1",
      version: 1,
      isCurrent: false,
      reopenedAt: null,
      reopenedByName: null,
      reopenReason: null,
      previousVersion: null,
      createdAt: "2026-09-30T15:00:00.000Z",
      allowedActions: { calculate: true, finalize: true, reopen: true, addAdjustment: true },
    });
    const fetchMock = mockApi({ "GET /payroll-periods/2026-09/versions/1": () => json(200, old) });
    renderPeriodPage();

    const banner = await screen.findByRole("note");
    expect(within(banner).getByText("تعرض الإصدار 1 — إصدار سابق للقراءة فقط")).toBeTruthy();
    expect(within(banner).getByRole("link", { name: "عرض الإصدار الحالي" }).getAttribute("href")).toBe("/payroll/2026-09");
    expect(screen.getByText("الإصدار 1")).toBeTruthy();
    for (const action of ["احسب", "اعتمد نهائياً", "أعد فتح"]) expect(screen.queryByRole("button", { name: action })).toBeNull();
    // Reading and exporting stay available.
    expect(screen.getByRole("button", { name: "تصدير CSV" })).toBeTruthy();
    expect(textOf(screen.getByText(/^أُنشئ بواسطة/))).toBe(`أُنشئ بواسطة ${OWNER_NAME} في 30 سبتمبر 2026 في 18:00`);

    fireEvent.click(screen.getByRole("tab", { name: "التعديلات" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/payroll/2026-09?version=1&tab=adjustments", { scroll: false });
    expect((await screen.findByRole("tab", { name: "التعديلات" })).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("heading", { name: "إضافة تعديل يدوي" })).toBeNull();
    expect(within(banner).getByRole("link", { name: "عرض الإصدار الحالي" }).getAttribute("href")).toBe("/payroll/2026-09?tab=adjustments");

    // Only that version was read: not the latest, and no calculation polling.
    expect(requestsTo(fetchMock, "GET", LATEST)).toHaveLength(0);
    expect(requestsTo(fetchMock, "GET", CALCULATION)).toHaveLength(0);
  });

  it("says when the requested version does not exist", async () => {
    seedSession(OrgRole.OWNER);
    nav.state.search = "version=9";
    mockApi({ "GET /payroll-periods/2026-09/versions/9": () => apiError(404, "NOT_FOUND", "Version not found.") });
    renderPeriodPage();

    expect(await screen.findByText("لم نعثر على هذا الإصدار")).toBeTruthy();
    expect(screen.getByRole("link", { name: "عرض الإصدار الحالي" }).getAttribute("href")).toBe("/payroll/2026-09");
    expect(screen.queryByRole("button", { name: "احسب" })).toBeNull();
    expect(screen.queryByText("Version not found.")).toBeNull();
  });

  it("warns about changes since the calculation, unpaid entries without compensation, pending entries and legacy versions", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({
      [`GET ${LATEST}`]: () =>
        json(
          200,
          detail({
            changedSinceCalculation: true,
            legacy: true,
            warnings: {
              workersWithoutCompensation: [{ workerProfileId: "wp-2", fullLegalName: "سامي حداد", entries: 2, businessDates: ["2026-09-03", "2026-09-04"] }],
            },
            pending: {
              entries: 3,
              byWorker: [
                { workerProfileId: "wp-1", fullLegalName: "Eli Ramzani", entries: 1 },
                { workerProfileId: "wp-2", fullLegalName: "سامي حداد", entries: 2 },
              ],
            },
          }),
        ),
    });
    renderPeriodPage();

    await screen.findByRole("heading", { level: 1, name: /رواتب سبتمبر 2026/ });
    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(4);
    const [changed, noCompensation, pending, legacy] = notes;

    expect(textOf(changed)).toBe("تغيّرت بيانات الشهر بعد آخر احتساب — أعد الاحتساب قبل الاعتماد النهائي");

    // Approved entries without a compensation profile are not paid: who, how many, which days (not blocking).
    expect(within(noCompensation).getByText("إدخالات معتمدة بلا أجر ساري — لم تُدفع")).toBeTruthy();
    const unpaid = within(within(noCompensation).getByRole("list", { name: "العمال الذين لديهم إدخالات معتمدة بلا أجر ساري" })).getAllByRole("listitem")[0];
    expect(within(unpaid).getByRole("link", { name: "سامي حداد" }).getAttribute("href")).toBe("/workers/wp-2");
    expect(within(unpaid).getByText("إدخالان")).toBeTruthy();
    const dates = within(unpaid).getByRole("list", { name: "تواريخ الإدخالات بلا أجر ساري لـسامي حداد" });
    expect(within(dates).getAllByRole("listitem").map(textOf)).toEqual(["3 سبتمبر 2026", "4 سبتمبر 2026"]);
    expect(screen.getByRole("button", { name: "اعتمد نهائياً" })).toBeTruthy();

    // Entries waiting for approval: excluded, with a count and the list per worker.
    expect(within(pending).getByText("بانتظار الموافقة — غير محسوبة: 3")).toBeTruthy();
    const perWorker = within(within(pending).getByRole("list", { name: "الإدخالات بانتظار الموافقة لكل عامل" })).getAllByRole("listitem");
    expect(perWorker).toHaveLength(2);
    expect(within(perWorker[0]).getByText("Eli Ramzani")).toBeTruthy();
    expect(within(perWorker[0]).getByText("إدخال واحد")).toBeTruthy();
    expect(within(perWorker[1]).getByText("سامي حداد")).toBeTruthy();
    expect(within(perWorker[1]).getByText("إدخالان")).toBeTruthy();
    const review = within(perWorker[1]).getByRole("link", { name: "مراجعة في الحضور: إدخالات سامي حداد" });
    expect(review.textContent).toBe("مراجعة في الحضور");
    expect(review.getAttribute("href")).toBe("/attendance?workerProfileId=wp-2&from=2026-09-01&to=2026-09-30");

    expect(textOf(legacy)).toBe("إصدار من قبل حفظ التفاصيل: تُعرض البيانات المحفوظة فقط");
  });

  it("downloads the version as a CSV file named after the month and version", async () => {
    seedSession(OrgRole.OWNER);
    mockApi({ [`GET ${LATEST}`]: () => json(200, detail()) });
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:payroll-export";
    });
    const revokeObjectURL = vi.fn();
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    onTestFinished(() => {
      Object.assign(URL, original);
    });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    renderPeriodPage();

    fireEvent.click(await screen.findByRole("button", { name: "تصدير CSV" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("payroll-2026-09-v2.csv");
    expect(clicked[0].getAttribute("href")).toBe("blob:payroll-export");
    // The link is temporary.
    expect(document.querySelector("a[download]")).toBeNull();
    const [blob] = blobs;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await readBlob(blob));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder("utf-8").decode(bytes).split("\r\n");
    expect(lines[0]).toBe(
      "العامل,الورديات المعتمدة,الأيام المحتسبة,الدقائق العادية,الدقائق الإضافية,دقائق الطوارئ قبل البدء,دقائق الطوارئ بعد الإنهاء,الأجر الأساسي,أجر الساعات الإضافية,إضافات,خصم نسيان التسجيل,إلغاء خصومات,خصومات أخرى,الصافي",
    );
    expect(lines.slice(1)).toEqual([
      "Eli Ramzani,21,21,10080,150,60,15,8400.00,123.50,50.00,-25.00,0.00,0.00,8548.50",
      "سامي حداد,3,3,1440,0,0,0,1234.50,0.00,0.00,-25.00,25.00,0.00,1234.50",
      "الإجمالي,24,24,11520,150,60,15,9634.50,123.50,50.00,-50.00,25.00,0.00,9783.00",
      "",
    ]);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:payroll-export"));
  });

  it("never loads or renders payroll for a Field Manager and redirects to the dashboard", async () => {
    seedSession(OrgRole.FIELD_MANAGER);
    const fetchMock = mockApi({ [`GET ${LATEST}`]: () => json(200, detail()) });
    renderPeriodPage();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText(/₪/)).toBeNull();
    expect(screen.queryByText("Eli Ramzani")).toBeNull();
    expect(screen.queryByRole("heading", { name: /رواتب/ })).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "تصدير CSV" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** A Blob's bytes, read with jsdom's FileReader. */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
