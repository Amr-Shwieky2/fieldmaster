"use client";

import { useTranslations } from "next-intl";
import { isForbidden } from "@/lib/errors";
import { useErrorMessage } from "@/lib/use-error-message";
import { AccessDenied } from "@/components/access-denied";
import { Button } from "./button";

/**
 * The four standard page states. All default texts come from the `states`
 * namespace; pass props to override them with page-specific wording.
 */

export function LoadingState({ label }: { label?: string }) {
  const t = useTranslations("states");
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" aria-hidden />
      {label ?? t("loading")}
    </div>
  );
}

export function EmptyState({ title, description }: { title?: string; description?: string }) {
  const t = useTranslations("states");
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{title ?? t("emptyTitle")}</p>
      <p className="text-sm text-slate-500">{description ?? t("emptyDescription")}</p>
    </div>
  );
}

/**
 * Error state. Pass the thrown `error` to get a translated message (and the
 * access-denied state automatically on a 403), or a ready `message`.
 */
export function ErrorState({ error, message, onRetry }: { error?: unknown; message?: string; onRetry?: () => void }) {
  const t = useTranslations("states");
  const errorMessage = useErrorMessage();
  if (error !== undefined && isForbidden(error)) return <AccessDenied />;
  const text = message ?? (error !== undefined ? errorMessage(error) : t("errorDescription"));
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p className="text-sm font-medium text-red-700">{t("errorTitle")}</p>
      <p className="text-sm text-red-600">{text}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
}
