import { AppException } from "../../../common/errors/app-exception";
import { VersionPipe, YearMonthPipe } from "../payroll-params";

describe("payroll route parameters", () => {
  it("accepts a business month and refuses anything else with a 400 (no period named 2026-13 is ever created)", () => {
    const pipe = new YearMonthPipe();
    expect(pipe.transform("2026-10")).toBe("2026-10");
    for (const value of ["2026-13", "2026-1", "2026-00", "abc", "2026-10-01", ""]) {
      expect(() => pipe.transform(value)).toThrow(AppException);
      try {
        pipe.transform(value);
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(400);
      }
    }
  });

  it("reads a version number; anything else is a version that does not exist (404)", () => {
    const pipe = new VersionPipe();
    expect(pipe.transform("1")).toBe(1);
    expect(pipe.transform("12")).toBe(12);
    for (const value of ["0", "-1", "1.5", "01", "x", "9999999"]) {
      expect(() => pipe.transform(value)).toThrow(AppException);
      try {
        pipe.transform(value);
      } catch (error) {
        expect((error as AppException).getStatus()).toBe(404);
      }
    }
  });
});
