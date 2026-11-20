import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { VaultDocument } from "@queryeer/api/security/Security.js";
import { decryptSecret, encryptSecret } from "./vault-crypto";
import { copyVaultEntry, createSerialQueue } from "./vault-entries";

describe("copyVaultEntry", () => {
  it("copies an entry under a new ref that decrypts to the same secret", () => {
    const key = randomBytes(32);
    const vault = { entries: { source: encryptSecret("s3cret", key) }, updatedAt: "before" } as unknown as VaultDocument;

    const copyRef = copyVaultEntry(vault, "source", new Date("2026-11-20T00:00:00Z"), () => "copy");

    expect(copyRef).toBe("copy");
    expect(decryptSecret(vault.entries.copy, key)).toBe("s3cret");
    expect(decryptSecret(vault.entries.source, key)).toBe("s3cret");
    expect(vault.updatedAt).toBe("2026-11-20T00:00:00.000Z");
  });

  it("returns undefined for a missing entry, changing nothing", () => {
    const vault = { entries: {}, updatedAt: "before" } as unknown as VaultDocument;

    expect(copyVaultEntry(vault, "missing")).toBeUndefined();
    expect(vault).toEqual({ entries: {}, updatedAt: "before" });
  });
});

describe("copyVaultEntry with names that aren't refs", () => {
  it("ignores inherited properties", () => {
    const vault = { entries: {}, updatedAt: "before" } as unknown as VaultDocument;

    expect(copyVaultEntry(vault, "__proto__")).toBeUndefined();
    expect(copyVaultEntry(vault, "toString")).toBeUndefined();
    expect(Object.keys(vault.entries)).toEqual([]);
  });
});

describe("createSerialQueue", () => {
  it("runs tasks one at a time, in order, also after a failure", async () => {
    const serialize = createSerialQueue();
    const events: string[] = [];
    const task = (name: string, fail = false) => async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`end ${name}`);
      if (fail) {
        throw new Error(name);
      }
      return name;
    };

    const results = await Promise.allSettled([serialize(task("a")), serialize(task("b", true)), serialize(task("c"))]);

    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
