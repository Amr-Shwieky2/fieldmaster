#!/usr/bin/env node
/**
 * Translation and RTL checks for apps/admin-web (runs in `pnpm lint`, so CI
 * fails on any problem). The app is Arabic only; its messages are the shared
 * ones from @fieldmaster/i18n merged with src/i18n/messages/ar.json:
 *   1. ar.json is the only messages file, with no empty values, and it does
 *      not redefine a shared key.
 *   2. Every message reads in Arabic (no English leftovers; the brand name is
 *      allow-listed).
 *   3. Every translation key used in src/ exists.
 *   4. Every error code the API can send (apps/api/src) has an
 *      `errors.<CODE>` message, so users never see a generic error for it.
 *   5. No Hebrew characters, no Arabic-Indic digits.
 *   6. The mandatory Arabic glossary terms are used exactly.
 *   7. No physical left/right Tailwind classes (use ms/me, ps/pe, start/end,
 *      text-start/end, border-s/e, rounded-s/e). Mark a genuinely physical
 *      case with a "rtl-ok" comment on the same line.
 *
 * Usage: node scripts/check-i18n.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GLOSSARY,
  apiErrorCodesFromDir,
  arabicOnlyProblems,
  emptyValueProblems,
  flatten,
  glossaryProblems,
  mergeTrees,
  messageFileProblems,
  overlapProblems,
  physicalClassProblems,
  readJson,
  scriptProblems,
  sourceFiles,
  untranslatedErrorCodes,
  usedKeys,
} from "@fieldmaster/i18n/check";

const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const messagesDir = join(appDir, "src/i18n/messages");
const apiSrcDir = resolve(appDir, "../api/src");
const sharedFile = createRequire(import.meta.url).resolve("@fieldmaster/i18n/messages/ar.json");

const sharedTree = readJson(sharedFile);
const appTree = readJson(join(messagesDir, "ar.json"));
const shared = flatten(sharedTree);
const app = flatten(appTree);
const ar = flatten(mergeTrees(sharedTree, appTree));

const problems = [
  ...messageFileProblems(messagesDir, "src/i18n/messages"),
  ...overlapProblems(shared, app, "admin web"),
  ...emptyValueProblems(ar),
  ...arabicOnlyProblems(ar, new Set(["shell.brand"])),
  ...scriptProblems(ar),
  ...glossaryProblems(ar, GLOSSARY),
];

if (existsSync(apiSrcDir)) problems.push(...untranslatedErrorCodes(apiErrorCodesFromDir(apiSrcDir), ar));

const allKeys = Object.keys(ar);
for (const file of sourceFiles(join(appDir, "src"))) {
  const source = readFileSync(file, "utf8");
  const rel = relative(appDir, file);
  for (const { key, prefix, index } of usedKeys(source)) {
    const line = source.slice(0, index).split("\n").length;
    const exists = prefix ? allKeys.some((k) => k.startsWith(`${key}.`)) : key in ar;
    if (!exists) problems.push(`${rel}:${line}: translation key "${key}"${prefix ? " (prefix)" : ""} not found in the Arabic messages`);
  }
  if (file.endsWith(".tsx")) {
    for (const { line, cls } of physicalClassProblems(source)) {
      problems.push(`${rel}:${line}: physical class "${cls}" -- use the logical equivalent (ms/me, ps/pe, start/end, text-start/end, border-s/e, rounded-s/e)`);
    }
  }
}

if (problems.length > 0) {
  console.error(`i18n check failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `i18n check passed: ${allKeys.length} Arabic keys (${Object.keys(shared).length} shared, ${Object.keys(app).length} admin web), every API error code translated, glossary OK, no physical direction classes.`,
);
