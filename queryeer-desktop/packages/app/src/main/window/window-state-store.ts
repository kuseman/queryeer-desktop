import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const WINDOW_STATE_SCHEMA_VERSION = 1;
const DEFAULT_DEBOUNCE_MS = 200;

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowStateSnapshot = {
  bounds: WindowBounds;
  maximized: boolean;
};

type WindowStateDocument = WindowStateSnapshot & {
  version: number;
  updatedAt: string;
};

export type WindowStateStoreOptions = {
  windowStatePath: string;
  debounceMs?: number;
  now?: () => string;
  logError?: (message: string, error: Error) => void;
};

export class WindowStateStore {
  private readonly windowStatePath: string;
  private readonly debounceMs: number;
  private readonly now: () => string;
  private readonly logError: (message: string, error: Error) => void;
  private pendingSnapshot: WindowStateSnapshot | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlush: Promise<void> | null = null;

  public constructor(options: WindowStateStoreOptions) {
    this.windowStatePath = options.windowStatePath;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
  }

  public async read(): Promise<WindowStateSnapshot | null> {
    try {
      const raw = await readFile(this.windowStatePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<WindowStateDocument>;
      if (parsed.version !== WINDOW_STATE_SCHEMA_VERSION) {
        return null;
      }
      if (!isValidBounds(parsed.bounds)) {
        return null;
      }
      return {
        bounds: normalizeBounds(parsed.bounds),
        maximized: parsed.maximized === true
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      this.logError(
        `Failed to read window state file at ${this.windowStatePath}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  }

  public scheduleSave(snapshot: WindowStateSnapshot): void {
    if (!isValidBounds(snapshot.bounds)) {
      return;
    }

    this.pendingSnapshot = {
      bounds: normalizeBounds(snapshot.bounds),
      maximized: snapshot.maximized === true
    };

    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  public async flush(): Promise<void> {
    if (this.pendingFlush) {
      await this.pendingFlush;
    }
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const snapshot = this.pendingSnapshot;
    if (!snapshot) {
      return;
    }

    this.pendingSnapshot = null;
    this.pendingFlush = this.writeAtomic(snapshot)
      .catch((error) => {
        this.logError(
          `Failed to write window state file at ${this.windowStatePath}`,
          error instanceof Error ? error : new Error(String(error))
        );
      })
      .finally(() => {
        this.pendingFlush = null;
      });
    await this.pendingFlush;
  }

  public dispose(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private async writeAtomic(snapshot: WindowStateSnapshot): Promise<void> {
    await mkdir(dirname(this.windowStatePath), { recursive: true });
    const payload: WindowStateDocument = {
      version: WINDOW_STATE_SCHEMA_VERSION,
      updatedAt: this.now(),
      ...snapshot
    };
    const tempPath = `${this.windowStatePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, this.windowStatePath);
  }
}

function isValidBounds(bounds: unknown): bounds is WindowBounds {
  if (!bounds || typeof bounds !== "object") {
    return false;
  }
  const candidate = bounds as Partial<WindowBounds>;
  return Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.width)
    && Number.isFinite(candidate.height)
    && (candidate.width ?? 0) > 0
    && (candidate.height ?? 0) > 0;
}

function normalizeBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

export function defaultWindowStatePath(userDataDir: string): string {
  return join(userDataDir, "settings", "window-state.json");
}
