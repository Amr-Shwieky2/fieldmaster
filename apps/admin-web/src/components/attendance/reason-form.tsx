"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";

/**
 * A written reason before an action is sent (reject, request a correction,
 * full-day credit, cancel a deduction). The reason is stored and shown to
 * people, so an empty or blank one is refused here, before any request.
 */
export function ReasonForm({
  id,
  label,
  hint,
  value,
  invalid,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  pendingLabel,
  pending,
  busy,
  variant = "primary",
}: {
  /** Prefix of the element ids (form, input, hint, error). */
  id: string;
  label: string;
  hint: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  /** Called with the trimmed reason; never with a blank one. */
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  submitLabel: string;
  pendingLabel: string;
  pending: boolean;
  busy: boolean;
  variant?: "primary" | "danger";
}) {
  const t = useTranslations("attendance");
  const tc = useTranslations("common");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(value.trim());
  };

  return (
    <form id={id} noValidate onSubmit={submit} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <Label htmlFor={`${id}-input`}>{label}</Label>
      <textarea
        id={`${id}-input`}
        dir="auto"
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ""}`}
        className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <p id={`${id}-hint`} className="text-xs text-slate-500">
        {hint}
      </p>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600">
          {t("reasonPrompt.required")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant={variant} disabled={busy}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
