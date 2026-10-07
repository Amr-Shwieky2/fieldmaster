import { describe, expect, it } from "vitest";
import * as sharedTypes from "@fieldmaster/shared-types";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import { ENUM_NAMES } from "../enums";

type Labels = Record<string, Record<string, string>>;

const enumObjects = Object.entries(sharedTypes).filter(
  ([name, value]) => /^[A-Z]/.test(name) && typeof value === "object" && value !== null && Object.values(value).every((v) => typeof v === "string"),
) as [string, Record<string, string>][];

describe("enum labels", () => {
  it("ENUM_NAMES lists exactly the enums exported by @fieldmaster/shared-types", () => {
    expect([...ENUM_NAMES].sort()).toEqual(enumObjects.map(([name]) => name).sort());
  });

  it.each(enumObjects)("%s has a label for every value in Arabic and English", (name, values) => {
    for (const value of Object.values(values)) {
      expect((ar.enums as Labels)[name]?.[value], `ar enums.${name}.${value}`).toBeTruthy();
      expect((en.enums as Labels)[name]?.[value], `en enums.${name}.${value}`).toBeTruthy();
    }
  });
});
