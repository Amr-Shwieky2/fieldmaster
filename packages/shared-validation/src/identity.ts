/**
 * Shapes of what a worker types on the public onboarding page (Step 8). The
 * page checks them as the worker types (clear Arabic messages) and the API
 * checks them again: input validation only, no business rule.
 */

/**
 * An Israeli ID number (מספר זהות): up to 9 digits (shorter ones are
 * left-padded with zeros) whose check digit is valid: every digit is
 * multiplied by 1, 2, 1, 2, ... from the left, two-digit products have their
 * digits added, and the total is a multiple of 10.
 */
export function isValidIsraeliIdNumber(raw: string): boolean {
  const value = raw.trim();
  if (!/^\d{5,9}$/.test(value)) return false;
  const digits = value.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const product = Number(digits[i]) * ((i % 2) + 1);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}

/** A passport number: 5 to 20 Latin letters and digits (case-insensitive). */
export function isValidPassportNumber(raw: string): boolean {
  return /^[A-Za-z0-9]{5,20}$/.test(raw.trim());
}

/** A phone number in international (E.164) form, the form workers sign in with: "+" and 8 to 15 digits. */
export function isValidE164PhoneNumber(raw: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(raw.trim());
}

/**
 * The international form of a phone number typed on the page: an Israeli
 * mobile number typed locally ("050-1234567", "0501234567") becomes
 * "+972501234567"; spaces and dashes are dropped; anything else is returned
 * cleaned up but otherwise as typed (the validator then decides).
 */
export function toE164PhoneNumber(raw: string): string {
  const compact = raw.trim().replace(/[\s()-]/g, "");
  if (/^0\d{8,9}$/.test(compact)) return `+972${compact.slice(1)}`;
  if (/^972\d{8,9}$/.test(compact)) return `+${compact}`;
  return compact;
}

/** A bank branch number: 1 to 4 digits. */
export function isValidBankBranchNumber(raw: string): boolean {
  return /^\d{1,4}$/.test(raw.trim());
}

/** A bank account number: 2 to 20 digits. */
export function isValidBankAccountNumber(raw: string): boolean {
  return /^\d{2,20}$/.test(raw.trim());
}
