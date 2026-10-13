import { Injectable } from "@nestjs/common";
import { chromium } from "playwright";

/** Page objects in a PDF (`/Type /Page`, not the `/Type /Pages` tree nodes). */
export function countPdfPages(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;
}

export interface RenderedPdf {
  pdf: Buffer;
  pageCount: number;
}

/**
 * Renders a report's HTML to a PDF with headless Chromium (Playwright). One
 * browser per report: reports are background jobs, one at a time per worker,
 * and a fresh browser never carries state from another organization's
 * report. The page size, margins and the footer on every page come from the
 * document's own `@page` rules (`preferCSSPageSize`), not from Playwright's
 * header/footer templates, which cannot use the embedded font.
 */
@Injectable()
export class ReportPdfRenderer {
  async render(documentHtml: string): Promise<RenderedPdf> {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(documentHtml, { waitUntil: "load", timeout: 60_000 });
      // The fonts are data URLs, but the PDF must not be printed before every face is decoded.
      await page.evaluate("document.fonts.ready.then(() => true)");
      const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
      return { pdf, pageCount: countPdfPages(pdf) };
    } finally {
      await browser.close();
    }
  }
}
