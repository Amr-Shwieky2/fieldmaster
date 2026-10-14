"use client";

import { useId, useRef, useState, type ChangeEvent, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { FieldMasterClient, JoinApplicationInput, PublicInvitation } from "@fieldmaster/api-client";
import { FileAssetPurpose, GovernmentIdType, MAX_UPLOAD_BYTES, PRIVACY_NOTICE_VERSION, UPLOAD_CONTENT_TYPES, type OnboardingFilePurpose } from "@fieldmaster/shared-types";
import { toWesternDigits } from "@fieldmaster/i18n";
import { useErrorMessage } from "@/lib/use-error-message";
import { useFormat } from "@/lib/use-format";
import { useEnumLabel } from "@/i18n/enums";
import { cn } from "@/lib/cn";
import { DateTimeText, LtrText } from "@/components/formatted";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { EMPTY_FILE, FileField, megabytes, type FileStatus } from "./file-field";
import {
  EMPTY_JOIN_FORM,
  GOVERNMENT_ID_TYPES,
  JOIN_FIELDS,
  buildJoinInput,
  classifySubmitError,
  classifyUploadError,
  validateJoinForm,
  type JoinError,
  type JoinField,
  type JoinFormValues,
} from "./join-validation";

const ltr = (chunks: ReactNode) => <LtrText>{chunks}</LtrText>;

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  id: string;
  label: string;
  hint?: ReactNode;
  optional?: boolean;
  error?: ReactNode;
}

/** A labelled input sized for a phone (16px text, so iOS does not zoom), with its hint and its validation message. */
function TextField({ id, label, hint, optional = false, error, className, ...props }: TextFieldProps) {
  const t = useTranslations("join");
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {optional ? (
          <>
            {" "}
            <span className="font-normal text-slate-500">{t("fields.optional")}</span>
          </>
        ) : null}
      </Label>
      <Input
        id={id}
        // The shared input is text-sm, which the stylesheet orders after text-base: 16px must win (iOS zooms into smaller inputs).
        className={cn("py-3 !text-base aria-[invalid=true]:border-red-500", className)}
        aria-invalid={error ? true : undefined}
        aria-required={optional || props.readOnly ? undefined : true}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  );
}

/** The browser's claim about a file; an empty claim is left to the API, which checks the content itself. */
function isAllowedType(type: string, allowed: readonly string[]): boolean {
  if (type === "") return true;
  return allowed.includes(type) || (type === "image/jpg" && allowed.includes("image/jpeg"));
}

/** The text inputs, and the check each one has (the preferred name has none). */
type TextKey = "fullLegalName" | "preferredName" | "phoneNumber" | "bankName" | "branchNumber" | "accountNumber" | "accountHolderName";
const TEXT_CHECK: Record<TextKey, JoinField | null> = {
  fullLegalName: "fullLegalName",
  preferredName: null,
  phoneNumber: "phoneNumber",
  bankName: "bankName",
  branchNumber: "branchNumber",
  accountNumber: "accountNumber",
  accountHolderName: "accountHolderName",
};

const FILE_FIELD: Record<OnboardingFilePurpose, JoinField> = {
  [FileAssetPurpose.IDENTITY_DOCUMENT]: "identityDocument",
  [FileAssetPurpose.PROFILE_PHOTO]: "profilePhoto",
};

/**
 * The application a worker fills in on a phone. Every field is checked when
 * it is left and again on «إرسال الطلب» (the message sits next to the
 * field). Files are checked for size and type at once and uploaded as soon
 * as they are chosen; the application then refers to them by id. What the
 * API refuses is shown on the field concerned (a number it checked again, a
 * file to upload again, a phone number already registered). After it is
 * sent, this form is unmounted, so nothing the worker typed (ID number, bank
 * details) is kept or shown again.
 */
export function JoinForm({
  token,
  client,
  invitation,
  onSubmitted,
  onLinkInvalid,
}: {
  token: string;
  client: FieldMasterClient;
  invitation: PublicInvitation;
  onSubmitted: (phoneNumber: string) => void;
  onLinkInvalid: () => void;
}) {
  const t = useTranslations("join");
  const enumLabel = useEnumLabel();
  const errorMessage = useErrorMessage();
  const format = useFormat();
  const id = useId();
  const [values, setValues] = useState<JoinFormValues>(EMPTY_JOIN_FORM);
  const [touched, setTouched] = useState<Partial<Record<JoinField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  // What the API refused on the last submit, until the field changes.
  const [refused, setRefused] = useState<Partial<Record<JoinField, JoinError>>>({});
  const [files, setFiles] = useState<Record<OnboardingFilePurpose, FileStatus>>({
    [FileAssetPurpose.IDENTITY_DOCUMENT]: EMPTY_FILE,
    [FileAssetPurpose.PROFILE_PHOTO]: EMPTY_FILE,
  });
  // The latest upload of each field; an older one finishing late is ignored.
  const uploads = useRef<Record<OnboardingFilePurpose, number>>({ [FileAssetPurpose.IDENTITY_DOCUMENT]: 0, [FileAssetPurpose.PROFILE_PHOTO]: 0 });

  const prefilledPhoneNumber = invitation.prefilledPhoneNumber;
  const maxBytes = invitation.maxUploadBytes > 0 ? invitation.maxUploadBytes : MAX_UPLOAD_BYTES;
  const maxMegabytes = megabytes(maxBytes, format);
  const allowedTypes = (purpose: OnboardingFilePurpose): readonly string[] => {
    const fromApi = invitation.allowedContentTypes?.[purpose];
    return fromApi && fromApi.length > 0 ? fromApi : UPLOAD_CONTENT_TYPES[purpose];
  };

  const fieldId = (field: JoinField) => `${id}-${field}`;
  const focus = (field: JoinField) => document.getElementById(fieldId(field))?.focus();
  const clearRefused = (...fields: JoinField[]) =>
    setRefused((previous) => {
      if (!fields.some((field) => field in previous)) return previous;
      const next = { ...previous };
      for (const field of fields) delete next[field];
      return next;
    });
  const update = (patch: Partial<JoinFormValues>) => setValues((previous) => ({ ...previous, ...patch }));
  const touch = (field: JoinField) => setTouched((previous) => (previous[field] ? previous : { ...previous, [field]: true }));
  const setFile = (purpose: OnboardingFilePurpose, status: FileStatus) => setFiles((previous) => ({ ...previous, [purpose]: status }));

  const problems: Partial<Record<JoinField, JoinError>> = {
    ...validateJoinForm(values, {
      prefilledPhoneNumber,
      identityDocument: files.IDENTITY_DOCUMENT.kind,
      profilePhoto: files.PROFILE_PHOTO.kind,
    }),
    ...refused,
  };
  const message = (field: JoinField): ReactNode => {
    // A file's own status line explains it until the form is submitted (an upload in progress is not an error).
    const shown = submitted || field in refused || (touched[field] && field !== "identityDocument" && field !== "profilePhoto");
    const problem = shown ? problems[field] : undefined;
    return problem ? t.rich(`errors.${problem}`, { ltr }) : undefined;
  };

  const selectFile = async (purpose: OnboardingFilePurpose, file: File) => {
    touch(FILE_FIELD[purpose]);
    const sequence = ++uploads.current[purpose];
    const fileName = file.name || purpose.toLowerCase();
    if (file.size > maxBytes) {
      setFile(purpose, { kind: "invalid", reason: "tooLarge", fileName });
      return;
    }
    if (!isAllowedType(file.type, allowedTypes(purpose))) {
      setFile(purpose, { kind: "invalid", reason: "wrongType", fileName });
      return;
    }
    setFile(purpose, { kind: "uploading", fileName });
    try {
      const uploaded = await client.uploadOnboardingFile(token, purpose, file, fileName);
      if (uploads.current[purpose] === sequence) setFile(purpose, { kind: "uploaded", fileName, fileAssetId: uploaded.fileAssetId });
    } catch (error) {
      if (uploads.current[purpose] !== sequence) return;
      // The API checks the file's real content: its refusals read like the page's own checks.
      const refusal = classifyUploadError(error);
      if (refusal.kind === "linkInvalid") onLinkInvalid();
      else if (refusal.kind === "tooLarge") setFile(purpose, { kind: "invalid", reason: "tooLarge", fileName, maxBytes: refusal.maxBytes ?? undefined });
      else if (refusal.kind === "wrongType") setFile(purpose, { kind: "invalid", reason: "wrongType", fileName });
      else setFile(purpose, { kind: "failed", fileName, error });
    }
  };
  const removeFile = (purpose: OnboardingFilePurpose) => {
    uploads.current[purpose] += 1;
    setFile(purpose, EMPTY_FILE);
  };

  const submit = useMutation({
    mutationFn: (input: JoinApplicationInput) => client.submitJoinApplication(token, input),
    // The application holds the ID and bank details: do not keep it once this form is gone.
    gcTime: 0,
    onSuccess: (_result, input) => onSubmitted(input.phoneNumber),
    onError: (error, input) => {
      const refusal = classifySubmitError(error, { governmentIdType: input.governmentIdType, prefilledPhoneNumber });
      switch (refusal.kind) {
        case "linkInvalid":
          onLinkInvalid();
          return;
        case "field":
          setRefused((previous) => ({ ...previous, [refusal.field]: refusal.error }));
          focus(refusal.field);
          return;
        case "upload": {
          // The API lost track of this upload: the worker chooses the file again.
          const purpose = refusal.purpose;
          uploads.current[purpose] += 1;
          setFiles((previous) => {
            const current = previous[purpose];
            const fileName = current.kind === "empty" ? "" : current.fileName;
            return { ...previous, [purpose]: { kind: "failed", fileName, error } };
          });
          focus(FILE_FIELD[purpose]);
          return;
        }
        case "phoneTaken":
          // A number the worker typed can be corrected here; one the invitation fixed cannot.
          if (prefilledPhoneNumber === null) {
            setRefused((previous) => ({ ...previous, phoneNumber: "phoneTaken" }));
            focus("phoneNumber");
          }
          return;
        default:
          return;
      }
    },
  });
  const submitRefusal = submit.isError ? classifySubmitError(submit.error, { governmentIdType: values.governmentIdType, prefilledPhoneNumber }) : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    const firstProblem = JOIN_FIELDS.find((field) => problems[field]);
    if (firstProblem) {
      focus(firstProblem);
      return;
    }
    const identity = files.IDENTITY_DOCUMENT;
    const photo = files.PROFILE_PHOTO;
    if (identity.kind !== "uploaded") return;
    submit.mutate(
      buildJoinInput(values, {
        prefilledPhoneNumber,
        identityDocumentAssetId: identity.fileAssetId,
        profilePhotoAssetId: photo.kind === "uploaded" ? photo.fileAssetId : null,
      }),
    );
  };

  const hasProblems = JOIN_FIELDS.some((field) => problems[field]);
  // One message above the button: fields to correct (the page's checks or the API's), a number the
  // invitation fixed that is already registered, or any other refusal, translated.
  let submitAlert: ReactNode = null;
  if (submitted && hasProblems) submitAlert = t("errors.summary");
  else if (submitRefusal?.kind === "phoneTaken") submitAlert = t("errors.phoneTaken");
  else if (submitRefusal?.kind === "other") submitAlert = t("submitFailed", { message: errorMessage(submit.error) });
  const textProps = (key: TextKey, digitsOnly = false) => {
    const check = TEXT_CHECK[key];
    return {
      id: `${id}-${key}`,
      value: values[key],
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const next = digitsOnly ? toWesternDigits(event.target.value) : event.target.value;
        setValues((previous) => ({ ...previous, [key]: next }));
        if (check) clearRefused(check);
      },
      onBlur: check ? () => touch(check) : undefined,
      error: check ? message(check) : undefined,
    };
  };
  const idType = values.governmentIdType;
  const passport = idType === GovernmentIdType.PASSPORT;
  const nameProps = textProps("fullLegalName");
  const preferredNameProps = textProps("preferredName");
  const phoneProps = textProps("phoneNumber", true);
  const bankNameProps = textProps("bankName");
  const branchProps = textProps("branchNumber", true);
  const accountProps = textProps("accountNumber", true);
  const holderProps = textProps("accountHolderName");
  const consentError = message("consent");
  const phoneError = message("phoneNumber");
  const consentErrorId = `${fieldId("consent")}-error`;

  return (
    <form noValidate onSubmit={onSubmit} aria-labelledby={`${id}-title`} className="space-y-4">
      <Card>
        <CardContent className="space-y-2 py-5">
          <h1 id={`${id}-title`} className="text-xl font-bold text-slate-900">
            {t("title", { organization: invitation.organizationName })}
          </h1>
          <p className="text-sm text-slate-600">{t("intro")}</p>
          <p className="text-xs text-slate-500">{t.rich("expires", { date: () => <DateTimeText value={invitation.expiresAt} /> })}</p>
          <p className="text-xs text-slate-500">{t("requiredNote")}</p>
        </CardContent>
      </Card>

      <Section title={t("sections.personal")}>
        <TextField
          {...nameProps}
          label={t("fields.fullLegalName")}
          hint={t("fields.fullLegalNameHint")}
          autoComplete="name"
          dir="auto"
          className="text-start"
        />
        <TextField
          {...preferredNameProps}
          optional
          label={t("fields.preferredName")}
          hint={t("fields.preferredNameHint")}
          autoComplete="nickname"
          dir="auto"
          className="text-start"
        />
        {prefilledPhoneNumber ? (
          <TextField
            id={fieldId("phoneNumber")}
            label={t("fields.phone")}
            hint={t("fields.phonePrefilledHint")}
            type="tel"
            dir="ltr"
            readOnly
            value={prefilledPhoneNumber}
            error={phoneError}
            className="bg-slate-100 text-start"
          />
        ) : (
          <TextField
            {...phoneProps}
            label={t("fields.phone")}
            hint={t.rich("fields.phoneHint", { ltr })}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="050-1234567"
            className="text-start"
          />
        )}
      </Section>

      <Section title={t("sections.identity")}>
        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-slate-700">{t("fields.idType")}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {GOVERNMENT_ID_TYPES.map((type) => (
              <label
                key={type}
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-4 py-3 text-base",
                  idType === type ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-slate-300 bg-white text-slate-800",
                )}
              >
                <input
                  type="radio"
                  name={`${id}-idType`}
                  value={type}
                  checked={idType === type}
                  onChange={() => {
                    update({ governmentIdType: type });
                    clearRefused("governmentIdNumber");
                  }}
                  className="h-5 w-5 shrink-0"
                />
                {enumLabel("GovernmentIdType", type)}
              </label>
            ))}
          </div>
        </fieldset>
        <TextField
          id={fieldId("governmentIdNumber")}
          label={t("fields.idNumber")}
          hint={t(`fields.idNumberHint.${idType}`)}
          value={values.governmentIdNumber}
          onChange={(event) => {
            update({ governmentIdNumber: passport ? event.target.value : toWesternDigits(event.target.value) });
            clearRefused("governmentIdNumber");
          }}
          onBlur={() => touch("governmentIdNumber")}
          error={message("governmentIdNumber")}
          inputMode={passport ? "text" : "numeric"}
          autoComplete="off"
          autoCapitalize={passport ? "characters" : "off"}
          spellCheck={false}
          dir="ltr"
          className="text-start font-mono"
        />
        <FileField
          id={fieldId("identityDocument")}
          label={t("fields.identityDocument")}
          hint={t("fields.identityDocumentHint", { max: maxMegabytes })}
          optional={false}
          accept={allowedTypes(FileAssetPurpose.IDENTITY_DOCUMENT).join(",")}
          status={files.IDENTITY_DOCUMENT}
          wrongTypeMessage={t("file.wrongTypeDocument")}
          maxBytes={maxBytes}
          error={message("identityDocument")}
          onSelect={(file) => void selectFile(FileAssetPurpose.IDENTITY_DOCUMENT, file)}
          onRemove={() => removeFile(FileAssetPurpose.IDENTITY_DOCUMENT)}
        />
        <FileField
          id={fieldId("profilePhoto")}
          label={t("fields.profilePhoto")}
          hint={t("fields.profilePhotoHint", { max: maxMegabytes })}
          optional
          accept={allowedTypes(FileAssetPurpose.PROFILE_PHOTO).join(",")}
          status={files.PROFILE_PHOTO}
          wrongTypeMessage={t("file.wrongTypePhoto")}
          maxBytes={maxBytes}
          error={message("profilePhoto")}
          onSelect={(file) => void selectFile(FileAssetPurpose.PROFILE_PHOTO, file)}
          onRemove={() => removeFile(FileAssetPurpose.PROFILE_PHOTO)}
        />
      </Section>

      <Section title={t("sections.bank")}>
        <TextField {...bankNameProps} label={t("fields.bankName")} autoComplete="off" dir="auto" className="text-start" />
        <TextField {...branchProps} label={t("fields.branchNumber")} inputMode="numeric" autoComplete="off" dir="ltr" className="text-start" />
        <TextField {...accountProps} label={t("fields.accountNumber")} inputMode="numeric" autoComplete="off" dir="ltr" className="text-start" />
        <TextField {...holderProps} label={t("fields.accountHolderName")} autoComplete="off" dir="auto" className="text-start" />
      </Section>

      <Section title={t("sections.privacy")}>
        <div id={`${id}-notice`} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
          <p>{t("privacy.intro", { organization: invitation.organizationName })}</p>
          <ul className="list-disc space-y-1 ps-5">
            <li>{t("privacy.collected")}</li>
            <li>{t("privacy.purpose")}</li>
            <li>{t("privacy.protection")}</li>
            <li>{t("privacy.access")}</li>
            <li>{t("privacy.retention")}</li>
            <li>{t("privacy.voluntary")}</li>
            <li>{t("privacy.rights")}</li>
          </ul>
          <p className="text-xs text-slate-500">{t.rich("privacy.version", { version: PRIVACY_NOTICE_VERSION, ltr })}</p>
        </div>
        <div>
          <label className="flex cursor-pointer items-start gap-3 text-base text-slate-800">
            <input
              id={fieldId("consent")}
              type="checkbox"
              checked={values.consent}
              onChange={(event) => {
                update({ consent: event.target.checked });
                touch("consent");
              }}
              aria-required
              aria-invalid={consentError ? true : undefined}
              aria-describedby={consentError ? `${id}-notice ${consentErrorId}` : `${id}-notice`}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>{t("privacy.consent")}</span>
          </label>
          {consentError ? (
            <p id={consentErrorId} className="mt-1 text-sm text-red-600">
              {consentError}
            </p>
          ) : null}
        </div>
      </Section>

      {submitAlert ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitAlert}
        </p>
      ) : null}
      <Button type="submit" className="w-full py-3 !text-base" disabled={submit.isPending}>
        {submit.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
