"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { UploadedFileSummary } from "@fieldmaster/api-client";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { openTabForSignedUrl } from "@/lib/signed-url-navigation";
import { Button } from "@/components/ui/button";

/**
 * A fresh short-lived signed URL for an uploaded file, asked for only when
 * the Owner opens it: the API audits every URL it signs and each one works
 * for about a minute, so none is fetched ahead or kept (no cache).
 */
function useViewUrl(fileAssetId: string) {
  const { client } = useAuth();
  return useMutation({ mutationFn: () => client.getFileAssetViewUrl(fileAssetId), gcTime: 0 });
}

/**
 * An identity document or profile photo a worker uploaded (Owner only). An
 * image is shown on the page when the Owner opens it; a PDF opens in a new
 * tab. Opening it again asks for a new URL.
 */
export function OnboardingFilePreview({ file, alt }: { file: UploadedFileSummary; alt: string }) {
  return file.contentType === "application/pdf" ? <PdfDocument fileAssetId={file.fileAssetId} /> : <ImageDocument fileAssetId={file.fileAssetId} alt={alt} />;
}

function ViewError({ error }: { error: unknown }) {
  const t = useTranslations("onboardingReview");
  const errorMessage = useErrorMessage();
  return (
    <p role="alert" className="text-sm text-red-700">
      {t("file.error", { message: errorMessage(error) })}
    </p>
  );
}

function ImageDocument({ fileAssetId, alt }: { fileAssetId: string; alt: string }) {
  const t = useTranslations("onboardingReview");
  const view = useViewUrl(fileAssetId);
  const fullSize = useViewUrl(fileAssetId);
  const [broken, setBroken] = useState(false);
  const show = () => {
    setBroken(false);
    view.mutate();
  };

  if (!view.data) {
    return (
      <div className="space-y-2">
        <Button size="sm" variant="secondary" onClick={show} disabled={view.isPending}>
          {view.isPending ? t("file.loading") : t("file.show")}
        </Button>
        {view.isError ? <ViewError error={view.error} /> : null}
      </div>
    );
  }
  if (broken) {
    // The URL expired before the image loaded (or the file could not be read): ask for a new one.
    return (
      <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <p>{t("file.imageError")}</p>
        <Button size="sm" variant="secondary" onClick={show}>
          {t("file.reload")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {/* A short-lived signed URL from the API: next/image would proxy and cache it. */}
      <img
        src={view.data.url}
        alt={alt}
        onError={() => setBroken(true)}
        className="max-h-96 w-auto max-w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={fullSize.isPending}
          onClick={() => {
            // The tab is opened during the click; it gets its own fresh URL when the API answers.
            const tab = openTabForSignedUrl();
            fullSize.mutate(undefined, { onSuccess: (result) => tab.show(result.url), onError: tab.cancel });
          }}
        >
          {fullSize.isPending ? t("file.opening") : t("file.openImage")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            // Drop the URL; showing the image again asks for a new one.
            view.reset();
            fullSize.reset();
          }}
        >
          {t("file.hide")}
        </Button>
      </div>
      {fullSize.isError ? <ViewError error={fullSize.error} /> : null}
    </div>
  );
}

function PdfDocument({ fileAssetId }: { fileAssetId: string }) {
  const t = useTranslations("onboardingReview");
  const open = useViewUrl(fileAssetId);
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">{t("file.pdf")}</p>
      <Button
        size="sm"
        variant="secondary"
        disabled={open.isPending}
        onClick={() => {
          // The tab is opened during the click; it is sent to the PDF when the API answers.
          const tab = openTabForSignedUrl();
          open.mutate(undefined, { onSuccess: (result) => tab.show(result.url), onError: tab.cancel });
        }}
      >
        {open.isPending ? t("file.opening") : t("file.open")}
      </Button>
      {open.isError ? <ViewError error={open.error} /> : null}
    </div>
  );
}
