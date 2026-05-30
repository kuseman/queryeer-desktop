import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  mkdirSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSalt, createVerifier, deriveMasterKey } from "./vault-crypto.js";
import { defaultSecurityDirPath, VaultStore } from "./vault-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-security-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("VaultStore", () => {
  it("returns null when vault file is missing", async () => {
    const store = new VaultStore({ securityDirPath: workDir });
    await expect(store.readVault()).resolves.toBeNull();
  });

  it("writes vault atomically", async () => {
    const store = new VaultStore({ securityDirPath: workDir });
    const salt = createSalt();
    const key = await deriveMasterKey("secret", salt);
    await store.writeVault({
      version: 1,
      updatedAt: "now",
      metadata: {
        kdf: {
          algorithm: "scrypt",
          salt,
          keyLength: 32,
          cost: 16384,
          blockSize: 8,
          parallelization: 1
        },
        verifier: createVerifier(key)
      },
      entries: {}
    });

    const file = join(workDir, "vault.json");
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { version: number };
    expect(parsed.version).toBe(1);
  });

  it("quarantines broken vault json", async () => {
    const store = new VaultStore({ securityDirPath: workDir });
    mkdirSync(workDir, { recursive: true });
    const file = join(workDir, "vault.json");
    writeFileSync(file, "{ broken", "utf8");
    const read = await store.readVault();
    expect(read).toBeNull();
    const entries = readdirSync(workDir);
    expect(existsSync(file)).toBe(false);
    expect(entries.some((entry) => entry.startsWith("vault.json.broken-"))).toBe(true);
  });
});

describe("defaultSecurityDirPath", () => {
  it("stores vault under settings directory", () => {
    const result = defaultSecurityDirPath("/some/user/data");
    expect(result).toContain("settings");
  });
});
