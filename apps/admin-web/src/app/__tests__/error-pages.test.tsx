import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { renderWithIntl } from "@/test/render-with-intl";
import { INTL_LOCALE, type Locale } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import ErrorPage from "../error";
import NotFound from "../not-found";

const MESSAGES = { ar, en };
let serverLocale: Locale = "ar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: INTL_LOCALE[serverLocale], messages: MESSAGES[serverLocale], namespace: namespace as "states" }),
}));

describe("404 page", () => {
  it.each(["ar", "en"] as const)("renders translated text in %s instead of Next's English page", async (locale) => {
    serverLocale = locale;
    renderWithIntl(await NotFound(), { locale });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(MESSAGES[locale].states.pageNotFoundTitle);
    expect(screen.getByText(MESSAGES[locale].states.pageNotFoundDescription)).toBeTruthy();
    expect(screen.getByRole("link", { name: MESSAGES[locale].states.goToDashboard }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByText(/could not be found/i)).toBeNull();
  });
});

describe("error page", () => {
  it.each(["ar", "en"] as const)("renders translated text in %s and retries", (locale) => {
    const reset = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(<ErrorPage error={new Error("boom")} reset={reset} />, { locale });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(MESSAGES[locale].states.errorTitle);
    expect(screen.getByText(MESSAGES[locale].states.pageErrorDescription)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: MESSAGES[locale].states.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
