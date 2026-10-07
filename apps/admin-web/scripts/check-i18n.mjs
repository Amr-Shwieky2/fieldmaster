#!/usr/bin/env node
/**
 * Translation and RTL checks for apps/admin-web (runs in `pnpm lint`, so CI
 * fails on any problem). The app is Arabic only:
 *   1. ar.json is the only messages file, with no empty values.
 *   2. Every message reads in Arabic (no English leftovers; brand names are
 *      allow-listed in NON_ARABIC_ALLOWED).
 *   3. Every translation key used in src/ exists in ar.json.
 *   4. Every error code the API can send (apps/api/src) has an
 *      `errors.<CODE>` message, so users never see a generic error for it.
 *   5. No Hebrew characters, no Arabic-Indic digits.
 *   6. The mandatory Arabic glossary terms are used exactly.
 *   7. No physical left/right Tailwind classes (use ms/me, ps/pe, start/end,
 *      text-start/end, border-s/e, rounded-s/e). Mark a genuinely physical
 *      case with a "rtl-ok" comment on the same line.
 *
 * Usage: node scripts/check-i18n.mjs [--overlay <dir>]
 *   --overlay merges "<namespace>.ar.json" fragment files over ar.json (used
 *   while translating in parallel).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiErrorCodes,
  arabicOnlyProblems,
  emptyValueProblems,
  flatten,
  glossaryProblems,
  physicalClassProblems,
  scriptProblems,
  untranslatedErrorCodes,
  usedKeys,
} from "./lib/i18n-check.mjs";

const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const messagesDir = join(appDir, "src/i18n/messages");
const apiSrcDir = resolve(appDir, "../api/src");

function load(overlayDir) {
  const messages = JSON.parse(readFileSync(join(messagesDir, "ar.json"), "utf8"));
  if (overlayDir && existsSync(overlayDir)) {
    for (const file of readdirSync(overlayDir)) {
      const match = /^(.+)\.ar\.json$/.exec(file);
      if (match) messages[match[1]] = JSON.parse(readFileSync(join(overlayDir, file), "utf8"));
    }
  }
  return messages;
}

function* sourceFiles(dir, { skipTests = true } = {}) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && (entry === "__tests__" || entry === "test")) continue;
      yield* sourceFiles(full, { skipTests });
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

const overlayIndex = process.argv.indexOf("--overlay");
const overlayDir = overlayIndex > -1 ? resolve(process.argv[overlayIndex + 1]) : null;

const ar = flatten(load(overlayDir));
const problems = [
  ...readdirSync(messagesDir)
    .filter((file) => file !== "ar.json")
    .map((file) => `src/i18n/messages/${file}: the app is Arabic only; ar.json must be the only messages file`),
  ...emptyValueProblems(ar),
  ...arabicOnlyProblems(ar),
  ...scriptProblems(ar),
  ...glossaryProblems(ar),
];

if (existsSync(apiSrcDir)) {
  const apiSources = [...sourceFiles(apiSrcDir)].map((file) => readFileSync(file, "utf8"));
  problems.push(...untranslatedErrorCodes(apiErrorCodes(apiSources), ar));
}

const allKeys = Object.keys(ar);
for (const file of sourceFiles(join(appDir, "src"))) {
  const source = readFileSync(file, "utf8");
  const rel = relative(appDir, file);
  for (const { key, prefix, index } of usedKeys(source)) {
    const line = source.slice(0, index).split("\n").length;
    const exists = prefix ? allKeys.some((k) => k.startsWith(`${key}.`)) : key in ar;
    if (!exists) problems.push(`${rel}:${line}: translation key "${key}"${prefix ? " (prefix)" : ""} not found in ar.json`);
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
console.log(`i18n check passed: ${allKeys.length} Arabic keys, every API error code translated, glossary OK, no physical direction classes.`);
