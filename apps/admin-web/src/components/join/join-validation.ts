import type { JoinApplicationInput } from "@fieldmaster/api-client";
import { FileAssetPurpose, GovernmentIdType, PRIVACY_NOTICE_VERSION, type OnboardingFilePurpose } from "@fieldmaster/shared-types";
import { getErrorCode } from "@fieldmaster/i18n";
import {
  isValidBankAccountNumber,
  isValidBankBranchNumber,
  isValidE164PhoneNumber,
  isValidGovernmentIdNumber,
  toE164PhoneNumber,
} from "@fieldmaster/shared-validation";

/**
 * The join form without React: what the worker typed, the checks shown next
 * to each field (the same shared validators the API runs again), the request
 * body, and what the API's refusals mean for the form. Input checks only; no
 * business rule.
 */

/** The identity documents offered, in this order. */
export const GOVERNMENT_ID_TYPES: readonly GovernmentIdType[] = [GovernmentIdType.ISRAELI_ID, GovernmentIdType.PALESTINIAN_ID, GovernmentIdType.PASSPORT];

export interface JoinFormValues {
  fullLegalName: string;
  preferredName: string;
  /** As typed; ignored when the invitation fixes the number. */
  phoneNumber: string;
  governmentIdType: GovernmentIdType;
  governmentIdNumber: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  accountHolderName: string;
  consent: boolean;
}

export const EMPTY_JOIN_FORM: JoinFormValues = {
  fullLegalName: "",
  preferredName: "",
  phoneNumber: "",
  governmentIdType: GovernmentIdType.ISRAELI_ID,
  governmentIdNumber: "",
  bankName: "",
  branchNumber: "",
  accountNumber: "",
  accountHolderName: "",
  consent: false,
};

/** Where an upload stands (see the file fields). */
export type UploadState = "empty" | "invalid" | "uploading" | "uploaded" | "failed";

/** The fields with a check, in the order they appear (the first invalid one gets the focus). */
export const JOIN_FIELDS = [
  "fullLegalName",
  "phoneNumber",
  "governmentIdNumber",
  "identityDocument",
  "profilePhoto",
  "bankName",
  "branchNumber",
  "accountNumber",
  "accountHolderName",
  "consent",
] as const;
export type JoinField = (typeof JOIN_FIELDS)[number];

export type JoinError =
  | "fullLegalNameRequired"
  | "phoneRequired"
  | "phoneInvalid"
  | "phoneMismatch"
  | "phoneTaken"
  | "idNumberRequired"
  | "idNumberAllZeros"
  | "israeliIdInvalid"
  | "palestinianIdInvalid"
  | "passportInvalid"
  | "identityDocumentRequired"
  | "fileUploading"
  | "fileNotUploaded"
  | "bankNameRequired"
  | "branchNumberInvalid"
  | "accountNumberInvalid"
  | "accountHolderNameRequired"
  | "consentRequired";

const ID_NUMBER_INVALID: Record<GovernmentIdType, JoinError> = {
  [GovernmentIdType.ISRAELI_ID]: "israeliIdInvalid",
  [GovernmentIdType.PALESTINIAN_ID]: "palestinianIdInvalid",
  [GovernmentIdType.PASSPORT]: "passportInvalid",
};

/** The number sent and signed in with: the invitation's when it fixes one, otherwise the typed one in international form. */
export function joinPhoneNumber(values: Pick<JoinFormValues, "phoneNumber">, prefilledPhoneNumber: string | null): string {
  return toE164PhoneNumber(prefilledPhoneNumber ?? values.phoneNumber);
}

function uploadProblem(state: UploadState, required: boolean): JoinError | undefined {
  switch (state) {
    case "empty":
      return required ? "identityDocumentRequired" : undefined;
    case "uploading":
      return "fileUploading";
    case "invalid":
    case "failed":
      return "fileNotUploaded";
    case "uploaded":
      return undefined;
  }
}

/** Every problem of the form; a field without one is valid. */
export function validateJoinForm(
  values: JoinFormValues,
  context: { prefilledPhoneNumber: string | null; identityDocument: UploadState; profilePhoto: UploadState },
): Partial<Record<JoinField, JoinError>> {
  const problems: Partial<Record<JoinField, JoinError>> = {};
  if (values.fullLegalName.trim() === "") problems.fullLegalName = "fullLegalNameRequired";

  if (context.prefilledPhoneNumber === null) {
    if (values.phoneNumber.trim() === "") problems.phoneNumber = "phoneRequired";
    else if (!isValidE164PhoneNumber(joinPhoneNumber(values, null))) problems.phoneNumber = "phoneInvalid";
  }

  const idNumber = values.governmentIdNumber.trim();
  if (idNumber === "") problems.governmentIdNumber = "idNumberRequired";
  else if (/^0+$/.test(idNumber)) problems.governmentIdNumber = "idNumberAllZeros";
  else if (!isValidGovernmentIdNumber(values.governmentIdType, idNumber)) problems.governmentIdNumber = ID_NUMBER_INVALID[values.governmentIdType];

  const document = uploadProblem(context.identityDocument, true);
  if (document) problems.identityDocument = document;
  const photo = uploadProblem(context.profilePhoto, false);
  if (photo) problems.profilePhoto = photo;

  if (values.bankName.trim() === "") problems.bankName = "bankNameRequired";
  if (!isValidBankBranchNumber(values.branchNumber)) problems.branchNumber = "branchNumberInvalid";
  if (!isValidBankAccountNumber(values.accountNumber)) problems.accountNumber = "accountNumberInvalid";
  if (values.accountHolderName.trim() === "") problems.accountHolderName = "accountHolderNameRequired";
  if (!values.consent) problems.consent = "consentRequired";
  return problems;
}

/** The application for a valid form and its uploaded files. */
export function buildJoinInput(
  values: JoinFormValues,
  context: { prefilledPhoneNumber: string | null; identityDocumentAssetId: string; profilePhotoAssetId: string | null },
): JoinApplicationInput {
  const preferredName = values.preferredName.trim();
  return {
    phoneNumber: joinPhoneNumber(values, context.prefilledPhoneNumber),
    fullLegalName: values.fullLegalName.trim(),
    ...(preferredName ? { preferredName } : {}),
    governmentIdType: values.governmentIdType,
    governmentIdNumber: values.governmentIdNumber.trim(),
    identityDocumentAssetId: context.identityDocumentAssetId,
    ...(context.profilePhotoAssetId ? { profilePhotoAssetId: context.profilePhotoAssetId } : {}),
    bankName: values.bankName.trim(),
    branchNumber: values.branchNumber.trim(),
    accountNumber: values.accountNumber.trim(),
    accountHolderName: values.accountHolderName.trim(),
    consentAccepted: true,
    // The version of the notice this page shows (and the worker accepted).
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  };
}

// ── The API's answers ────────────────────────────────────────────────────

/** The `details` of an API error (`{}` when there are none). */
function errorDetails(error: unknown): Record<string, unknown> {
  const details = (error as { body?: { details?: unknown } } | null)?.body?.details;
  return typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
}

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/** A refused upload: the link stopped working, the file is too large or of a refused type, or another failure (shown translated). */
export type UploadRefusal = { kind: "linkInvalid" } | { kind: "tooLarge"; maxBytes: number | null } | { kind: "wrongType" } | { kind: "failed" };

export function classifyUploadError(error: unknown): UploadRefusal {
  const code = getErrorCode(error);
  if (code === "INVITATION_INVALID_OR_EXPIRED") return { kind: "linkInvalid" };
  // 413 also when a proxy refuses the body before the API sees it (no code then).
  if (code === "FILE_TOO_LARGE" || (code === null && errorStatus(error) === 413)) {
    const maxBytes = errorDetails(error).maxBytes;
    return { kind: "tooLarge", maxBytes: typeof maxBytes === "number" && maxBytes > 0 ? maxBytes : null };
  }
  if (code === "FILE_TYPE_NOT_ALLOWED") return { kind: "wrongType" };
  return { kind: "failed" };
}

/**
 * A refused application:
 * - the link stopped working (404 INVITATION_INVALID_OR_EXPIRED);
 * - a field the API checked again (400 VALIDATION_FAILED, `details.field`);
 * - an upload it cannot find (400 UPLOAD_NOT_FOUND, `details.field`): to upload again;
 * - the phone number already has a membership with the employer (409 CONFLICT);
 * - anything else (shown translated).
 */
export type SubmitRefusal =
  | { kind: "linkInvalid" }
  | { kind: "field"; field: JoinField; error: JoinError }
  | { kind: "upload"; purpose: OnboardingFilePurpose }
  | { kind: "phoneTaken" }
  | { kind: "other" };

export function classifySubmitError(error: unknown, context: { governmentIdType: GovernmentIdType; prefilledPhoneNumber: string | null }): SubmitRefusal {
  const code = getErrorCode(error);
  const field = errorDetails(error).field;
  switch (code) {
    case "INVITATION_INVALID_OR_EXPIRED":
      return { kind: "linkInvalid" };
    case "VALIDATION_FAILED":
      if (field === "governmentIdNumber") return { kind: "field", field: "governmentIdNumber", error: ID_NUMBER_INVALID[context.governmentIdType] };
      if (field === "phoneNumber") return { kind: "field", field: "phoneNumber", error: context.prefilledPhoneNumber ? "phoneMismatch" : "phoneInvalid" };
      return { kind: "other" };
    case "UPLOAD_NOT_FOUND":
      if (field === "identityDocumentAssetId") return { kind: "upload", purpose: FileAssetPurpose.IDENTITY_DOCUMENT };
      if (field === "profilePhotoAssetId") return { kind: "upload", purpose: FileAssetPurpose.PROFILE_PHOTO };
      return { kind: "other" };
    case "CONFLICT":
      return { kind: "phoneTaken" };
    default:
      return { kind: "other" };
  }
}
