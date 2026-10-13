"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { cn } from "@/lib/cn";
import { LtrText } from "@/components/formatted";
import { Button } from "@/components/ui/button";

/** One upload on the join page, from choosing the file to the API's answer. */
export type FileStatus =
  | { kind: "empty" }
  /** Refused by the page's own check or by the API (which may give its size limit). */
  | { kind: "invalid"; reason: "tooLarge" | "wrongType"; fileName: string; maxBytes?: number }
  | { kind: "uploading"; fileName: string }
  | { kind: "uploaded"; fileName: string; fileAssetId: string }
  | { kind: "failed"; fileName: string; error: unknown };

export const EMPTY_FILE: FileStatus = { kind: "empty" };

/** A size limit in megabytes, as shown to the worker ("10", "2.5"). */
export function megabytes(bytes: number, format: { number: (value: number, options?: Intl.NumberFormatOptions) => string }): string {
  return format.number(bytes / (1024 * 1024), { maximumFractionDigits: 1 });
}

/**
 * A file input for a phone: a large «اختيار ملف أو التقاط صورة» button (the
 * accepted image types let a phone offer its camera as well as its files),
 * the upload's progress or result, and «استبدال الملف» / «إزالة الملف».
 * The native input stays in the page (visually hidden) so keyboards and
 * screen readers reach it; its name is the field's label.
 */
export function FileField({
  id,
  label,
  hint,
  optional,
  accept,
  status,
  wrongTypeMessage,
  maxBytes,
  error,
  onSelect,
  onRemove,
}: {
  id: string;
  label: string;
  hint: string;
  optional: boolean;
  accept: string;
  status: FileStatus;
  wrongTypeMessage: string;
  maxBytes: number;
  /** A validation message (shown after the field was used or the form submitted). */
  error: ReactNode;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("join");
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const errorId = `${id}-error`;
  const describedBy = [hintId, status.kind !== "empty" ? statusId : null, error ? errorId : null].filter(Boolean).join(" ");
  // A refused or failed file is invalid at once; the validation message comes after a submit.
  const invalid = Boolean(error) || status.kind === "invalid" || status.kind === "failed";

  let statusText: ReactNode = null;
  if (status.kind === "uploading") statusText = <span>{t("file.uploading")}</span>;
  else if (status.kind === "uploaded") statusText = <span className="font-medium text-emerald-700">{t("file.uploaded")}</span>;
  else if (status.kind === "invalid")
    statusText = (
      <span className="text-red-700">
        {status.reason === "tooLarge" ? t("file.tooLarge", { max: megabytes(status.maxBytes ?? maxBytes, format) }) : wrongTypeMessage}
      </span>
    );
  else if (status.kind === "failed") statusText = <span className="text-red-700">{t("file.failed", { message: errorMessage(status.error) })}</span>;

  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium text-slate-700">
        {label}
        {optional ? (
          <>
            {" "}
            <span className="font-normal text-slate-500">{t("fields.optional")}</span>
          </>
        ) : null}
      </p>
      <p id={hintId} className="text-xs text-slate-500">
        {hint}
      </p>
      <input
        id={id}
        type="file"
        accept={accept}
        className="peer sr-only"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={optional ? undefined : true}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file again (after an error) is still a change.
          event.target.value = "";
          if (file) onSelect(file);
        }}
      />
      <label
        htmlFor={id}
        aria-hidden
        className={cn(
          "flex min-h-12 w-full cursor-pointer items-center justify-center rounded-md border-2 border-dashed px-4 py-3 text-center text-base font-medium",
          "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600",
          invalid ? "border-red-400 bg-red-50 text-red-800" : "border-slate-300 bg-white text-brand-700 hover:bg-slate-50",
        )}
      >
        {status.kind === "empty" ? t("file.choose") : t("file.replace")}
      </label>
      <div id={statusId} aria-live="polite" className="min-w-0 text-sm text-slate-600">
        {statusText ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {statusText}
            {status.kind !== "empty" ? (
              <LtrText className="inline-block max-w-full truncate align-bottom text-xs text-slate-500">{status.fileName}</LtrText>
            ) : null}
          </p>
        ) : null}
      </div>
      {optional && status.kind !== "empty" ? (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          {t("file.remove")}
        </Button>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
