import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react-native";
import { IntlRoot } from "../../i18n/IntlRoot";

/**
 * Helpers for the ClockIn / ClockOut / OfflineQueue screen tests: render inside
 * the real Arabic IntlRoot (a missing key fails the test) and read back every
 * string a worker can see or hear.
 */

function failOnIntlError(error: Error): void {
  throw error;
}

export function renderInArabic(ui: ReactElement) {
  return render(<IntlRoot onError={failOnIntlError}>{ui}</IntlRoot>);
}

/** Fills an ICU message's plain `{name}` arguments, the way use-intl renders them. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

type JsonNode = { type: string; props: Record<string, unknown>; children: (JsonNode | string)[] | null };

/** Every text, placeholder and accessibility label currently rendered. */
export function renderedStrings(): string[] {
  const strings: string[] = [];
  const visit = (node: JsonNode | JsonNode[] | string | null) => {
    if (node === null) return;
    if (typeof node === "string") {
      strings.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    for (const prop of ["accessibilityLabel", "aria-label", "placeholder", "accessibilityHint"]) {
      const value = node.props[prop];
      if (typeof value === "string") strings.push(value);
    }
    node.children?.forEach(visit);
  };
  visit(screen.toJSON() as JsonNode | JsonNode[] | null);
  return strings;
}

/**
 * Asserts the screen shows no English UI text and only Western digits.
 * `data` lists legitimate Latin values that are user data, not UI text.
 */
export function expectArabicOnly(data: string[] = []): void {
  const text = renderedStrings()
    .map((value) => data.reduce((acc, allowed) => acc.split(allowed).join(""), value))
    .join("\n");
  expect(text).not.toMatch(/[A-Za-z]{2,}/);
  expect(text).not.toMatch(/[٠-٩۰-۹]/);
  // The same rules as Text-level queries (when no Latin user data is on screen).
  if (data.length === 0) expect(screen.queryAllByText(/[A-Za-z]{2,}/)).toHaveLength(0);
  expect(screen.queryAllByText(/[٠-٩۰-۹]/)).toHaveLength(0);
}

type HostElement = ReturnType<typeof screen.getByRole>;
type FiberLike = { memoizedProps?: { onPress?: unknown } | null; return: FiberLike | null } | null;

/**
 * Two taps on `element` that both land before React re-renders it as busy (a fast double
 * tap), so only the screen's own in-flight guard can stop the second one. It calls the
 * Pressable's onPress (the handler fireEvent.press finds the same way) twice inside ONE
 * act(): two fireEvent.press calls in the same tick would open overlapping act() scopes,
 * which React does not support and which leaks into the following tests.
 */
export async function doubleTap(element: HostElement): Promise<void> {
  let fiber = element.unstable_fiber as FiberLike;
  while (fiber && typeof fiber.memoizedProps?.onPress !== "function") fiber = fiber.return;
  const onPress = fiber?.memoizedProps?.onPress as (() => unknown) | undefined;
  if (!onPress) throw new Error("doubleTap: the element has no onPress handler");
  await act(async () => {
    await Promise.all([onPress(), onPress()]);
  });
}

/** A promise the test resolves or rejects by hand, to look at the screen while it waits. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Freezes only `Date` (timers stay real) so idempotency keys, device timestamps and receipts are exact. */
export function freezeDate(iso: string): number {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  return new Date(iso).getTime();
}
