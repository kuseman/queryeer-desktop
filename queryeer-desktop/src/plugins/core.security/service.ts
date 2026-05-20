import type {
  SecurityMasterPasswordStorage,
  SecurityStatus,
  SecurityUnlockMode
} from "../../contracts/security/Security";
import type { DialogRegistry } from "../../contracts/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";

export const SECURITY_UNLOCK_MODE_SETTING_ID = "core.security.unlock.mode";
export const SECURITY_MASTER_PASSWORD_STORAGE_SETTING_ID =
  "core.security.masterPassword.storage";

type SecurityBridge = {
  getStatus: () => Promise<SecurityStatus>;
  unlock: (params: {
    masterPassword: string;
    masterPasswordStorage: SecurityMasterPasswordStorage;
  }) => Promise<{ accepted: boolean; reason?: string }>;
  unlockWithStored: () => Promise<{ accepted: boolean; reason?: string }>;
  lock: () => Promise<{ accepted: boolean }>;
  storeSecret: (params: { plaintext: string; secretRef?: string }) => Promise<{ secretRef: string }>;
  resolveSecret: (params: { secretRef: string }) => Promise<{ found: boolean; plaintext?: string }>;
  deleteSecret: (params: { secretRef: string }) => Promise<{ deleted: boolean }>;
  rotateMasterPassword: (params: {
    oldMasterPassword: string;
    newMasterPassword: string;
    masterPasswordStorage: SecurityMasterPasswordStorage;
  }) => Promise<{ accepted: boolean; reason?: string }>;
};

class SecurityVaultLockedError extends Error {
  public constructor() {
    super("Security vault is locked");
  }
}

export class CoreSecurityService {
  private readonly bridge: SecurityBridge;
  private readonly dialog: DialogRegistry;
  private readonly secretCache = new Map<string, string>();
  private unlockedHint = false;
  private readonly statusListeners = new Set<(status: SecurityStatus) => void>();

  public constructor(bridge: SecurityBridge, dialog: DialogRegistry) {
    this.bridge = bridge;
    this.dialog = dialog;
  }

  public async getStatus(): Promise<SecurityStatus> {
    const status = await this.bridge.getStatus();
    this.unlockedHint = status.unlocked;
    this.emitStatus(status);
    return status;
  }

  public subscribeStatus(listener: (status: SecurityStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public async maybeAutoUnlockAtStartup(): Promise<{ accepted: boolean; reason?: string } | null> {
    const unlockMode = this.getUnlockMode();
    const storage = this.getMasterPasswordStorage();
    if (unlockMode !== "startup" || storage !== "safeStorage") {
      return null;
    }
    const response = await this.bridge.unlockWithStored();
    await this.showNoticeIfNeeded("Security Startup Unlock", response);
    return response;
  }

  public async unlock(masterPassword: string): Promise<{ accepted: boolean; reason?: string }> {
    const response = await this.bridge.unlock({
      masterPassword,
      masterPasswordStorage: this.getMasterPasswordStorage()
    });
    this.unlockedHint = response.accepted;
    return response;
  }

  public async lock(): Promise<{ accepted: boolean }> {
    const result = await this.bridge.lock();
    if (result.accepted) {
      this.unlockedHint = false;
      void this.getStatus();
    }
    return result;
  }

  public async storeSecret(plaintext: string, secretRef?: string): Promise<{ secretRef: string }> {
    try {
      const unlocked = await this.ensureUnlockedForSecretAccess();
      if (!unlocked) {
        throw new SecurityVaultLockedError();
      }
      const stored = await this.bridge.storeSecret({ plaintext, secretRef });
      this.secretCache.set(stored.secretRef, plaintext);
      return stored;
    } catch (error) {
      if (error instanceof SecurityVaultLockedError) {
        throw error;
      }
      await this.dialog.showMessage({
        title: "Security Secret Storage",
        message: error instanceof Error ? error.message : String(error),
        severity: "error"
      });
      throw error;
    }
  }

  public async resolveSecret(secretRef: string): Promise<{ found: boolean; plaintext?: string }> {
    const cached = this.secretCache.get(secretRef);
    if (cached !== undefined) {
      return { found: true, plaintext: cached };
    }
    const resolved = await this.bridge.resolveSecret({ secretRef });
    if (resolved.found && typeof resolved.plaintext === "string") {
      this.secretCache.set(secretRef, resolved.plaintext);
    }
    return resolved;
  }

  public peekSecret(secretRef: string): string | undefined {
    return this.secretCache.get(secretRef);
  }

  public async deleteSecret(secretRef: string): Promise<{ deleted: boolean }> {
    try {
      const unlocked = await this.ensureUnlockedForSecretAccess();
      if (!unlocked) {
        throw new SecurityVaultLockedError();
      }
      return this.bridge.deleteSecret({ secretRef });
    } catch (error) {
      if (error instanceof SecurityVaultLockedError) {
        throw error;
      }
      await this.dialog.showMessage({
        title: "Security Secret Storage",
        message: error instanceof Error ? error.message : String(error),
        severity: "error"
      });
      throw error;
    }
  }

  public async ensureUnlockedForSecretAccess(options?: { interactive?: boolean }): Promise<boolean> {
    let promptedMasterPassword: string | null = null;
    let promptedMasterPasswordRequested = false;
    if (
      options?.interactive
      && this.getUnlockMode() === "first-use"
      && !this.unlockedHint
    ) {
      promptedMasterPasswordRequested = true;
      promptedMasterPassword = await requestMasterPasswordViaDialog(this.dialog, {
        title: "Unlock Vault",
        message: "Enter master password"
      });
    }

    const status = await this.getStatus();
    if (status.unlocked) {
      return true;
    }

    if (
      this.getUnlockMode() === "startup"
      && this.getMasterPasswordStorage() === "safeStorage"
      && status.hasStoredMasterPassword
    ) {
      const response = await this.bridge.unlockWithStored();
      await this.showNoticeIfNeeded("Security Startup Unlock", response);
      if (response.accepted) {
        this.unlockedHint = true;
        return true;
      }
    }

    if (options?.interactive) {
      if (promptedMasterPasswordRequested && promptedMasterPassword === null) {
        return false;
      }

      const masterPassword = promptedMasterPassword
        ?? await requestMasterPasswordViaDialog(this.dialog, {
          title: "Unlock Vault",
          message: "Enter master password"
        });
      if (!masterPassword) {
        return false;
      }
      const response = await this.unlock(masterPassword);
      this.unlockedHint = response.accepted;
      void this.showNoticeIfNeeded("Security Unlock", response);
      return response.accepted;
    }

    return false;
  }

  public async withVaultRetry<T>(
    operation: () => Promise<T>,
    options?: { interactive?: boolean }
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("SECURITY_SESSION_CLOSED")
      ) {
        const accepted = await this.ensureUnlockedForSecretAccess({
          interactive: options?.interactive ?? true
        });
        if (!accepted) {
          throw new SecurityVaultLockedError();
        }
        return await operation();
      }
      throw error;
    }
  }

  public async rotateMasterPassword(
    oldMasterPassword: string,
    newMasterPassword: string
  ): Promise<{ accepted: boolean; reason?: string }> {
    const response = await this.bridge.rotateMasterPassword({
      oldMasterPassword,
      newMasterPassword,
      masterPasswordStorage: this.getMasterPasswordStorage()
    });
    await this.showNoticeIfNeeded("Security Master Password", response);
    return response;
  }

  private async showNoticeIfNeeded(
    title: string,
    response: { accepted: boolean; reason?: string }
  ): Promise<void> {
    if (!response.reason) {
      return;
    }

    await this.dialog.showMessage({
      title,
      message: response.reason,
      severity: response.accepted ? "warning" : "error"
    });
  }

  private emitStatus(status: SecurityStatus): void {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  public getUnlockMode(): SecurityUnlockMode {
    const service = getCoreSettingsService();
    const value = service?.getValue(SECURITY_UNLOCK_MODE_SETTING_ID);
    return value === "startup" ? "startup" : "first-use";
  }

  public getMasterPasswordStorage(): SecurityMasterPasswordStorage {
    const service = getCoreSettingsService();
    const value = service?.getValue(SECURITY_MASTER_PASSWORD_STORAGE_SETTING_ID);
    return value === "safeStorage" ? "safeStorage" : "ask";
  }
}

let coreSecurityService: CoreSecurityService | null = null;

export function initializeCoreSecurityService(dialog: DialogRegistry): CoreSecurityService {
  if (!coreSecurityService) {
    coreSecurityService = new CoreSecurityService({
      getStatus: () => window.appShell.getSecurityStatus(),
      unlock: (params) => window.appShell.unlockSecurity(params),
      unlockWithStored: () => window.appShell.unlockSecurityWithStored(),
      lock: () => window.appShell.lockSecurity(),
      storeSecret: (params) => window.appShell.storeSecret(params),
      resolveSecret: (params) => window.appShell.resolveSecret(params),
      deleteSecret: (params) => window.appShell.deleteSecret(params),
      rotateMasterPassword: (params) => window.appShell.rotateSecurityMasterPassword(params)
    }, dialog);
  }
  return coreSecurityService;
}

export function getCoreSecurityService(): CoreSecurityService | null {
  return coreSecurityService;
}

async function requestMasterPasswordViaDialog(
  dialog: DialogRegistry,
  options?: { title?: string; message?: string }
): Promise<string | null> {
  if (typeof dialog.showInputDialog === "function") {
    const response = await dialog.showInputDialog({
      title: options?.title ?? "Unlock Vault",
      message: options?.message ?? "Enter master password",
      password: true
    });
    if (response.canceled) {
      return null;
    }
    return response.value ?? "";
  }

  return null;
}
