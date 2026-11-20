import { randomUUID } from "node:crypto";
import type { VaultDocument } from "@queryeer/api/security/Security.js";

/**
 * Adds a copy of the entry `secretRef` under a new ref, without decrypting it: entries are encrypted with the vault key
 * alone, not tied to their ref. Returns the new ref, or `undefined` when there is no such entry. Changes `vault`.
 */
/**
 * Runs vault changes one at a time. Each change reads vault.json, changes it and writes it back, so two at once would
 * lose one of them (or collide on the temporary file).
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

export function copyVaultEntry(
  vault: VaultDocument,
  secretRef: string,
  now: Date = new Date(),
  newRef: () => string = randomUUID
): string | undefined {
  // Own entries only: "__proto__" or "toString" are no refs
  if (typeof secretRef !== "string" || !Object.prototype.hasOwnProperty.call(vault.entries, secretRef)) {
    return undefined;
  }
  const entry = vault.entries[secretRef];
  const copyRef = newRef();
  vault.entries[copyRef] = { ...entry, updatedAt: now.toISOString() };
  vault.updatedAt = now.toISOString();
  return copyRef;
}
