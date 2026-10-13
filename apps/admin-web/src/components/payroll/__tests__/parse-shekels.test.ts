import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_AGOROT, parseShekelsToAgorot } from "../parse-shekels";

describe("parseShekelsToAgorot (manual adjustment amount)", () => {
  it.each([
    ["12.5", 1250],
    ["12.50", 1250],
    ["0.07", 7],
    ["0.1", 10],
    ["1.10", 110],
    ["150", 15000],
    ["007.5", 750],
    ["  42.30  ", 4230],
    // Values that are inexact as binary floating point stay exact: 1.15 * 100 would be 114.99999999999999.
    ["1.15", 115],
    ["4.35", 435],
    ["123456.78", 12345678],
    // Typed on an Arabic keyboard: Arabic-Indic digits and the Arabic decimal separator.
    ["١٢٫٥", 1250],
  ])("reads %j as %i agorot", (input, agorot) => {
    expect(parseShekelsToAgorot(input)).toEqual({ ok: true, agorot });
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["0", "zero"],
    ["0.00", "zero"],
    ["00.0", "zero"],
    ["-5", "negative"],
    ["-0.50", "negative"],
    ["1.234", "tooManyDecimals"],
    ["0.001", "tooManyDecimals"],
    ["abc", "invalid"],
    ["12a", "invalid"],
    ["1,000", "invalid"],
    ["1e3", "invalid"],
    [".5", "invalid"],
    ["5.", "invalid"],
    ["+5", "invalid"],
    ["--5", "invalid"],
    ["₪ 5", "invalid"],
    ["1.2.3", "invalid"],
    ["Infinity", "invalid"],
    ["NaN", "invalid"],
    ["1000001", "tooLarge"],
    ["999999999999999999999", "tooLarge"],
  ])("refuses %j (%s)", (input, error) => {
    expect(parseShekelsToAgorot(input)).toEqual({ ok: false, error });
  });

  it("accepts the largest adjustment the API accepts (₪1,000,000) and nothing above it", () => {
    expect(parseShekelsToAgorot("1000000")).toEqual({ ok: true, agorot: MAX_AMOUNT_AGOROT });
    expect(parseShekelsToAgorot("1000000.01")).toEqual({ ok: false, error: "tooLarge" });
  });
});
