import { describe, expect, it } from "vitest";
import * as sharedTypes from "@fieldmaster/shared-types";
import { createTranslator } from "use-intl";
import ar from "../messages/ar.json";
import { INTL_LOCALE } from "../config";
import { ENUM_NAMES, getEnumLabel, MISSING_LABEL, type EnumTranslator } from "../enums";

type Labels = Record<string, Record<string, string>>;

const enumObjects = Object.entries(sharedTypes).filter(
  ([name, value]) => /^[A-Z]/.test(name) && typeof value === "object" && value !== null && Object.values(value).every((v) => typeof v === "string"),
) as [string, Record<string, string>][];

describe("enum labels", () => {
  it("ENUM_NAMES lists exactly the enums exported by @fieldmaster/shared-types", () => {
    expect([...ENUM_NAMES].sort()).toEqual(enumObjects.map(([name]) => name).sort());
  });

  it.each(enumObjects)("%s has an Arabic label for every value", (name, values) => {
    for (const value of Object.values(values)) {
      const label = (ar.enums as Labels)[name]?.[value];
      expect(label, `ar enums.${name}.${value}`).toBeTruthy();
      expect(label, `ar enums.${name}.${value} must be Arabic`).toMatch(/[ء-ي]/);
    }
  });

  it("shows the Arabic label, the raw code for a value without a label (never made-up English), and a dash for nothing", () => {
    const t = createTranslator({ locale: INTL_LOCALE, messages: ar, namespace: "enums" }) as unknown as EnumTranslator;
    expect(getEnumLabel(t, "OrgRole", "OWNER")).toBe("المالك");
    expect(getEnumLabel(t, "CorrectionReason", "BRAND_NEW_REASON")).toBe("BRAND_NEW_REASON");
    expect(getEnumLabel(t, "OrgRole", null)).toBe(MISSING_LABEL);
  });
});
