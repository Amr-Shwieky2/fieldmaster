import { GovernmentIdType } from "@fieldmaster/shared-types";

/**
 * The stored form of a document number that passed `isValidGovernmentIdNumber`:
 * an Israeli ID with its leading zeros (9 digits, as printed on the card), a
 * passport number in capitals, a Palestinian ID as typed (always 9 digits).
 */
export function normalizeGovernmentIdNumber(type: GovernmentIdType, value: string): string {
  const trimmed = value.trim();
  switch (type) {
    case GovernmentIdType.ISRAELI_ID:
      return trimmed.padStart(9, "0");
    case GovernmentIdType.PASSPORT:
      return trimmed.toUpperCase();
    case GovernmentIdType.PALESTINIAN_ID:
      return trimmed;
  }
}

export function isGovernmentIdType(value: unknown): value is GovernmentIdType {
  return typeof value === "string" && (Object.values(GovernmentIdType) as string[]).includes(value);
}
