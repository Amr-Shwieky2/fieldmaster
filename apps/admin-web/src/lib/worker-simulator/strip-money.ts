/** Money is always integer agorot in this API (`budgetAgorot`, `dailyBaseRateAgorot`, ...), plus the worker `compensation` object. */
const MONEY_KEY = /agorot$/i;
const MONEY_OBJECT_KEYS = new Set(["compensation", "compensationProfiles"]);

/**
 * Removes every money field from a value before the simulator shows it as
 * raw JSON. The worker-scoped responses the simulator gets should not carry
 * money, but a Field Manager may be at the keyboard, so the raw view never
 * relies on that.
 */
export function withoutMoney(value: unknown): { value: unknown; removed: boolean } {
  let removed = false;
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (MONEY_KEY.test(key) || MONEY_OBJECT_KEYS.has(key)) {
        removed = true;
        continue;
      }
      out[key] = visit(child);
    }
    return out;
  };
  const result = visit(value);
  return { value: result, removed };
}
