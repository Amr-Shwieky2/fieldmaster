#!/usr/bin/env node
/**
 * Checks the shared Arabic messages of @fieldmaster/i18n (runs in this
 * package's `lint`): ar.json is the only messages file, no empty values,
 * every message reads in Arabic, no Hebrew or Arabic-Indic digits, the shared
 * glossary terms are exact, and every error code the API can send has an
 * `errors.<CODE>` message. Each app's own check repeats these on the merged
 * (shared + app) messages and adds its source-code checks.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHARED_GLOSSARY,
  apiErrorCodesFromDir,
  arabicOnlyProblems,
  emptyValueProblems,
  flatten,
  glossaryProblems,
  messageFileProblems,
  readJson,
  scriptProblems,
  untranslatedErrorCodes,
} from "./i18n-check.mjs";

const packageDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const messagesDir = join(packageDir, "src/messages");
const apiSrcDir = resolve(packageDir, "../../apps/api/src");

const shared = flatten(readJson(join(messagesDir, "ar.json")));
const problems = [
  ...messageFileProblems(messagesDir, "packages/i18n/src/messages"),
  ...emptyValueProblems(shared),
  ...arabicOnlyProblems(shared, new Set()),
  ...scriptProblems(shared),
  ...glossaryProblems(shared, SHARED_GLOSSARY),
  ...(existsSync(apiSrcDir) ? untranslatedErrorCodes(apiErrorCodesFromDir(apiSrcDir), shared) : []),
];

if (problems.length > 0) {
  console.error(`shared i18n check failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`shared i18n check passed: ${Object.keys(shared).length} shared Arabic keys, every API error code translated, shared glossary OK.`);
