"use client";

import { useMutation } from "@tanstack/react-query";
import type { ReportFileFormat } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { downloadSignedUrl } from "@/lib/signed-url-navigation";

/** React Query keys of the reports page. */
export const reportKeys = {
  list: ["reports"] as const,
  detail: (id: string) => ["report", id] as const,
};

/** How often the report being generated is polled. */
export const REPORT_POLL_MS = 1000;
/** How often the list is refetched while one of its reports is being generated. */
export const REPORT_LIST_POLL_MS = 2000;

/**
 * Downloads and the integrity check of one report. A download asks the API
 * for a short-lived signed URL (each download is audited) and follows it: the
 * file is served as an attachment, so it downloads and the page stays. The
 * check hashes the stored files again on the server.
 */
export function useReportFileActions(reportId: string) {
  const { client } = useAuth();
  const download = useMutation({
    mutationFn: (format: ReportFileFormat) => client.getReportDownloadUrl(reportId, format),
    onSuccess: (result) => downloadSignedUrl(result.downloadUrl),
  });
  const verify = useMutation({ mutationFn: () => client.verifyReport(reportId) });
  return { download, verify };
}

export type ReportFileActions = ReturnType<typeof useReportFileActions>;
