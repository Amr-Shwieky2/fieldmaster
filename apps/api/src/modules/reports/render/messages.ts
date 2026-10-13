import { formatNumber, getEnumLabel, sharedMessages, type EnumName, type EnumTranslator } from "@fieldmaster/i18n/node";

/**
 * Every word in a report comes from the shared Arabic messages of
 * `@fieldmaster/i18n` (the same file the admin web and the mobile app use):
 * `reportDocuments.*` for headings and column titles, `enums.*` for enum
 * labels, `errors.*` for the codes a refused clock attempt received, and a
 * few shared `common.*` / `units.*` glossary terms.
 */

type MessageTree = { readonly [key: string]: string | MessageTree };

const MESSAGES = sharedMessages as unknown as MessageTree;

function lookup(path: string): string | undefined {
  let node: string | MessageTree | undefined = MESSAGES;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

export function hasMessage(path: string): boolean {
  return lookup(path) !== undefined;
}

/**
 * The message at a dotted path. A missing one is a programming error, not a
 * reason to print an English fallback: the unit tests render every template
 * and the e2e tests generate every report type, so it fails there first.
 */
export function messageAt(path: string): string {
  const message = lookup(path);
  if (message === undefined) throw new Error(`Missing Arabic message "${path}" in @fieldmaster/i18n.`);
  return message;
}

export type MessagePart = { text: string } | { argument: string };

const ARGUMENT = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;

/**
 * Splits an ICU message into literal text and simple `{name}` arguments.
 * The report messages only use simple arguments (no plural or select, no ICU
 * quoting), so this small subset is all the API needs; anything richer is
 * refused rather than printed wrongly. `use-intl` is a development
 * dependency of the i18n package and not available to the compiled API.
 */
export function parseMessage(template: string): MessagePart[] {
  if (/\{\s*[A-Za-z_][A-Za-z0-9_]*\s*,/.test(template)) {
    throw new Error(`Unsupported ICU message in a report (plural, select or a formatted argument): "${template}"`);
  }
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of template.matchAll(ARGUMENT)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: template.slice(last, index) });
    parts.push({ argument: match[1] });
    last = index + match[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

export function messageArguments(template: string): string[] {
  return parseMessage(template).flatMap((part) => ("argument" in part ? [part.argument] : []));
}

/** Fills the `{name}` arguments of a message with plain text. Every argument must be given. */
export function formatMessage(template: string, values: Readonly<Record<string, string | number>> = {}): string {
  return parseMessage(template)
    .map((part) => {
      if ("text" in part) return part.text;
      const value = values[part.argument];
      if (value === undefined) throw new Error(`Missing value for {${part.argument}} in "${template}"`);
      return String(value);
    })
    .join("");
}

/** A `reportDocuments.*` message as plain text. */
export function rd(key: string, values?: Readonly<Record<string, string | number>>): string {
  return formatMessage(messageAt(`reportDocuments.${key}`), values);
}

/** A shared `common.*` glossary term ("بدء الدوام", "ساعات إضافية", ...). */
export function commonText(key: string): string {
  return messageAt(`common.${key}`);
}

const enumTranslator: EnumTranslator = Object.assign((key: string) => messageAt(`enums.${key}`), { has: (key: string) => hasMessage(`enums.${key}`) });

/** The Arabic label of an enum value; an unknown value shows as its code (never made-up text), nothing as "—". */
export function enumLabel(enumName: EnumName, value: string | null | undefined): string {
  return getEnumLabel(enumTranslator, enumName, value);
}

/** The details a refused clock attempt stored, named like the arguments of its `errors.<CODE>` message. */
export interface AttemptDetails {
  distanceMeters?: number | null;
  allowedRadiusMeters?: number | null;
  accuracyMeters?: number | null;
  requiredMeters?: number | null;
  deviationSeconds?: number | null;
}

/**
 * What the worker was told when the server refused a clock attempt: the
 * shared `errors.<CODE>` message with the stored numbers, its `_NO_DETAILS`
 * variant when a number is missing, or the code itself when there is no
 * Arabic message for it.
 */
export function attemptReason(code: string, details: AttemptDetails): string {
  const template = lookup(`errors.${code}`);
  if (template === undefined) return code;
  const values: Record<string, string> = {};
  for (const name of messageArguments(template)) {
    const value = details[name as keyof AttemptDetails];
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return lookup(`errors.${code}_NO_DETAILS`) ?? code;
    }
    values[name] = formatNumber(Math.round(value));
  }
  return formatMessage(template, values);
}
