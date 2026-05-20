import { describe, expect, it, vi } from "vitest";
import { CoreSecurityService } from "./service";

const createService = (options?: {
  response?: { accepted: boolean; reason?: string };
  status?: { unlocked: boolean; hasPersistedVault: boolean; hasStoredMasterPassword: boolean };
  prompt?: (options?: { title?: string; message?: string }) => string | null;
}) => {
  const response = options?.response ?? { accepted: true };
  const status = options?.status ?? {
    unlocked: false,
    hasPersistedVault: false,
    hasStoredMasterPassword: false
  };
  const dialog = {
    showMessage: vi.fn(async () => ({ action: "ok" })),
    showOpenDialog: vi.fn(),
    showOpenFolder: vi.fn(),
    showSaveDialog: vi.fn(),
    showInputDialog: vi.fn(async (dialogOptions?: { title?: string; message?: string }) => {
      const value = options?.prompt?.(dialogOptions);
      if (value === null || value === undefined) {
        return { canceled: true, value: undefined };
      }
      return { canceled: false, value };
    })
  };

  const bridge = {
    getStatus: vi.fn(async () => status),
    unlock: vi.fn(async () => response),
    unlockWithStored: vi.fn(async () => response),
    lock: vi.fn(async () => ({ accepted: true })),
    storeSecret: vi.fn(async () => ({ secretRef: "secret-ref-1" })),
    resolveSecret: vi.fn(async () => ({ found: false })),
    deleteSecret: vi.fn(async () => ({ deleted: true })),
    rotateMasterPassword: vi.fn(async () => response)
  };

  const service = new CoreSecurityService(bridge, dialog);

  return { service, dialog, bridge };
};

describe("CoreSecurityService", () => {
  it("calls bridge unlock and returns accepted true", async () => {
    const { service, bridge } = createService({
      response: {
        accepted: true,
        reason: "safeStorage unavailable"
      }
    });

    const result = await service.unlock("master");

    expect(result.accepted).toBe(true);
    expect(bridge.unlock).toHaveBeenCalledWith({
      masterPassword: "master",
      masterPasswordStorage: "ask"
    });
    expect(result.reason).toBe("safeStorage unavailable");
  });

  it("calls bridge unlock and returns accepted false", async () => {
    const { service, bridge } = createService({
      response: {
        accepted: false,
        reason: "invalid password"
      }
    });

    const result = await service.unlock("master");

    expect(result.accepted).toBe(false);
    expect(bridge.unlock).toHaveBeenCalledWith({
      masterPassword: "master",
      masterPasswordStorage: "ask"
    });
    expect(result.reason).toBe("invalid password");
  });

  it("does not auto-unlock on first secret store when vault is locked", async () => {
    const { service, bridge } = createService({
      response: { accepted: true }
    });

    await expect(service.storeSecret("secret-value")).rejects.toThrow("Security vault is locked");

    expect(bridge.unlock).not.toHaveBeenCalled();
    expect(bridge.storeSecret).not.toHaveBeenCalled();
  });

  it("tries stored unlock first when startup mode uses safeStorage", async () => {
    const { service, bridge } = createService({
      status: {
        unlocked: false,
        hasPersistedVault: true,
        hasStoredMasterPassword: true
      },
      response: { accepted: true }
    });
    vi.spyOn(service, "getUnlockMode").mockReturnValue("startup");
    vi.spyOn(service, "getMasterPasswordStorage").mockReturnValue("safeStorage");

    const unlocked = await service.ensureUnlockedForSecretAccess();

    expect(unlocked).toBe(true);
    expect(bridge.unlockWithStored).toHaveBeenCalledTimes(1);
    expect(bridge.unlock).not.toHaveBeenCalled();
  });

  it("prompts for master password when interactive unlock is requested", async () => {
    const prompt = vi.fn(() => "master-pass");
    const { service, bridge } = createService({
      status: {
        unlocked: false,
        hasPersistedVault: true,
        hasStoredMasterPassword: false
      },
      response: { accepted: true },
      prompt
    });

    const unlocked = await service.ensureUnlockedForSecretAccess({ interactive: true });

    expect(unlocked).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(bridge.unlock).toHaveBeenCalledWith({
      masterPassword: "master-pass",
      masterPasswordStorage: "ask"
    });
  });

  it("does not re-open prompt when first-use prompt is canceled", async () => {
    const prompt = vi.fn(() => null);
    const { service, dialog, bridge } = createService({
      status: {
        unlocked: false,
        hasPersistedVault: true,
        hasStoredMasterPassword: false
      },
      prompt
    });

    const unlocked = await service.ensureUnlockedForSecretAccess({ interactive: true });

    expect(unlocked).toBe(false);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(dialog.showInputDialog).toHaveBeenCalledTimes(1);
    expect(bridge.unlock).not.toHaveBeenCalled();
  });

  it("runs action directly with withVaultRetry", async () => {
    const { service, bridge } = createService({
      status: {
        unlocked: false,
        hasPersistedVault: true,
        hasStoredMasterPassword: false
      }
    });
    const action = vi.fn(async () => 42);

    const result = await service.withVaultRetry(action);

    expect(result).toBe(42);
    expect(action).toHaveBeenCalledTimes(1);
    expect(bridge.unlock).not.toHaveBeenCalled();
  });

  it("retries after unlock when operation throws SECURITY_SESSION_CLOSED", async () => {
    const { service, bridge } = createService({
      status: {
        unlocked: false,
        hasPersistedVault: true,
        hasStoredMasterPassword: false
      },
      prompt: () => "master-pass",
      response: { accepted: true }
    });
    let calls = 0;
    const action = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw new Error("SECURITY_SESSION_CLOSED: Security session is not open");
      }
      return 42;
    });

    const result = await service.withVaultRetry(action);

    expect(result).toBe(42);
    expect(action).toHaveBeenCalledTimes(2);
    expect(bridge.unlock).toHaveBeenCalledTimes(1);
  });

  it("throws SecurityVaultLockedError when user cancels unlock retry", async () => {
    const { service } = createService({
      status: {
        unlocked: false,
        hasPersistedVault: true,
        hasStoredMasterPassword: false
      },
      prompt: () => null
    });
    const action = vi.fn(async () => {
      throw new Error("SECURITY_SESSION_CLOSED: Security session is not open");
    });

    await expect(service.withVaultRetry(action)).rejects.toThrow(
      "Security vault is locked"
    );
  });
});
