import {
  isValidBankAccountNumber,
  isValidBankBranchNumber,
  isValidE164PhoneNumber,
  isValidGovernmentIdNumber,
  isValidIsraeliIdNumber,
  isValidPalestinianIdNumber,
  isValidPassportNumber,
  toE164PhoneNumber,
} from "../identity";

describe("isValidIsraeliIdNumber", () => {
  it.each(["000000018", "123456782", "00018", "203398789"])("accepts %s (valid check digit)", (value) => {
    expect(isValidIsraeliIdNumber(value)).toBe(true);
  });

  it.each(["123456789", "000000019", "12345678a", "1234", "1234567890", "", "  "])("refuses %j", (value) => {
    expect(isValidIsraeliIdNumber(value)).toBe(false);
  });

  it.each(["000000000", "00000", "0000000", " 000000000 "])("refuses all zeros %j, although its check digit adds up", (value) => {
    expect(isValidIsraeliIdNumber(value)).toBe(false);
  });

  it("left-pads shorter numbers and ignores surrounding spaces", () => {
    expect(isValidIsraeliIdNumber(" 00018 ")).toBe(true);
  });
});

describe("isValidPalestinianIdNumber", () => {
  it.each(["412345678", "903456789", "850000123", " 412345678 "])("accepts 9 digits %j", (value) => {
    expect(isValidPalestinianIdNumber(value)).toBe(true);
  });

  it("does not apply the Israeli check digit (no published specification)", () => {
    expect(isValidIsraeliIdNumber("123456789")).toBe(false);
    expect(isValidPalestinianIdNumber("123456789")).toBe(true);
  });

  it.each(["000000000", "41234567", "4123456789", "00018", "41234567a", "412-345-678", "", "  "])("refuses %j", (value) => {
    expect(isValidPalestinianIdNumber(value)).toBe(false);
  });
});

describe("isValidGovernmentIdNumber", () => {
  it("checks each type by its own rule", () => {
    expect(isValidGovernmentIdNumber("ISRAELI_ID", "203398789")).toBe(true);
    expect(isValidGovernmentIdNumber("ISRAELI_ID", "123456789")).toBe(false);
    expect(isValidGovernmentIdNumber("PALESTINIAN_ID", "123456789")).toBe(true);
    expect(isValidGovernmentIdNumber("PALESTINIAN_ID", "00018")).toBe(false);
    expect(isValidGovernmentIdNumber("PASSPORT", "AB123456")).toBe(true);
  });

  it.each(["ISRAELI_ID", "PALESTINIAN_ID", "PASSPORT"])("refuses all zeros for %s", (type) => {
    expect(isValidGovernmentIdNumber(type, "000000000")).toBe(false);
  });

  it("refuses an unknown type", () => {
    expect(isValidGovernmentIdNumber("DRIVING_LICENCE", "203398789")).toBe(false);
  });
});

describe("other onboarding fields", () => {
  it("passport numbers: 5-20 letters and digits, not all zeros", () => {
    expect(isValidPassportNumber("AB123456")).toBe(true);
    expect(isValidPassportNumber("ab12")).toBe(false);
    expect(isValidPassportNumber("AB-123456")).toBe(false);
    expect(isValidPassportNumber("00000")).toBe(false);
  });

  it("phone numbers: E.164, with Israeli local numbers converted", () => {
    expect(toE164PhoneNumber("050-123 4567")).toBe("+972501234567");
    expect(toE164PhoneNumber("972501234567")).toBe("+972501234567");
    expect(toE164PhoneNumber("+972501234567")).toBe("+972501234567");
    expect(isValidE164PhoneNumber("+972501234567")).toBe(true);
    expect(isValidE164PhoneNumber("0501234567")).toBe(false);
    expect(isValidE164PhoneNumber("+97250")).toBe(false);
  });

  it("bank branch (1-4 digits) and account (2-20 digits)", () => {
    expect(isValidBankBranchNumber("612")).toBe(true);
    expect(isValidBankBranchNumber("12345")).toBe(false);
    expect(isValidBankAccountNumber("12-345")).toBe(false);
    expect(isValidBankAccountNumber("4512345")).toBe(true);
  });
});
