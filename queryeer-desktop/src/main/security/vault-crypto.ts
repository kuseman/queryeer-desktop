import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import type { VaultCipherEntry, VaultVerifier } from "../../contracts/security/Security.js";

export const VAULT_SCHEMA_VERSION = 1 as const;
export const SCRYPT_KEY_LENGTH = 32;
export const SCRYPT_COST = 16384;
export const SCRYPT_BLOCK_SIZE = 8;
export const SCRYPT_PARALLELIZATION = 1;
const AES_GCM_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const VERIFIER_PAYLOAD = "queryeer.security.verifier.v1";

export function createSalt(): string {
  return randomBytes(16).toString("base64");
}

export async function deriveMasterKey(masterPassword: string, saltBase64: string): Promise<Buffer> {
  const salt = Buffer.from(saltBase64, "base64");
  const key = scryptSync(masterPassword, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024
  }) as Buffer;
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): VaultCipherEntry {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_GCM_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: new Date().toISOString()
  };
}

export function decryptSecret(entry: VaultCipherEntry | VaultVerifier, key: Buffer): string {
  const decipher = createDecipheriv(
    AES_GCM_ALGORITHM,
    key,
    Buffer.from(entry.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, "base64")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}

export function createVerifier(key: Buffer): VaultVerifier {
  const payload = encryptSecret(VERIFIER_PAYLOAD, key);
  return {
    iv: payload.iv,
    authTag: payload.authTag,
    ciphertext: payload.ciphertext
  };
}

export function verifyMasterKey(key: Buffer, verifier: VaultVerifier): boolean {
  try {
    return decryptSecret(verifier, key) === VERIFIER_PAYLOAD;
  } catch {
    return false;
  }
}
