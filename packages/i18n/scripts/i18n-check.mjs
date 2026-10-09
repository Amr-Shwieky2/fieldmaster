// Pure helpers behind the translation checks of both apps
// (apps/admin-web/scripts/check-i18n.mjs, apps/mobile/scripts/check-i18n.mjs)
// and of this package (scripts/check-shared.mjs). Unit-tested in
// scripts/__tests__/i18n-check.test.mjs. Only Node built-ins.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Flattens nested messages to { "ns.key": "value" }. */
export function flatten(messages, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(out, flatten(value, path));
    else out[path] = value;
  }
  return out;
}

/** Problems in the flattened Arabic messages: empty or non-string values. */
export function emptyValueProblems(flat) {
  const problems = [];
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== "string" || value.trim() === "") problems.push(`${key}: empty or non-string in ar.json`);
  }
  return problems;
}

/** Keys whose value is intentionally not Arabic (brand names). Apps pass their own set. */
export const NON_ARABIC_ALLOWED = new Set(["shell.brand"]);

const ARABIC_LETTER = /[\u0621-\u064A]/;
const LATIN_LETTER = /[A-Za-z]/;

/** The visible text of an ICU message: argument names, selectors and tag names removed. */
export function visibleText(message) {
  let text = String(message).replace(/<\/?[A-Za-z][\w]*>/g, " ");
  // Plural/select branches `{n, plural, one {...} other {...}}`: keep the branch bodies.
  text = text.replace(/\{\s*[A-Za-z_]\w*\s*,\s*(?:plural|select|selectordinal)\s*,/g, "{");
  text = text.replace(/(?:=\d+|zero|one|two|few|many|other|[A-Za-z_]\w*)\s*\{/g, "{");
  // Simple arguments `{name}` / `{n, number}` and the `#` plural value.
  text = text.replace(/\{\s*[A-Za-z_]\w*\s*(?:,\s*[A-Za-z]+\s*)?\}/g, " ").replace(/#/g, " ");
  return text.replace(/[{}]/g, " ");
}

/**
 * The app is Arabic only: every message must read in Arabic. A value whose
 * visible text has Latin letters and no Arabic letter (an English leftover)
 * is a problem. Arabic text with an embedded code such as "SMS" or "API" is
 * fine, and so is a value that is only placeholders/punctuation.
 */
export function arabicOnlyProblems(flat, allowed = NON_ARABIC_ALLOWED) {
  const problems = [];
  for (const [key, value] of Object.entries(flat)) {
    if (allowed.has(key) || typeof value !== "string") continue;
    const text = visibleText(value);
    if (LATIN_LETTER.test(text) && !ARABIC_LETTER.test(text)) problems.push(`${key}: not Arabic ("${value}") -- the app is Arabic only`);
  }
  return problems;
}

/**
 * Error codes the API can send, read from its source: the `ErrorCodes`
 * object, string codes passed straight to `new AppException(status, "CODE", ...)`,
 * and the codes the exception filter assigns (`code: ... "CODE" ...`).
 */
export function apiErrorCodes(sources) {
  const codes = new Set();
  for (const source of sources) {
    const block = /export const ErrorCodes = \{([\s\S]*?)\}/.exec(source);
    if (block) for (const match of block[1].matchAll(/:\s*"([A-Z][A-Z0-9_]+)"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/new AppException\(\s*[^,()]+,\s*"([A-Z][A-Z0-9_]+)"/g)) codes.add(match[1]);
    for (const line of source.split("\n")) {
      if (!/^\s*code:/.test(line)) continue;
      for (const match of line.matchAll(/"([A-Z][A-Z0-9_]+)"/g)) codes.add(match[1]);
    }
  }
  return [...codes].sort();
}

/** API error codes without an `errors.<CODE>` message (they would show a generic error). */
export function untranslatedErrorCodes(codes, flat) {
  return codes.filter((code) => !(`errors.${code}` in flat)).map((code) => `errors.${code}: the API sends this code but ar.json has no message for it`);
}

const HEBREW = /[֐-׿]/;
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

/** No Hebrew anywhere, Western digits only. */
export function scriptProblems(flat, name = "ar") {
  const problems = [];
  for (const [key, value] of Object.entries(flat)) {
    if (HEBREW.test(value)) problems.push(`${key}: contains Hebrew characters in ${name}.json`);
    if (ARABIC_INDIC_DIGITS.test(value)) problems.push(`${key}: contains Arabic-Indic digits in ${name}.json (use 0-9)`);
  }
  return problems;
}

/** The mandatory Arabic glossary: these keys must hold exactly these words. */
export const GLOSSARY = {
  "auth.loginTitle": "تسجيل الدخول",
  "common.login": "تسجيل الدخول",
  "enums.OrgRole.OWNER": "المالك",
  "enums.OrgRole.FIELD_MANAGER": "مدير ميدان",
  "enums.OrgRole.WORKER": "عامل",
  "common.temporarySupervisor": "مشرف مؤقت",
  "common.shift": "وردية",
  "common.clockIn": "بدء الدوام",
  "common.clockOut": "إنهاء الدوام",
  "enums.ClockEventType.CLOCK_IN": "بدء الدوام",
  "enums.ClockEventType.CLOCK_OUT": "إنهاء الدوام",
  "common.dayTuran": "مناوبة نهارية",
  "common.nightTuran": "مناوبة ليلية",
  "enums.ShiftType.DAY_TURAN": "مناوبة نهارية",
  "enums.ShiftType.NIGHT_TURAN": "مناوبة ليلية",
  "enums.TuranType.DAY_TURAN": "مناوبة نهارية",
  "enums.TuranType.NIGHT_TURAN": "مناوبة ليلية",
  "common.emergencyCallout": "استدعاء طوارئ",
  "enums.ShiftType.EMERGENCY_CALLOUT": "استدعاء طوارئ",
  "common.geofence": "نطاق الموقع",
  "common.flexiCheck": "تسجيل مرن",
  "enums.CheckInMethod.FLEXI_CHECK": "تسجيل مرن",
  "common.creditAsFullDay": "احتساب يوم كامل",
  "common.pendingApproval": "بانتظار الموافقة",
  "enums.TimeEntryStatus.PENDING_APPROVAL": "بانتظار الموافقة",
  "common.overtime": "ساعات إضافية",
  "common.payroll": "الرواتب",
  "nav.payroll": "الرواتب",
  "common.dailySummary": "ملخص العمل اليومي",
  "common.forgottenStamp": "نسيان تسجيل",
  "common.auditLog": "سجل التدقيق",
  "nav.auditLog": "سجل التدقيق",
  "common.workerAttendanceLedger": "سجل حضور العامل",
};

/** The glossary entries that live in the shared messages (common, enums, auth). */
export const SHARED_GLOSSARY = Object.fromEntries(Object.entries(GLOSSARY).filter(([key]) => /^(common|enums|auth)\./.test(key)));

export function glossaryProblems(flatAr, glossary = GLOSSARY) {
  const problems = [];
  for (const [key, expected] of Object.entries(glossary)) {
    if (!(key in flatAr)) problems.push(`${key}: glossary key missing from ar.json (expected "${expected}")`);
    else if (flatAr[key] !== expected) problems.push(`${key}: must be exactly "${expected}" (glossary), found "${flatAr[key]}"`);
  }
  return problems;
}

/**
 * Translation keys used in a source file. Resolves `const t = useTranslations("ns")`
 * (or `await getTranslations("ns")`) and then `t("key")`, `t.rich("key", ...)`,
 * `t.markup` and `t.raw`. Template literals `t(\`status.${x}\`)` yield a prefix.
 */
export function usedKeys(source) {
  const translators = new Map();
  for (const match of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([\w.]+)"|'([\w.]+)')?\s*\)/g)) {
    translators.set(match[1], match[2] ?? match[3] ?? "");
  }
  const keys = [];
  for (const [name, namespace] of translators) {
    const call = new RegExp(`(?<![\\w.])${name}(?:\\.(?:rich|markup|raw))?\\(\\s*(?:"([^"]+)"|'([^']+)'|\`([^\`$]*)\\$\\{)`, "g");
    for (const match of source.matchAll(call)) {
      const literal = match[1] ?? match[2];
      const prefix = match[3];
      const join = (k) => (namespace ? `${namespace}.${k}` : k);
      if (literal !== undefined) keys.push({ key: join(literal), prefix: false, index: match.index });
      else if (prefix !== undefined) keys.push({ key: join(prefix.replace(/\.$/, "")), prefix: true, index: match.index });
    }
  }
  return keys;
}

/** Physical-direction Tailwind utilities that break RTL. A line containing "rtl-ok" is exempt. */
const PHYSICAL = /(?<![\w-])(?:-?(?:ml|mr|pl|pr|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w./[\]-]+|-?(?:left|right)-[\w./[\]-]+|origin-(?:top-|bottom-)?(?:left|right)|bg-(?:left|right)(?:-top|-bottom)?|text-left|text-right|border-l(?:-[\w./[\]-]+)?|border-r(?:-[\w./[\]-]+)?|rounded-(?:l|r|tl|tr|bl|br)(?:-[\w./[\]-]+)?|float-left|float-right|clear-left|clear-right|space-x-[\w./[\]-]+|divide-x(?:-[\w./[\]-]+)?)(?![\w-])/g;

export function physicalClassProblems(source) {
  const problems = [];
  source.split("\n").forEach((line, i) => {
    if (line.includes("rtl-ok")) return;
    // Only look inside string literals / class lists, not code identifiers.
    for (const literal of line.matchAll(/"[^"]*"|'[^']*'|`[^`]*`/g)) {
      for (const match of literal[0].matchAll(PHYSICAL)) {
        if (/^space-x-|^divide-x/.test(match[0]) && /rtl:space-x-reverse|rtl:divide-x-reverse/.test(literal[0])) continue;
        problems.push({ line: i + 1, cls: match[0] });
      }
    }
  });
  return problems;
}

/**
 * React Native styles with a physical direction (they do not flip in RTL):
 * margin/padding/border Left/Right, left:/right: positioning, textAlign
 * "left"/"right" and writingDirection "ltr". Use marginStart/End,
 * paddingStart/End, borderStart*, start:/end:, textAlign "auto"/"center".
 * A line containing "rtl-ok" is exempt.
 */
const PHYSICAL_STYLE = /\b(?:(?:margin|padding)(?:Left|Right)|border(?:Left|Right)(?:Width|Color|Style)?|border(?:Top|Bottom)(?:Left|Right)Radius)\s*:|(?<![\w.$-])(?:left|right)\s*:\s*[-\d"'`({\w]|textAlign\s*:\s*["'](?:left|right)["']|writingDirection\s*:\s*["']ltr["']/g;

export function physicalStyleProblems(source) {
  const problems = [];
  source.split("\n").forEach((line, i) => {
    if (line.includes("rtl-ok")) return;
    const code = line.replace(/\/\/.*$/, "");
    for (const match of code.matchAll(PHYSICAL_STYLE)) {
      const text = match[0];
      problems.push({ line: i + 1, style: /^(textAlign|writingDirection)/.test(text) ? text.replace(/\s+/g, " ") : text.replace(/\s*:.*$/, "") });
    }
  });
  return problems;
}

/** Keys an app defines that the shared messages already define (an app must not silently override shared wording). */
export function overlapProblems(sharedFlat, appFlat, appName = "app") {
  return Object.keys(appFlat)
    .filter((key) => key in sharedFlat)
    .map((key) => `${key}: defined in both @fieldmaster/i18n and the ${appName}'s ar.json -- keep it in one place`);
}

/** Every JSON file in a messages directory must be ar.json: the apps are Arabic only. */
export function messageFileProblems(dir, label = dir) {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json") && file !== "ar.json")
    .map((file) => `${label}/${file}: the app is Arabic only; ar.json must be the only messages file`);
}

/** Deep merge of two message trees (the app's keys over the shared ones). */
export function mergeTrees(base, extra) {
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const existing = result[key];
    const bothObjects = existing && typeof existing === "object" && value && typeof value === "object";
    result[key] = bothObjects ? mergeTrees(existing, value) : value;
  }
  return result;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Source files under `dir` (recursively), skipping tests and node_modules. */
export function* sourceFiles(dir, { extensions = /\.(ts|tsx)$/, skipTests = true } = {}) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      if (skipTests && (entry === "__tests__" || entry === "test")) continue;
      yield* sourceFiles(full, { extensions, skipTests });
    } else if (extensions.test(entry) && !/\.(test|spec)\.(ts|tsx|mjs|js)$/.test(entry)) {
      yield full;
    }
  }
}

/** All error codes the API (apps/api/src) can send. */
export function apiErrorCodesFromDir(apiSrcDir) {
  return apiErrorCodes([...sourceFiles(apiSrcDir)].map((file) => readFileSync(file, "utf8")));
}
