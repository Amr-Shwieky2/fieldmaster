import { evaluateForgottenStampInfraction } from "../forgotten-stamp";

describe("evaluateForgottenStampInfraction (two-strike rule, scenario 5)", () => {
  it("first infraction: no deduction", () => {
    expect(evaluateForgottenStampInfraction(1).deductionAgorot).toBe(0);
  });

  it("second infraction: no deduction", () => {
    expect(evaluateForgottenStampInfraction(2).deductionAgorot).toBe(0);
  });

  it("third infraction: 1000 agorot (10 ILS) deduction", () => {
    expect(evaluateForgottenStampInfraction(3).deductionAgorot).toBe(1000);
  });

  it("fourth and later infractions: 1000 agorot each", () => {
    expect(evaluateForgottenStampInfraction(4).deductionAgorot).toBe(1000);
    expect(evaluateForgottenStampInfraction(10).deductionAgorot).toBe(1000);
  });

  it("rejects a sequence number below 1", () => {
    expect(() => evaluateForgottenStampInfraction(0)).toThrow();
  });
});
