import { Injectable, type PipeTransform } from "@nestjs/common";
import { AppException, ErrorCodes } from "../../common/errors/app-exception";
import { YEAR_MONTH_PATTERN } from "../../common/validation/patterns";

/**
 * `:yearMonth` must be a business month (YYYY-MM): a malformed one is a 400,
 * never a payroll period named "abc" or "2026-13".
 */
@Injectable()
export class YearMonthPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== "string" || !YEAR_MONTH_PATTERN.test(value)) {
      throw new AppException(400, ErrorCodes.VALIDATION_FAILED, "yearMonth must be a month in the form YYYY-MM.");
    }
    return value;
  }
}

/** `:version` is a payroll version number (1, 2, ...); anything else does not exist. */
@Injectable()
export class VersionPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const version = /^[1-9]\d{0,5}$/.test(value) ? Number(value) : NaN;
    if (!Number.isInteger(version)) throw new AppException(404, ErrorCodes.NOT_FOUND, "Payroll version not found.");
    return version;
  }
}
