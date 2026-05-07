import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { VaultDocument } from "../../contracts/security/Security.js";

export type VaultStoreOptions = {
  securityDirPath: string;
  now?: () => Date;
  logError?: (message: string, error: Error) => void;
};

const VAULT_FILE_NAME = "vault.json";

export class VaultStore {
  private readonly securityDirPath: string;
  private readonly now: () => Date;
  private readonly logError: (message: string, error: Error) => void;

  public constructor(options: VaultStoreOptions) {
    this.securityDirPath = options.securityDirPath;
    this.now = options.now ?? (() => new Date());
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
  }

  public async readVault(): Promise<VaultDocument | null> {
    const path = this.vaultFilePath();
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<VaultDocument>;
      if (!isVaultDocument(parsed)) {
        await this.handleBrokenFile(path);
        return null;
      }
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      if (error instanceof SyntaxError) {
        await this.handleBrokenFile(path);
        return null;
      }
      this.logError(
        `Failed to read vault file at ${path}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  public async writeVault(document: VaultDocument): Promise<void> {
    const path = this.vaultFilePath();
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, JSON.stringify(document, null, 2), "utf8");
    await rename(tempPath, path);
  }

  public hasVaultFile(): boolean {
    return existsSync(this.vaultFilePath());
  }

  public getVaultFilePath(): string {
    return this.vaultFilePath();
  }

  private vaultFilePath(): string {
    return join(this.securityDirPath, VAULT_FILE_NAME);
  }

  private async handleBrokenFile(path: string): Promise<void> {
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(path, `${path}.broken-${stamp}`);
    } catch {
      // best effort only
    }
  }
}

export function defaultSecurityDirPath(userDataDir: string): string {
  return join(userDataDir, "settings");
}

function isVaultDocument(value: Partial<VaultDocument>): value is VaultDocument {
  if (value.version !== 1 || typeof value.updatedAt !== "string") {
    return false;
  }
  if (!value.metadata || typeof value.metadata !== "object") {
    return false;
  }
  const kdf = value.metadata.kdf;
  if (!kdf || kdf.algorithm !== "scrypt" || typeof kdf.salt !== "string") {
    return false;
  }
  const verifier = value.metadata.verifier;
  if (!verifier || typeof verifier.iv !== "string" || typeof verifier.authTag !== "string") {
    return false;
  }
  if (
    value.metadata.safeStorageMasterPassword !== undefined
    && typeof value.metadata.safeStorageMasterPassword !== "string"
  ) {
    return false;
  }
  return typeof verifier.ciphertext === "string" && value.entries !== null && typeof value.entries === "object";
}
