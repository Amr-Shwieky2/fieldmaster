import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareLocales, flatten, glossaryProblems, physicalClassProblems, scriptProblems, usedKeys } from "../lib/i18n-check.mjs";

// Vitest runs with apps/admin-web as the working directory.
const load = (locale) => JSON.parse(readFileSync(join(process.cwd(), "src/i18n/messages", `${locale}.json`), "utf8"));

describe("the real translation files", () => {
  const ar = flatten(load("ar"));
  const en = flatten(load("en"));

  it("have the same keys and placeholders in ar.json and en.json", () => {
    expect(compareLocales(ar, en)).toEqual([]);
  });

  it("contain no Hebrew and no Arabic-Indic digits", () => {
    expect([...scriptProblems(ar, "ar"), ...scriptProblems(en, "en")]).toEqual([]);
  });

  it("use the mandatory Arabic glossary exactly", () => {
    expect(glossaryProblems(ar)).toEqual([]);
  });
});

describe("compareLocales", () => {
  it("reports keys missing on either side, empty values and placeholder drift", () => {
    const problems = compareLocales(
      flatten({ a: { x: "س {name}", y: "ي", empty: "" } }),
      flatten({ a: { x: "X {other}", z: "Z", empty: "E" } }),
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        "a.y: missing in en.json",
        "a.z: missing in ar.json",
        "a.empty: empty or non-string in ar.json",
        expect.stringContaining("a.x: placeholders differ"),
      ]),
    );
  });
});

describe("glossary, script and RTL checks", () => {
  it("flags a glossary term that drifted", () => {
    expect(glossaryProblems({ ...flatten(load("ar")), "enums.OrgRole.OWNER": "صاحب العمل" })).toEqual([
      'enums.OrgRole.OWNER: must be exactly "المالك" (glossary), found "صاحب العمل"',
    ]);
  });

  it("flags Hebrew text and Arabic-Indic digits", () => {
    expect(scriptProblems({ k: "שלום", d: "٣ ساعات" }, "ar")).toHaveLength(2);
  });

  it("flags physical left/right classes but not logical ones or rtl-ok lines", () => {
    const source = ['<div className="ml-2 text-left pe-3 ms-4" />', '<div className="left-0" /> // rtl-ok', '<div className="space-x-2 rtl:space-x-reverse" />'].join("\n");
    expect(physicalClassProblems(source)).toEqual([
      { line: 1, cls: "ml-2" },
      { line: 1, cls: "text-left" },
    ]);
  });

  it("flags negative insets, transform origins and background positions", () => {
    const source = '<span className="absolute -top-1 -right-1 -left-2 origin-top-left bg-right scroll-pl-4 start-0 -end-1" />';
    expect(physicalClassProblems(source).map((p) => p.cls)).toEqual(["-right-1", "-left-2", "origin-top-left", "bg-right", "scroll-pl-4"]);
  });
});

describe("usedKeys", () => {
  it("resolves the namespace of each translator and finds literal and prefix keys", () => {
    const source = [
      'const t = useTranslations("workers");',
      'const tc = useTranslations("common");',
      't("title"); tc("save"); t.rich("intro", {}); t(`status.${s}`);',
    ].join("\n");
    expect(usedKeys(source).map((k) => `${k.key}${k.prefix ? "*" : ""}`)).toEqual(["workers.title", "workers.intro", "workers.status*", "common.save"]);
  });
});
