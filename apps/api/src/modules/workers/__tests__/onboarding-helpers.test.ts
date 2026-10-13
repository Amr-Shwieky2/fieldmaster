import { GovernmentIdType } from "@fieldmaster/shared-types";
import { isGovernmentIdType, normalizeGovernmentIdNumber } from "../government-id";
import { ONBOARDING_RATE_LIMIT_DEFAULT, onboardingRateLimit } from "../onboarding-rate-limit";

describe("normalizeGovernmentIdNumber", () => {
  it("stores an Israeli ID with its leading zeros, a passport number in capitals, a Palestinian ID as typed", () => {
    expect(normalizeGovernmentIdNumber(GovernmentIdType.ISRAELI_ID, " 31415926 ")).toBe("031415926");
    expect(normalizeGovernmentIdNumber(GovernmentIdType.ISRAELI_ID, "314159260")).toBe("314159260");
    expect(normalizeGovernmentIdNumber(GovernmentIdType.PASSPORT, "ab12345")).toBe("AB12345");
    expect(normalizeGovernmentIdNumber(GovernmentIdType.PALESTINIAN_ID, "123456789")).toBe("123456789");
  });

  it("knows the document types", () => {
    expect(Object.values(GovernmentIdType).every(isGovernmentIdType)).toBe(true);
    expect(isGovernmentIdType("NATIONAL_ID")).toBe(false);
    expect(isGovernmentIdType(null)).toBe(false);
  });
});

describe("onboardingRateLimit (read from ONBOARDING_RATE_LIMIT on every request)", () => {
  const original = process.env.ONBOARDING_RATE_LIMIT;
  afterEach(() => {
    if (original === undefined) delete process.env.ONBOARDING_RATE_LIMIT;
    else process.env.ONBOARDING_RATE_LIMIT = original;
  });

  it("uses a positive integer from the environment, else the default", () => {
    delete process.env.ONBOARDING_RATE_LIMIT;
    expect(onboardingRateLimit()).toBe(ONBOARDING_RATE_LIMIT_DEFAULT);
    process.env.ONBOARDING_RATE_LIMIT = "3";
    expect(onboardingRateLimit()).toBe(3);
    for (const invalid of ["", "0", "-2", "2.5", "ten"]) {
      process.env.ONBOARDING_RATE_LIMIT = invalid;
      expect(onboardingRateLimit()).toBe(ONBOARDING_RATE_LIMIT_DEFAULT);
    }
  });
});
