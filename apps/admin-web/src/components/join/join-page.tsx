"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ApiRequestError, FieldMasterClient } from "@fieldmaster/api-client";
import { isNetworkError } from "@fieldmaster/i18n";
import { API_URL } from "@/lib/api-url";
import { useErrorMessage } from "@/lib/use-error-message";
import { Phone } from "@/components/formatted";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { JoinForm } from "./join-form";

/** The server could not answer now (no connection, a server error, too many requests): worth retrying, unlike a bad link. */
function isTemporaryFailure(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  return error instanceof ApiRequestError && (error.status >= 500 || error.status === 429);
}

/** A centred message instead of the form (a bad link, an outage, the confirmation). */
function JoinMessage({ title, children }: { title: string; children: ReactNode }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The page content was replaced: move the focus (and a screen reader) to the new heading.
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <Card>
      <CardContent className="space-y-3 px-5 py-8 text-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900 focus:outline-none">
          {title}
        </h1>
        {children}
      </CardContent>
    </Card>
  );
}

/** Any link the API refuses: never says whether it was wrong, used, expired or revoked, and shows no data. */
function InvalidLink() {
  const t = useTranslations("join");
  return (
    <JoinMessage title={t("invalid.title")}>
      <p className="text-base text-slate-600">{t("invalid.description")}</p>
    </JoinMessage>
  );
}

function JoinSubmitted({ organizationName, phoneNumber }: { organizationName: string; phoneNumber: string }) {
  const t = useTranslations("join");
  return (
    <JoinMessage title={t("success.title")}>
      <p className="text-base text-slate-700">{t("success.body", { organization: organizationName })}</p>
      <div className="space-y-2 rounded-md bg-slate-50 p-4 text-start text-sm text-slate-700">
        <h2 className="font-semibold text-slate-900">{t("success.nextTitle")}</h2>
        <ol className="list-decimal space-y-1 ps-5">
          <li>{t("success.review")}</li>
          <li>{t.rich("success.signIn", { phone: () => <Phone value={phoneNumber} className="font-semibold" /> })}</li>
        </ol>
      </div>
      <p className="text-sm text-slate-500">{t("success.close")}</p>
    </JoinMessage>
  );
}

/**
 * The public join page (no session): the invitation is read with its token,
 * then the worker fills in the application. Requests go through a client
 * without an access token; a refused link shows one neutral message.
 */
export function JoinPage({ token }: { token: string }) {
  const t = useTranslations("join");
  const tShell = useTranslations("shell");
  const errorMessage = useErrorMessage();
  const [client] = useState(() => new FieldMasterClient({ baseUrl: API_URL, getAccessToken: () => null }));
  const query = useQuery({
    queryKey: ["public-invitation", token],
    queryFn: () => client.getPublicInvitation(token),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [submittedPhone, setSubmittedPhone] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);

  let content: ReactNode;
  if (submittedPhone !== null && query.data) {
    content = <JoinSubmitted organizationName={query.data.organizationName} phoneNumber={submittedPhone} />;
  } else if (linkInvalid) {
    content = <InvalidLink />;
  } else if (query.data) {
    content = <JoinForm token={token} client={client} invitation={query.data} onSubmitted={setSubmittedPhone} onLinkInvalid={() => setLinkInvalid(true)} />;
  } else if (query.isError && isTemporaryFailure(query.error)) {
    content = (
      <JoinMessage title={t("unavailable.title")}>
        <p className="text-base text-slate-600">{errorMessage(query.error)}</p>
        <Button className="w-full py-3 !text-base sm:w-auto" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {t("unavailable.retry")}
        </Button>
      </JoinMessage>
    );
  } else if (query.isError) {
    content = <InvalidLink />;
  } else {
    content = <LoadingState label={t("loading")} />;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <p className="text-center text-sm font-semibold text-slate-500">{tShell("brand")}</p>
        {content}
      </div>
    </main>
  );
}
