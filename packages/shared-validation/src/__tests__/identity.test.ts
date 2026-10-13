import {
  isValidBankAccountNumber,
  isValidBankBranchNumber,
  isValidE164PhoneNumber,
  isValidIsraeliIdNumber,
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

  it("left-pads shorter numbers and ignores surrounding spaces", () => {
    expect(isValidIsraeliIdNumber(" 00018 ")).toBe(true);
  });
});

describe("other onboarding fields", () => {
  it("passport numbers: 5-20 letters and digits", () => {
    expect(isValidPassportNumber("AB123456")).toBe(true);
    expect(isValidPassportNumber("ab12")).toBe(false);
    expect(isValidPassportNumber("AB-123456")).toBe(false);
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
