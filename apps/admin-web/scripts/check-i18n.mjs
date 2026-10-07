#!/usr/bin/env node
/**
 * Translation and RTL checks for apps/admin-web (runs in `pnpm lint`, so CI
 * fails on any problem):
 *   1. ar.json and en.json have exactly the same keys, no empty values and
 *      the same ICU placeholders / rich-text tags per key.
 *   2. Every translation key used in src/ exists.
 *   3. No Hebrew characters, no Arabic-Indic digits.
 *   4. The mandatory Arabic glossary terms are used exactly.
 *   5. No physical left/right Tailwind classes (use ms/me, ps/pe, start/end,
 *      text-start/end, border-s/e, rounded-s/e). Mark a genuinely physical
 *      case with a "rtl-ok" comment on the same line.
 *
 * Usage: node scripts/check-i18n.mjs [--overlay <dir>]
 *   --overlay merges "<namespace>.ar.json" / "<namespace>.en.json" fragment
 *   files over the real messages (used while translating in parallel).
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareLocales, flatten, glossaryProblems, physicalClassProblems, scriptProblems, usedKeys } from "./lib/i18n-check.mjs";

const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const messagesDir = join(appDir, "src/i18n/messages");

function load(locale, overlayDir) {
  const messages = JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"));
  if (overlayDir && existsSync(overlayDir)) {
    for (const file of readdirSync(overlayDir)) {
      const match = new RegExp(`^(.+)\\.${locale}\\.json$`).exec(file);
      if (match) messages[match[1]] = JSON.parse(readFileSync(join(overlayDir, file), "utf8"));
    }
  }
  return messages;
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test") continue;
      yield* sourceFiles(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      yield full;
    }
  }
}

const overlayIndex = process.argv.indexOf("--overlay");
const overlayDir = overlayIndex > -1 ? resolve(process.argv[overlayIndex + 1]) : null;

const ar = flatten(load("ar", overlayDir));
const en = flatten(load("en", overlayDir));
const problems = [
  ...compareLocales(ar, en),
  ...scriptProblems(ar, "ar"),
  ...scriptProblems(en, "en"),
  ...glossaryProblems(ar),
];

const allKeys = new Set([...Object.keys(ar), ...Object.keys(en)]);
for (const file of sourceFiles(join(appDir, "src"))) {
  const source = readFileSync(file, "utf8");
  const rel = relative(appDir, file);
  for (const { key, prefix, index } of usedKeys(source)) {
    const line = source.slice(0, index).split("\n").length;
    const exists = prefix ? [...allKeys].some((k) => k.startsWith(`${key}.`)) : key in ar && key in en;
    if (!exists) problems.push(`${rel}:${line}: translation key "${key}"${prefix ? " (prefix)" : ""} not found in ar.json and en.json`);
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
console.log(`i18n check passed: ${Object.keys(ar).length} keys in ar.json and en.json, glossary OK, no physical direction classes.`);
