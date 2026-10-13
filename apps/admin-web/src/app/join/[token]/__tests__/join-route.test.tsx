import { describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";

// The route is a server component: its metadata come from the Arabic messages through next-intl/server.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { INTL_LOCALE } = await import("@fieldmaster/i18n");
  const messages = (await import("@/i18n/messages")).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: INTL_LOCALE, messages, namespace: namespace as never }) };
});

import JoinRoute, { generateMetadata } from "../page";
import { JoinPage } from "@/components/join/join-page";

describe("/join/[token] route", () => {
  it("has an Arabic title and description, and is kept out of search engines and referrers", async () => {
    expect(await generateMetadata()).toEqual({
      title: "الانضمام إلى فريق العمل — FieldMaster",
      description: "طلب الانضمام: البيانات الشخصية والهوية والحساب البنكي.",
      robots: { index: false, follow: false },
      referrer: "no-referrer",
    });
  });

  it("renders the public join page with the token from the URL", async () => {
    const element = await JoinRoute({ params: Promise.resolve({ token: "tok-123" }) });
    expect(isValidElement(element)).toBe(true);
    expect(element.type).toBe(JoinPage);
    expect(element.props).toEqual({ token: "tok-123" });
  });
});
