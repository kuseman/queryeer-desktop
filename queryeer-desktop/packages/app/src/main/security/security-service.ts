import { ipcMain, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import type {
  SecurityMasterPasswordStorage,
  SecurityStatus,
  VaultDocument
} from "@queryeer/api/security/Security.js";
import {
  createSalt,
  createVerifier,
  decryptSecret,
  deriveMasterKey,
  encryptSecret,
  SCRYPT_BLOCK_SIZE,
  SCRYPT_COST,
  SCRYPT_KEY_LENGTH,
  SCRYPT_PARALLELIZATION,
  verifyMasterKey
} from "./vault-crypto.js";
import { VaultStore } from "./vault-store.js";

type UnlockParams = {
  masterPassword: string;
  masterPasswordStorage: SecurityMasterPasswordStorage;
};

type RotateParams = {
  oldMasterPassword: string;
  newMasterPassword: string;
  masterPasswordStorage: SecurityMasterPasswordStorage;
};

type PersistMasterPasswordOutcome = {
  warning?: string;
};

type SecurityBackendBridgeHooks = {
  onSessionOpen?: (params: {
    sessionId: string;
    vaultPath: string;
    sessionKeyBase64: string;
    vaultUpdatedAt?: string;
  }) => Promise<void>;
  onSessionClose?: (params: {
    sessionId?: string;
    reason: "lock" | "rotate" | "shutdown" | "error";
  }) => Promise<void>;
  onVaultChanged?: (params: {
    vaultPath: string;
    vaultUpdatedAt?: string;
  }) => Promise<void>;
};

export class SecurityService {
  private readonly vaultStore: VaultStore;
  private readonly backendHooks: SecurityBackendBridgeHooks;
  private masterKey: Buffer | null = null;
  private currentSessionId: string | null = null;

  public constructor(vaultStore: VaultStore, backendHooks?: SecurityBackendBridgeHooks) {
    this.vaultStore = vaultStore;
    this.backendHooks = backendHooks ?? {};
  }

  public wireIpc(): void {
    ipcMain.handle("security:get-status", async () => this.getStatus());
    ipcMain.handle("security:unlock", async (_event, params: UnlockParams) => this.unlock(params));
    ipcMain.handle("security:unlock-with-stored", async () => this.unlockWithStoredMasterPassword());
    ipcMain.handle("security:lock", async () => {
      await this.lock();
      return { accepted: true };
    });
    ipcMain.handle("security:store-secret", async (_event, params: { plaintext: string; secretRef?: string }) => {
      return this.storeSecret(params);
    });
    ipcMain.handle("security:resolve-secret", async (_event, params: { secretRef: string }) => {
      return this.resolveSecret(params.secretRef);
    });
    ipcMain.handle("security:delete-secret", async (_event, params: { secretRef: string }) => {
      return this.deleteSecret(params.secretRef);
    });
    ipcMain.handle("security:rotate-master-password", async (_event, params: RotateParams) => {
      return this.rotateMasterPassword(params);
    });
  }

  public async invalidateBackendSession(): Promise<void> {
    this.currentSessionId = null;
    this.masterKey = null;
  }

  private async getStatus(): Promise<SecurityStatus> {
    return {
      unlocked: this.masterKey !== null,
      hasPersistedVault: this.vaultStore.hasVaultFile(),
      hasStoredMasterPassword: await this.hasStoredMasterPassword()
    };
  }

  private async unlock(params: UnlockParams): Promise<{ accepted: boolean; reason?: string }> {
    if (!params.masterPassword) {
      return { accepted: false, reason: "Master password is required" };
    }

    const vault = await this.vaultStore.readVault();
    if (!vault) {
      const created = await this.createEmptyVault(params.masterPassword);
      this.masterKey = await deriveMasterKey(params.masterPassword, created.metadata.kdf.salt);
      await this.openBackendSecuritySession(created.updatedAt);
      const outcome = await this.persistMasterPasswordPolicy(
        params.masterPasswordStorage,
        params.masterPassword
      );
      return { accepted: true, reason: outcome.warning };
    }

    const key = await deriveMasterKey(params.masterPassword, vault.metadata.kdf.salt);
    if (!verifyMasterKey(key, vault.metadata.verifier)) {
      return { accepted: false, reason: "Invalid master password" };
    }

    this.masterKey = key;
    await this.openBackendSecuritySession(vault.updatedAt);
    const outcome = await this.persistMasterPasswordPolicy(
      params.masterPasswordStorage,
      params.masterPassword
    );
    return { accepted: true, reason: outcome.warning };
  }

  private async unlockWithStoredMasterPassword(): Promise<{ accepted: boolean; reason?: string }> {
    const storedPassword = await this.readStoredMasterPassword();
    if (!storedPassword) {
      return { accepted: false, reason: "Stored master password is not available" };
    }
    return this.unlock({
      masterPassword: storedPassword,
      masterPasswordStorage: "safeStorage"
    });
  }

  private async lock(): Promise<void> {
    await this.closeBackendSecuritySession("lock");
    this.masterKey = null;
  }

  private async storeSecret(params: {
    plaintext: string;
    secretRef?: string;
  }): Promise<{ secretRef: string }> {
    const key = this.requireUnlockedKey();
    const vault = await this.requireVault();
    const secretRef = params.secretRef && params.secretRef.trim() ? params.secretRef : randomUUID();
    vault.entries[secretRef] = encryptSecret(params.plaintext, key);
    vault.updatedAt = new Date().toISOString();
    await this.vaultStore.writeVault(vault);
    await this.notifyBackendVaultChanged(vault.updatedAt);
    return { secretRef };
  }

  public async resolveSecret(secretRef: string): Promise<{ found: boolean; plaintext?: string }> {
    const key = this.requireUnlockedKey();
    const vault = await this.requireVault();
    const entry = vault.entries[secretRef];
    if (!entry) {
      return { found: false };
    }
    return {
      found: true,
      plaintext: decryptSecret(entry, key)
    };
  }

  private async deleteSecret(secretRef: string): Promise<{ deleted: boolean }> {
    this.requireUnlockedKey();
    const vault = await this.requireVault();
    if (!vault.entries[secretRef]) {
      return { deleted: false };
    }
    delete vault.entries[secretRef];
    vault.updatedAt = new Date().toISOString();
    await this.vaultStore.writeVault(vault);
    await this.notifyBackendVaultChanged(vault.updatedAt);
    return { deleted: true };
  }

  private async rotateMasterPassword(params: RotateParams): Promise<{ accepted: boolean; reason?: string }> {
    if (!params.oldMasterPassword || !params.newMasterPassword) {
      return { accepted: false, reason: "Both old and new master password are required" };
    }

    const vault = await this.requireVault();
    const oldKey = await deriveMasterKey(params.oldMasterPassword, vault.metadata.kdf.salt);
    if (!verifyMasterKey(oldKey, vault.metadata.verifier)) {
      return { accepted: false, reason: "Invalid current master password" };
    }

    const decryptedEntries = Object.entries(vault.entries).map(([secretRef, entry]) => [
      secretRef,
      decryptSecret(entry, oldKey)
    ] as const);
    const newSalt = createSalt();
    const newKey = await deriveMasterKey(params.newMasterPassword, newSalt);
    const nextEntries: VaultDocument["entries"] = {};
    for (const [secretRef, plaintext] of decryptedEntries) {
      nextEntries[secretRef] = encryptSecret(plaintext, newKey);
    }

    const nextVault: VaultDocument = {
      version: 1,
      updatedAt: new Date().toISOString(),
      metadata: {
        kdf: {
          algorithm: "scrypt",
          salt: newSalt,
          keyLength: SCRYPT_KEY_LENGTH,
          cost: SCRYPT_COST,
          blockSize: SCRYPT_BLOCK_SIZE,
          parallelization: SCRYPT_PARALLELIZATION
        },
        verifier: createVerifier(newKey)
      },
      entries: nextEntries
    };

    await this.closeBackendSecuritySession("rotate");
    await this.vaultStore.writeVault(nextVault);
    this.masterKey = newKey;
    await this.openBackendSecuritySession(nextVault.updatedAt);
    const outcome = await this.persistMasterPasswordPolicy(
      params.masterPasswordStorage,
      params.newMasterPassword
    );
    return { accepted: true, reason: outcome.warning };
  }

  private requireUnlockedKey(): Buffer {
    if (!this.masterKey) {
      throw new Error("Security vault is locked");
    }
    return this.masterKey;
  }

  private async requireVault(): Promise<VaultDocument> {
    const vault = await this.vaultStore.readVault();
    if (!vault) {
      throw new Error("Vault is not initialized");
    }
    return vault;
  }

  private async createEmptyVault(masterPassword: string): Promise<VaultDocument> {
    const salt = createSalt();
    const key = await deriveMasterKey(masterPassword, salt);
    const vault: VaultDocument = {
      version: 1,
      updatedAt: new Date().toISOString(),
      metadata: {
        kdf: {
          algorithm: "scrypt",
          salt,
          keyLength: SCRYPT_KEY_LENGTH,
          cost: SCRYPT_COST,
          blockSize: SCRYPT_BLOCK_SIZE,
          parallelization: SCRYPT_PARALLELIZATION
        },
        verifier: createVerifier(key)
      },
      entries: {}
    };
    await this.vaultStore.writeVault(vault);
    return vault;
  }

  private async persistMasterPasswordPolicy(
    policy: SecurityMasterPasswordStorage,
    masterPassword: string
  ): Promise<PersistMasterPasswordOutcome> {
    if (policy !== "safeStorage") {
      await this.clearStoredMasterPassword();
      return {};
    }

    if (!safeStorage.isEncryptionAvailable()) {
      await this.clearStoredMasterPassword();
      return {
        warning:
          "safeStorage is unavailable on this system. Master password was not persisted and will be requested again."
      };
    }

    await this.storeMasterPassword(masterPassword);
    return {};
  }

  private async hasStoredMasterPassword(): Promise<boolean> {
    const vault = await this.vaultStore.readVault();
    return typeof vault?.metadata.safeStorageMasterPassword === "string";
  }

  private async storeMasterPassword(masterPassword: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage encryption is not available on this system");
    }
    const encrypted = safeStorage.encryptString(masterPassword)
      .toString("base64");
    const vault = await this.requireVault();
    vault.metadata.safeStorageMasterPassword = encrypted;
    vault.updatedAt = new Date().toISOString();
    await this.vaultStore.writeVault(vault);
  }

  private async clearStoredMasterPassword(): Promise<void> {
    const vault = await this.vaultStore.readVault();
    if (!vault || vault.metadata.safeStorageMasterPassword === undefined) {
      return;
    }
    delete vault.metadata.safeStorageMasterPassword;
    vault.updatedAt = new Date().toISOString();
    await this.vaultStore.writeVault(vault);
  }

  private async readStoredMasterPassword(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }
    const vault = await this.vaultStore.readVault();
    const encryptedValue = vault?.metadata.safeStorageMasterPassword;
    if (typeof encryptedValue !== "string") {
      return null;
    }
    try {
      const encrypted = Buffer.from(encryptedValue, "base64");
      return safeStorage.decryptString(encrypted);
    } catch {
      return null;
    }
  }

  private async openBackendSecuritySession(vaultUpdatedAt?: string): Promise<void> {
    if (!this.masterKey || !this.backendHooks.onSessionOpen) {
      return;
    }

    const sessionId = randomUUID();
    this.currentSessionId = sessionId;
    await this.runBackendHook(async () => {
      await this.backendHooks.onSessionOpen?.({
        sessionId,
        vaultPath: this.vaultStore.getVaultFilePath(),
        sessionKeyBase64: this.masterKey?.toString("base64") ?? "",
        vaultUpdatedAt
      });
    });
  }

  private async closeBackendSecuritySession(
    reason: "lock" | "rotate" | "shutdown" | "error"
  ): Promise<void> {
    if (!this.backendHooks.onSessionClose) {
      this.currentSessionId = null;
      return;
    }

    const sessionId = this.currentSessionId ?? undefined;
    this.currentSessionId = null;
    await this.runBackendHook(async () => {
      await this.backendHooks.onSessionClose?.({
        sessionId,
        reason
      });
    });
  }

  private async notifyBackendVaultChanged(vaultUpdatedAt?: string): Promise<void> {
    if (!this.backendHooks.onVaultChanged) {
      return;
    }

    await this.runBackendHook(async () => {
      await this.backendHooks.onVaultChanged?.({
        vaultPath: this.vaultStore.getVaultFilePath(),
        vaultUpdatedAt
      });
    });
  }

  private async runBackendHook(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      console.warn("Security backend bridge hook failed", error);
    }
  }
}
