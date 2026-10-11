import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHARED_GLOSSARY,
  apiErrorCodes,
  apiErrorCodesFromDir,
  arabicOnlyProblems,
  emptyValueProblems,
  flatten,
  glossaryProblems,
  mergeTrees,
  messageFileProblems,
  overlapProblems,
  physicalClassProblems,
  physicalStyleProblems,
  scriptProblems,
  untranslatedErrorCodes,
  usedKeys,
  visibleText,
} from "../i18n-check.mjs";

// Vitest runs with packages/i18n as the working directory.
const messagesDir = join(process.cwd(), "src/messages");
const load = () => JSON.parse(readFileSync(join(messagesDir, "ar.json"), "utf8"));

describe("the real shared translation file", () => {
  const ar = flatten(load());

  it("is the only messages file (the apps are Arabic only)", () => {
    expect(readdirSync(messagesDir)).toEqual(["ar.json"]);
    expect(messageFileProblems(messagesDir)).toEqual([]);
  });

  it("has no empty values and reads in Arabic everywhere", () => {
    expect([...emptyValueProblems(ar), ...arabicOnlyProblems(ar, new Set())]).toEqual([]);
  });

  it("contains no Hebrew and no Arabic-Indic digits", () => {
    expect(scriptProblems(ar)).toEqual([]);
  });

  it("uses the shared part of the mandatory Arabic glossary exactly", () => {
    expect(glossaryProblems(ar, SHARED_GLOSSARY)).toEqual([]);
  });
});

describe("arabicOnlyProblems", () => {
  it("flags English leftovers, including inside plural branches, but not Arabic with codes or pure placeholders", () => {
    const problems = arabicOnlyProblems(
      flatten({
        a: {
          english: "Workers",
          englishPlural: "{count, plural, one {# worker} other {# workers}}",
          mixed: "رمز SMS للتحقق من {phone}",
          onlyPlaceholders: "({count})",
          arabicPlural: "{count, plural, one {عامل واحد} other {# عامل}}",
          tagged: "<b>{name}</b> سجّل الدخول",
        },
        shell: { brand: "FieldMaster" },
      }),
    );
    expect(problems).toEqual([expect.stringContaining("a.english: not Arabic"), expect.stringContaining("a.englishPlural: not Arabic")]);
  });

  it("strips argument names, selectors and tags from the visible text", () => {
    expect(visibleText("{count, plural, one {# worker} other {# workers}}")).toMatch(/worker/);
    expect(visibleText("<b>{name}</b> ({count})")).not.toMatch(/[A-Za-z]/);
  });
});

describe("emptyValueProblems", () => {
  it("reports empty and non-string values", () => {
    expect(emptyValueProblems({ "a.x": "", "a.y": "  ", "a.z": "س" })).toEqual(["a.x: empty or non-string in ar.json", "a.y: empty or non-string in ar.json"]);
  });
});

describe("API error codes", () => {
  it("collects ErrorCodes values, literal AppException codes and the filter's codes", () => {
    const sources = [
      'export const ErrorCodes = {\n  NOT_FOUND: "NOT_FOUND",\n  GPS_ACCURACY_TOO_LOW: "GPS_ACCURACY_TOO_LOW",\n} as const;',
      'throw new AppException(429, "OTP_RATE_LIMITED", "Too many.");',
      '        code: status === 401 ? "UNAUTHENTICATED" : "ERROR",',
    ];
    expect(apiErrorCodes(sources)).toEqual(["ERROR", "GPS_ACCURACY_TOO_LOW", "NOT_FOUND", "OTP_RATE_LIMITED", "UNAUTHENTICATED"]);
  });

  it("reports a code without an Arabic message", () => {
    expect(untranslatedErrorCodes(["NOT_FOUND", "BRAND_NEW"], { "errors.NOT_FOUND": "غير موجود" })).toEqual([
      "errors.BRAND_NEW: the API sends this code but ar.json has no message for it",
    ]);
  });

  it("finds every code the real API sends translated in ar.json", () => {
    const apiDir = join(process.cwd(), "../../apps/api/src");
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(join(dir, entry.name));
        } else if (/\.ts$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name)) files.push(join(dir, entry.name));
      }
    };
    walk(apiDir);
    const codes = apiErrorCodes(files.map((file) => readFileSync(file, "utf8")));
    expect(codes).toEqual(expect.arrayContaining(["GEOFENCE_OUTSIDE_ALLOWED_RADIUS", "OTP_RATE_LIMITED", "UNAUTHENTICATED", "ERROR", "INTERNAL_ERROR"]));
    expect(untranslatedErrorCodes(codes, flatten(load()))).toEqual([]);
  });
});

describe("glossary, script and RTL checks", () => {
  it("flags a glossary term that drifted", () => {
    expect(glossaryProblems({ ...flatten(load()), "enums.OrgRole.OWNER": "صاحب العمل" }, SHARED_GLOSSARY)).toEqual([
      'enums.OrgRole.OWNER: must be exactly "المالك" (glossary), found "صاحب العمل"',
    ]);
  });

  it("flags Hebrew text and Arabic-Indic digits", () => {
    expect(scriptProblems({ k: "שלום", d: "٣ ساعات" })).toHaveLength(2);
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

describe("shared + app messages", () => {
  it("flags an app key that redefines a shared one, and merges the rest", () => {
    const shared = { auth: { phoneLabel: "رقم الهاتف" } };
    const app = { auth: { subtitle: "تسجيل دخول العامل", phoneLabel: "الهاتف" } };
    expect(overlapProblems(flatten(shared), flatten(app), "mobile app")).toEqual([
      "auth.phoneLabel: defined in both @fieldmaster/i18n and the mobile app's ar.json -- keep it in one place",
    ]);
    expect(mergeTrees(shared, { auth: { subtitle: "تسجيل دخول العامل" } })).toEqual({ auth: { phoneLabel: "رقم الهاتف", subtitle: "تسجيل دخول العامل" } });
  });

  it("reads the API error codes from the API source directory", () => {
    expect(apiErrorCodesFromDir(join(process.cwd(), "../../apps/api/src"))).toEqual(expect.arrayContaining(["GEOFENCE_OUTSIDE_ALLOWED_RADIUS", "NOT_FOUND"]));
  });
});

describe("physicalStyleProblems (React Native)", () => {
  it("flags left/right styles that do not flip in RTL, and accepts start/end", () => {
    const source = [
      "const styles = StyleSheet.create({",
      "  a: { marginLeft: 4, paddingRight: 2 },",
      "  b: { position: 'absolute', left: 0, top: 0 },",
      "  c: { textAlign: \"left\" },",
      "  d: { marginStart: 4, paddingEnd: 2, start: 0, textAlign: \"center\" },",
      "  e: { borderTopLeftRadius: 4, borderRightWidth: 1 },",
      "  f: { right: 8 }, // rtl-ok (genuinely physical)",
      "  g: { writingDirection: \"ltr\" },",
      "});",
      "const left = 3; // a variable, not a style",
    ].join("\n");
    expect(physicalStyleProblems(source)).toEqual([
      { line: 2, style: "marginLeft" },
      { line: 2, style: "paddingRight" },
      { line: 3, style: "left" },
      { line: 4, style: 'textAlign: "left"' },
      { line: 6, style: "borderTopLeftRadius" },
      { line: 6, style: "borderRightWidth" },
      { line: 8, style: 'writingDirection: "ltr"' },
    ]);
  });
});
