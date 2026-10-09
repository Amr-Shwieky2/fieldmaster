import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sharedMessages } from "@fieldmaster/i18n";
import { GLOSSARY, arabicOnlyProblems, emptyValueProblems, flatten, glossaryProblems, messageFileProblems, overlapProblems, scriptProblems } from "@fieldmaster/i18n/check";
import app from "../messages/ar.json";
import ar from "@/i18n/messages";

// The same rules `pnpm lint` (scripts/check-i18n.mjs) enforces, as unit tests on the admin web's own file.
describe("admin web messages (shared + src/i18n/messages/ar.json)", () => {
  it("keeps ar.json as the only messages file and never redefines a shared key", () => {
    expect(messageFileProblems(join(process.cwd(), "src/i18n/messages"))).toEqual([]);
    expect(overlapProblems(flatten(sharedMessages), flatten(app), "admin web")).toEqual([]);
  });

  it("reads in Arabic everywhere (only the brand name is not), with no empty values, Hebrew or Arabic-Indic digits", () => {
    const merged = flatten(ar);
    expect([...emptyValueProblems(merged), ...arabicOnlyProblems(merged, new Set(["shell.brand"])), ...scriptProblems(merged)]).toEqual([]);
  });

  it("uses the full mandatory glossary exactly, including the admin web's navigation terms", () => {
    const merged = flatten(ar) as Record<string, string>;
    expect(glossaryProblems(merged, GLOSSARY)).toEqual([]);
    expect(merged["nav.payroll"]).toBe("الرواتب");
    expect(merged["nav.auditLog"]).toBe("سجل التدقيق");
  });
});
