import ar from "./messages/ar.json";

/**
 * Messages shared by both apps: `common` (including the glossary terms),
 * `states`, `errors` (one message per API error code), `enums`, `units`, the
 * shared part of `auth`, and `devLogin` (the test-mode banner and quick
 * login). Each app adds its own namespaces in its own ar.json and merges them
 * with `mergeMessages`. `pnpm lint` fails if an app redefines a shared key.
 */
export const sharedMessages = ar;

export type SharedMessages = typeof ar;

type Tree = { [key: string]: string | Tree };

function isTree(value: unknown): value is Tree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merges the app's messages over the shared ones without mutating either. */
export function mergeMessages<A extends object, B extends object>(shared: A, app: B): A & B {
  const merge = (base: Tree, extra: Tree): Tree => {
    const result: Tree = { ...base };
    for (const [key, value] of Object.entries(extra)) {
      const existing = result[key];
      result[key] = isTree(existing) && isTree(value) ? merge(existing, value) : value;
    }
    return result;
  };
  return merge(shared as unknown as Tree, app as unknown as Tree) as unknown as A & B;
}
