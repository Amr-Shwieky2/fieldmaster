"use client";

import { useTranslations } from "next-intl";
import type { ReportVerification } from "@fieldmaster/api-client";
import { useErrorMessage } from "@/lib/use-error-message";
import { cn } from "@/lib/cn";
import { DateTimeText } from "@/components/formatted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReportFileActions } from "./report-queries";

/** A SHA-256 (64 hex digits): left-to-right, monospace, wrapping on narrow screens. */
export function HashText({ value, className }: { value: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("break-all font-mono text-xs", className)} style={{ unicodeBidi: "isolate" }}>
      {value}
    </bdi>
  );
}

/**
 * «تنزيل PDF», «تنزيل CSV» and «تحقق من السلامة» for a ready report. In a
 * list, `context` (the report's type and date) is added to each button's
 * accessible name so the rows can be told apart, and `stacked` keeps the
 * column narrow.
 */
export function ReportFileButtons({ actions, context, stacked = false }: { actions: ReportFileActions; context?: string; stacked?: boolean }) {
  const t = useTranslations("reports");
  const { download, verify } = actions;
  const pendingFormat = download.isPending ? download.variables : null;
  const label = (action: string, pending: boolean) => (context && !pending ? t("files.labelInContext", { action, context }) : undefined);

  return (
    <div className={stacked ? "flex flex-col items-stretch gap-1.5 whitespace-nowrap" : "flex flex-wrap gap-2"}>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => download.mutate("pdf")}
        disabled={download.isPending}
        aria-label={label(t("files.downloadPdf"), pendingFormat === "pdf")}
      >
        {pendingFormat === "pdf" ? t("files.preparing") : t("files.downloadPdf")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => download.mutate("csv")}
        disabled={download.isPending}
        aria-label={label(t("files.downloadCsv"), pendingFormat === "csv")}
      >
        {pendingFormat === "csv" ? t("files.preparing") : t("files.downloadCsv")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => verify.mutate()} disabled={verify.isPending} aria-label={label(t("files.verify"), verify.isPending)}>
        {verify.isPending ? t("files.verifying") : t("files.verify")}
      </Button>
    </div>
  );
}

/** What the buttons produced: a failed download or check, or the check's result. Null when there is nothing to show. */
export function ReportActionResults({ actions }: { actions: ReportFileActions }) {
  const t = useTranslations("reports");
  const errorMessage = useErrorMessage();
  const { download, verify } = actions;
  if (!download.isError && !verify.isError && !verify.data) return null;

  return (
    <div className="space-y-2">
      {download.isError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("files.downloadFailed", { message: errorMessage(download.error) })}
        </p>
      ) : null}
      {verify.isError ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("files.verifyFailed", { message: errorMessage(verify.error) })}
        </p>
      ) : null}
      {verify.data ? <VerificationResult verification={verify.data} /> : null}
    </div>
  );
}

export function hasActionResults(actions: ReportFileActions): boolean {
  return actions.download.isError || actions.verify.isError || actions.verify.data !== undefined;
}

/**
 * The integrity check: the stored files were hashed again and compared with
 * the hashes recorded when the report was generated. Any difference (or a
 * hash that was never recorded) is a clear warning.
 */
export function VerificationResult({ verification }: { verification: ReportVerification }) {
  const t = useTranslations("reports");
  const valid = verification.valid;
  const hash = (value: string | null) => (value ? <HashText value={value} /> : <span className="text-xs">{t("verify.notRecorded")}</span>);

  return (
    <div
      role={valid ? "status" : "alert"}
      className={cn(
        "space-y-3 rounded-md border px-3 py-3 text-sm",
        valid ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      <div>
        <p className="font-semibold">{valid ? t("verify.valid") : t("verify.invalid")}</p>
        <p className="text-xs">{t.rich("verify.checkedAt", { date: () => <DateTimeText value={verification.checkedAt} /> })}</p>
      </div>
      <dl className="space-y-3">
        <div>
          <dt className="text-xs font-medium">{t("verify.dataHash")}</dt>
          <dd>{hash(verification.dataSha256)}</dd>
        </div>
        {verification.files.map((file) => (
          <div key={file.format} className="space-y-1">
            <dt className="flex flex-wrap items-center gap-2 text-xs font-medium">
              {t("verify.file", { format: file.format })}
              <Badge tone={file.matches ? "success" : "warning"}>{file.matches ? t("verify.matches") : t("verify.differs")}</Badge>
            </dt>
            <dd className="space-y-1">
              <p>
                <span className="text-xs">{t("verify.expected")}</span> {hash(file.expectedSha256)}
              </p>
              <p>
                <span className="text-xs">{t("verify.actual")}</span> {hash(file.actualSha256)}
              </p>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
