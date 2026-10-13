import { execFile } from "node:child_process";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { request } from "./test-app";

/**
 * Helpers of the report tests (Step 8): wait for a report's job, read a PDF's
 * text, and look for Arabic words in it.
 */

/** Polls `GET /reports/:id` until the job has finished (READY or FAILED); answers the report. */
export async function waitForReport(app: INestApplication, accessToken: string, reportId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await request(app.getHttpServer()).get(`/api/v1/reports/${reportId}`).set("Authorization", `Bearer ${accessToken}`);
    if (response.status === 200 && (response.body.status === "READY" || response.body.status === "FAILED")) return response.body;
    if (Date.now() > deadline) throw new Error(`Report ${reportId} did not finish: ${response.status} ${JSON.stringify(response.body)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * The text of each page of a PDF, with pdf-parse (pdf.js). It runs in a child
 * process: pdf.js loads its worker with a dynamic import, which Jest's module
 * system refuses without --experimental-vm-modules.
 */
export function extractPdfText(pdf: Buffer): Promise<{ total: number; pages: string[] }> {
  const script = `
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", async () => {
      try {
        const { PDFParse } = require(require.resolve("pdf-parse", { paths: [process.argv[1]] }));
        const parser = new PDFParse({ data: new Uint8Array(Buffer.concat(chunks)) });
        const result = await parser.getText();
        await parser.destroy();
        process.stdout.write(JSON.stringify({ total: result.total, pages: result.pages.map((page) => page.text) }));
      } catch (error) {
        process.stderr.write(String((error && error.stack) || error));
        process.exit(1);
      }
    });`;
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ["-e", script, join(__dirname, "..")], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) =>
      error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout)),
    );
    child.stdin?.end(pdf);
  });
}

/** The Arabic letters of a text: presentation forms normalized (NFKC), diacritics, tatweel, spaces and everything else dropped. */
function arabicLetters(text: string): string {
  return text.normalize("NFKC").replace(/[^\u0621-\u063A\u0641-\u064A]/g, "");
}

/** Whether `text` has a run of `word.length` letters that are `word`'s letters in any order. */
function containsAnagram(text: string, word: string): boolean {
  if (word.length === 0 || word.length > text.length) return false;
  const missing = new Map<string, number>();
  for (const letter of word) missing.set(letter, (missing.get(letter) ?? 0) + 1);
  let unmatched = word.length;
  const take = (letter: string, delta: number) => {
    const before = missing.get(letter) ?? 0;
    missing.set(letter, before - delta);
    // A letter of the word that the window now covers (delta 1) or no longer covers (delta -1).
    if (delta === 1 && before > 0) unmatched -= 1;
    if (delta === -1 && before >= 0) unmatched += 1;
  };
  for (let index = 0; index < text.length; index += 1) {
    take(text[index], 1);
    if (index >= word.length) take(text[index - word.length], -1);
    if (unmatched === 0) return true;
  }
  return false;
}

/**
 * Whether an Arabic phrase is on a PDF page. pdf.js does not give Arabic in
 * reading order: glyphs it maps to presentation forms come out in visual
 * order, runs it maps to base letters are reordered again by its own bidi
 * pass, and it may put a space inside a word. A word's letters do stay
 * together, so the phrase is found when its letters (or, for a phrase a cell
 * wraps over two lines, each word's letters) form one run of the page's
 * Arabic letters, in any order.
 */
export function pdfHasArabic(pageText: string, phrase: string): boolean {
  const letters = arabicLetters(pageText);
  const words = phrase
    .split(/\s+/)
    .map(arabicLetters)
    .filter((word) => word.length > 0);
  if (words.length === 0) return false;
  return containsAnagram(letters, words.join("")) || words.every((word) => containsAnagram(letters, word));
}

/** Any Arabic-Indic digit (the reports use Western digits only). */
export const ARABIC_INDIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/;

/** An amount as printed ("₪ 1,234.50" in a PDF, "1234.50" in a CSV); coordinates have 5 decimals and minutes none. */
export const AMOUNT = /\d\.\d{2}(?!\d)/;
