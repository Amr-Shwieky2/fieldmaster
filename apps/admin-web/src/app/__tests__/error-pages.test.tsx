import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { renderWithIntl } from "@/test/render-with-intl";
import { INTL_LOCALE } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";
import { renderToStaticMarkup } from "react-dom/server";
import ErrorPage from "../error";
import GlobalError from "../global-error";
import NotFound, { generateMetadata } from "../not-found";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => createTranslator({ locale: INTL_LOCALE, messages: ar, namespace: namespace as "states" }),
}));

/** The removed language switcher rendered these buttons on both pages. */
function expectNoLanguageSwitcher() {
  expect(screen.queryByRole("button", { name: "English" })).toBeNull();
  expect(screen.queryByRole("button", { name: "العربية" })).toBeNull();
  expect(screen.queryByRole("group", { name: "اللغة" })).toBeNull();
}

describe("404 page", () => {
  it("renders Arabic text instead of Next's English page", async () => {
    renderWithIntl(await NotFound());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ar.states.pageNotFoundTitle);
    expect(screen.getByText(ar.states.pageNotFoundDescription)).toBeTruthy();
    expect(screen.getByRole("link", { name: ar.states.goToDashboard }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText(/could not be found/i)).toBeNull();
    expectNoLanguageSwitcher();
  });

  it("uses the Arabic page title", async () => {
    expect((await generateMetadata()).title).toBe(ar.states.pageNotFoundTitle);
  });
});

describe("error page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Arabic text and retries", () => {
    const reset = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    renderWithIntl(<ErrorPage error={error} reset={reset} />);
    expect(consoleError).toHaveBeenCalledWith(error);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(ar.states.errorTitle);
    expect(screen.getByText(ar.states.pageErrorDescription)).toBeTruthy();
    expect(screen.getByRole("link", { name: ar.states.goToDashboard }).getAttribute("href")).toBe("/dashboard");
    // The thrown error's (English) message is logged, never shown.
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.queryByText(/Application error/i)).toBeNull();
    expectNoLanguageSwitcher();
    fireEvent.click(screen.getByRole("button", { name: ar.states.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("global error page (root layout failed)", () => {
  it("renders its own Arabic, right-to-left document", () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error("boom")} reset={() => {}} />);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain(ar.states.errorTitle);
    expect(html).toContain(ar.states.pageErrorDescription);
    expect(html).toContain(ar.states.retry);
    expect(html).not.toMatch(/Application error|boom/);
  });
});
