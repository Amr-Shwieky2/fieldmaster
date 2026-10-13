"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { isValidE164PhoneNumber, toE164PhoneNumber } from "@fieldmaster/shared-validation";
import { useAuth } from "@/lib/auth-context";
import { useErrorMessage } from "@/lib/use-error-message";
import { DateTimeText, LtrText, Phone } from "@/components/formatted";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

/** React Query key of the invitations list. */
export const invitationKeys = { list: ["onboarding-invitations"] as const };

interface CreatedLink {
  link: string;
  expiresAt: string;
  phoneNumber: string | null;
}

/**
 * The link of the invitation just created. The API returns its token only
 * once (it stores a hash), so the link cannot be shown again later: it is
 * copied now («نسخ الرابط»), or selected for a manual copy when the
 * clipboard is not available.
 */
function CreatedInvitationLink({ created }: { created: CreatedLink }) {
  const t = useTranslations("invitations");
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");

  const copyLink = async () => {
    try {
      if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") throw new Error("no clipboard");
      await navigator.clipboard.writeText(created.link);
      setCopy("copied");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopy("manual");
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <h3 id={`${id}-title`} className="font-semibold">
        {t("created.title")}
      </h3>
      <div>
        <Label htmlFor={`${id}-link`} className="text-emerald-900">
          {t("created.linkLabel")}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            ref={inputRef}
            id={`${id}-link`}
            readOnly
            dir="ltr"
            value={created.link}
            onFocus={(event) => event.currentTarget.select()}
            aria-describedby={`${id}-once`}
            className="min-w-0 bg-white font-mono text-xs"
          />
          <Button type="button" onClick={() => void copyLink()} className="shrink-0">
            {t("created.copy")}
          </Button>
        </div>
      </div>
      <p role="status" className="font-medium empty:hidden">
        {copy === "copied" ? t("created.copied") : copy === "manual" ? t("created.copyManual") : null}
      </p>
      <p id={`${id}-once`} className="font-medium">
        {t("created.onceOnly")}
      </p>
      <p>{t.rich("created.expires", { date: () => <DateTimeText value={created.expiresAt} /> })}</p>
      {created.phoneNumber ? <p>{t.rich("created.phone", { phone: () => <Phone value={created.phoneNumber} /> })}</p> : null}
    </section>
  );
}

/**
 * «دعوة عامل»: a single-use join link, optionally tied to the worker's phone
 * number (typed locally or internationally; sent in international form). The
 * worker opens the link on a phone, fills in the application, and an Owner
 * reviews it.
 */
export function CreateInvitationCard() {
  const t = useTranslations("invitations");
  const errorMessage = useErrorMessage();
  const { client } = useAuth();
  const queryClient = useQueryClient();
  const id = useId();
  const [phone, setPhone] = useState("");
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);

  const create = useMutation({
    mutationFn: (prefilledPhoneNumber: string | undefined) => client.createInvitation(prefilledPhoneNumber),
    onMutate: () => setCreated(null),
    onSuccess: (result, prefilledPhoneNumber) => {
      setCreated({ link: `${window.location.origin}${result.joinPath}`, expiresAt: result.expiresAt, phoneNumber: prefilledPhoneNumber ?? null });
      setPhone("");
      void queryClient.invalidateQueries({ queryKey: invitationKeys.list });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = phone.trim();
    if (typed === "") {
      setPhoneInvalid(false);
      create.mutate(undefined);
      return;
    }
    const normalized = toE164PhoneNumber(typed);
    if (!isValidE164PhoneNumber(normalized)) {
      setPhoneInvalid(true);
      document.getElementById(`${id}-phone`)?.focus();
      return;
    }
    setPhoneInvalid(false);
    create.mutate(normalized);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("create.title")}</CardTitle>
        <p className="mt-1 text-sm text-slate-500">{t("create.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form noValidate onSubmit={submit} className="space-y-3">
          <div className="max-w-md">
            <Label htmlFor={`${id}-phone`}>{t("create.phone")}</Label>
            <Input
              id={`${id}-phone`}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              dir="ltr"
              className="text-start"
              placeholder="050-1234567"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setPhoneInvalid(false);
              }}
              aria-invalid={phoneInvalid || undefined}
              aria-describedby={`${id}-phone-hint${phoneInvalid ? ` ${id}-phone-error` : ""}`}
            />
            <p id={`${id}-phone-hint`} className="mt-1 text-xs text-slate-500">
              {t("create.phoneHint")}
            </p>
            {phoneInvalid ? (
              <p id={`${id}-phone-error`} role="alert" className="mt-1 text-xs text-red-600">
                {t.rich("create.phoneInvalid", { ltr: (chunks) => <LtrText>{chunks}</LtrText> })}
              </p>
            ) : null}
          </div>
          {create.isError ? (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {t("create.failed", { message: errorMessage(create.error) })}
            </p>
          ) : null}
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t("create.submitting") : t("create.submit")}
          </Button>
        </form>
        {created ? <CreatedInvitationLink key={created.link} created={created} /> : null}
      </CardContent>
    </Card>
  );
}
