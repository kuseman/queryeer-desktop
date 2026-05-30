import { describe, expect, it } from "vitest";
import {
  createSalt,
  createVerifier,
  decryptSecret,
  deriveMasterKey,
  encryptSecret,
  verifyMasterKey
} from "./vault-crypto.js";

describe("vault-crypto", () => {
  it("derives deterministic keys for same password and salt", async () => {
    const salt = createSalt();
    const keyA = await deriveMasterKey("secret", salt);
    const keyB = await deriveMasterKey("secret", salt);
    expect(keyA.equals(keyB)).toBe(true);
  });

  it("encrypts and decrypts roundtrip", async () => {
    const key = await deriveMasterKey("secret", createSalt());
    const encrypted = encryptSecret("top-secret", key);
    expect(decryptSecret(encrypted, key)).toBe("top-secret");
  });

  it("validates master key via verifier", async () => {
    const salt = createSalt();
    const key = await deriveMasterKey("secret", salt);
    const wrong = await deriveMasterKey("wrong", salt);
    const verifier = createVerifier(key);
    expect(verifyMasterKey(key, verifier)).toBe(true);
    expect(verifyMasterKey(wrong, verifier)).toBe(false);
  });
});
