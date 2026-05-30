export type SecurityUnlockMode = "startup" | "first-use";

export type SecurityMasterPasswordStorage = "ask" | "safeStorage";

export type VaultCipherEntry = {
  iv: string;
  authTag: string;
  ciphertext: string;
  updatedAt: string;
};

export type VaultVerifier = {
  iv: string;
  authTag: string;
  ciphertext: string;
};

export type VaultDocument = {
  version: 1;
  updatedAt: string;
  metadata: {
    kdf: {
      algorithm: "scrypt";
      salt: string;
      keyLength: number;
      cost: number;
      blockSize: number;
      parallelization: number;
    };
    verifier: VaultVerifier;
    safeStorageMasterPassword?: string;
  };
  entries: Record<string, VaultCipherEntry>;
};

export type SecurityStatus = {
  unlocked: boolean;
  hasPersistedVault: boolean;
  hasStoredMasterPassword: boolean;
};

export type SecretRefValue = {
  secretRef: string;
};
