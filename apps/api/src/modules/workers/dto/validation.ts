import { Transform } from "class-transformer";
import { ValidateBy } from "class-validator";

/**
 * Field helpers for the public onboarding DTOs. They read the raw value from
 * the request body: the global ValidationPipe converts values to the
 * property's declared type first (`enableImplicitConversion`), which would
 * turn the string "false" into `true` or a number into a string.
 */

/** The raw value, trimmed when it is a string. */
export const Trimmed = () =>
  Transform(({ obj, key }) => {
    const raw: unknown = obj[key];
    return typeof raw === "string" ? raw.trim() : raw;
  });

/** Like `Trimmed`, with a blank string treated as absent (optional fields). */
export const TrimmedOrAbsent = () =>
  Transform(({ obj, key }) => {
    const raw: unknown = obj[key];
    if (typeof raw !== "string") return raw;
    const trimmed = raw.trim();
    return trimmed === "" ? undefined : trimmed;
  });

/** The raw value, unconverted (booleans). */
export const Raw = () => Transform(({ obj, key }) => obj[key]);

/** A string accepted by `check` (one of the shared validators). The message never includes the value. */
export const Satisfies = (check: (value: string) => boolean, message: string) =>
  ValidateBy({
    name: "satisfies",
    validator: {
      validate: (value: unknown) => typeof value === "string" && check(value),
      defaultMessage: () => message,
    },
  });

export const NOT_BLANK = /\S/;
