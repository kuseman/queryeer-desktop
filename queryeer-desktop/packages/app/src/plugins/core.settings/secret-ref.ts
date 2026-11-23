import type { SecretRefValue } from "@queryeer/api/security/Security";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSecretRefValue(value: unknown): SecretRefValue | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const secretRef = value.secretRef;
  return typeof secretRef === "string" && secretRef.trim()
    ? { secretRef: secretRef.trim() }
    : undefined;
}

/**
 * A deep copy of `value` where every `{ secretRef }` object gets its own copy of the vault entry, so a cloned setting
 * never shares a secret with its source (editing or clearing one would change the other). Each occurrence gets its own
 * copy. A secret that can't be copied becomes `undefined`: the clone then has no secret rather than a shared one.
 */
export async function copySecretRefs<T>(value: T, copy: (secretRef: string) => Promise<string | undefined>): Promise<T> {
  const visit = async (node: unknown): Promise<unknown> => {
    if (Array.isArray(node)) {
      return Promise.all(node.map(visit));
    }
    if (!isPlainObject(node)) {
      return node;
    }
    if (typeof node.secretRef === "string") {
      let copyRef: string | undefined;
      try {
        copyRef = node.secretRef ? await copy(node.secretRef) : undefined;
      } catch {
        copyRef = undefined;
      }
      return copyRef ? { ...node, secretRef: copyRef } : undefined;
    }
    const entries = await Promise.all(Object.entries(node).map(async ([key, child]) => [key, await visit(child)] as const));
    return Object.fromEntries(entries);
  };
  return (await visit(value)) as T;
}

/** Plain data only: class instances such as dates are kept as they are. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
