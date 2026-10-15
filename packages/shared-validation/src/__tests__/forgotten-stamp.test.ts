import { evaluateForgottenStampInfraction, forgottenStampInfractionMonth } from "../forgotten-stamp";
import { RULES } from "./rules";

describe("evaluateForgottenStampInfraction (two-strike rule, scenario 5)", () => {
  it("first infraction: no deduction", () => {
    expect(evaluateForgottenStampInfraction(1, RULES).deductionAgorot).toBe(0);
  });

  it("second infraction: no deduction", () => {
    expect(evaluateForgottenStampInfraction(2, RULES).deductionAgorot).toBe(0);
  });

  it("third infraction: 1000 agorot (10 ILS) deduction", () => {
    expect(evaluateForgottenStampInfraction(3, RULES).deductionAgorot).toBe(1000);
  });

  it("fourth and later infractions: 1000 agorot each", () => {
    expect(evaluateForgottenStampInfraction(4, RULES).deductionAgorot).toBe(1000);
    expect(evaluateForgottenStampInfraction(10, RULES).deductionAgorot).toBe(1000);
  });

  it("rejects a sequence number below 1", () => {
    expect(() => evaluateForgottenStampInfraction(0, RULES)).toThrow();
  });
});

describe("forgottenStampInfractionMonth (which month an infraction counts in)", () => {
  // 2026-11-01 00:30 in Asia/Jerusalem (UTC+2 after DST ended on 2026-10-25).
  const firstOfNovemberLocal = new Date("2026-10-31T22:30:00.000Z");
  const midOctober = new Date("2026-10-15T09:00:00.000Z");

  it("a correction that creates the missing entry counts in the month of the clock-in it adds (Asia/Jerusalem)", () => {
    expect(forgottenStampInfractionMonth({ createsTimeEntry: true, clockInAt: firstOfNovemberLocal }, midOctober)).toBe("2026-11");
    expect(forgottenStampInfractionMonth({ createsTimeEntry: true, clockInAt: midOctober }, firstOfNovemberLocal)).toBe("2026-10");
  });

  it("a correction to an existing entry counts in the month it is made", () => {
    expect(forgottenStampInfractionMonth({ createsTimeEntry: false, clockInAt: midOctober }, firstOfNovemberLocal)).toBe("2026-11");
    expect(forgottenStampInfractionMonth({ createsTimeEntry: false }, midOctober)).toBe("2026-10");
  });

  it("needs the clock-in when the correction creates the entry", () => {
    expect(() => forgottenStampInfractionMonth({ createsTimeEntry: true })).toThrow();
  });
});
