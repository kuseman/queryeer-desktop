import { ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  emptyUserKeybindingsDocument,
  KEYBINDINGS_SCHEMA_VERSION,
  type UserKeybindingsDocument
} from "@queryeer/api/commands/Keybindings.js";

export type KeybindingsStoreOptions = {
  keybindingsFilePath: string;
  logError?: (message: string, error: Error) => void;
};

export class KeybindingsStore {
  private readonly keybindingsFilePath: string;
  private readonly logError: (message: string, error: Error) => void;

  public constructor(options: KeybindingsStoreOptions) {
    this.keybindingsFilePath = options.keybindingsFilePath;
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
  }

  public wireIpc(): void {
    ipcMain.handle("keybindings:get", async () => this.read());
    ipcMain.handle("keybindings:save", async (_event, document: UserKeybindingsDocument) => {
      await this.write(document);
      return { accepted: true };
    });
  }

  public async read(): Promise<UserKeybindingsDocument> {
    try {
      const raw = await readFile(this.keybindingsFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<UserKeybindingsDocument>;
      if (parsed.version !== KEYBINDINGS_SCHEMA_VERSION) {
        return emptyUserKeybindingsDocument();
      }

      return {
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
        unbound: Array.isArray(parsed.unbound) ? parsed.unbound : []
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return emptyUserKeybindingsDocument();
      }
      this.logError(
        `Failed to read keybindings file at ${this.keybindingsFilePath}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return emptyUserKeybindingsDocument();
    }
  }

  public async write(document: UserKeybindingsDocument): Promise<void> {
    await this.writeAtomic(document);
  }

  private async writeAtomic(document: UserKeybindingsDocument): Promise<void> {
    const dir = dirname(this.keybindingsFilePath);
    await mkdir(dir, { recursive: true });
    const tempPath = `${this.keybindingsFilePath}.tmp`;
    const payload = JSON.stringify(document, null, 2);
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.keybindingsFilePath);
  }
}

export function defaultKeybindingsFilePath(userDataDir: string): string {
  return join(userDataDir, "settings", "keybindings.json");
}
