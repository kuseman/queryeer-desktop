import { ipcMain } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  FileWatcherEvent,
  FileWatcherEventType,
  FileWatcherWatchOptions
} from "../../contracts/files/FileWatcher";

export type FileWatcherSubscriptionRecord = {
  subscriptionId: string;
  uri: string;
  recursive: boolean;
  webContentsId: number;
};

export type WatcherHandle = {
  close: () => Promise<void>;
};

export type WatcherFactoryParams = {
  path: string;
  recursive: boolean;
  onAdd: (absolutePath: string) => void;
  onModify: (absolutePath: string) => void;
  onDelete: (absolutePath: string) => void;
  onError: (error: Error) => void;
};

export type WatcherFactory = (params: WatcherFactoryParams) => WatcherHandle;

export type WebContentsSink = {
  isDestroyed: () => boolean;
  send: (channel: string, payload: unknown) => void;
};

export type WebContentsLookup = (webContentsId: number) => WebContentsSink | null;

type SubscriptionIdGenerator = () => string;

let subscriptionCounter = 0;

function defaultSubscriptionId(): string {
  subscriptionCounter += 1;
  return `fw-${Date.now().toString(36)}-${subscriptionCounter}`;
}

const noopWatcherFactory: WatcherFactory = () => ({
  close: async () => {}
});

const noopWebContentsLookup: WebContentsLookup = () => null;

type SharedWatcher = {
  watcher: WatcherHandle;
  subscriberIds: Set<string>;
  path: string;
};

function watchKeyFor(uri: string, recursive: boolean): string {
  return `${uri}|recursive=${recursive ? "1" : "0"}`;
}

export class FileWatcherMainService {
  private readonly subscriptions = new Map<string, FileWatcherSubscriptionRecord>();
  private readonly sharedWatchers = new Map<string, SharedWatcher>();
  private readonly subscriptionToKey = new Map<string, string>();
  private readonly muteTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generateSubscriptionId: SubscriptionIdGenerator;
  private readonly now: () => number;
  private readonly watcherFactory: WatcherFactory;
  private readonly webContentsLookup: WebContentsLookup;
  private readonly logError: (message: string, error: Error) => void;

  constructor(
    options: {
      generateSubscriptionId?: SubscriptionIdGenerator;
      now?: () => number;
      watcherFactory?: WatcherFactory;
      webContentsLookup?: WebContentsLookup;
      logError?: (message: string, error: Error) => void;
    } = {}
  ) {
    this.generateSubscriptionId = options.generateSubscriptionId ?? defaultSubscriptionId;
    this.now = options.now ?? (() => Date.now());
    this.watcherFactory = options.watcherFactory ?? noopWatcherFactory;
    this.webContentsLookup = options.webContentsLookup ?? noopWebContentsLookup;
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
  }

  public wireIpc(): void {
    ipcMain.handle(
      "file-watcher:watch",
      async (event, params: { uri: string; options: FileWatcherWatchOptions }) => {
        return this.watch(params.uri, params.options, event.sender.id);
      }
    );
    ipcMain.handle("file-watcher:unwatch", async (_event, params: { subscriptionId: string }) => {
      return this.unwatch(params.subscriptionId);
    });
    ipcMain.handle(
      "file-watcher:mute",
      async (_event, params: { uri: string; durationMs: number }) => {
        return this.mutePath(params.uri, params.durationMs);
      }
    );
  }

  public watch(
    uri: string,
    options: FileWatcherWatchOptions,
    webContentsId: number
  ): { subscriptionId: string } {
    this.assertLocalUri(uri);
    const subscriptionId = this.generateSubscriptionId();
    const recursive = options.recursive ?? false;
    const record: FileWatcherSubscriptionRecord = {
      subscriptionId,
      uri,
      recursive,
      webContentsId
    };
    this.subscriptions.set(subscriptionId, record);

    if (uri.startsWith("file:")) {
      const key = watchKeyFor(uri, recursive);
      const existing = this.sharedWatchers.get(key);
      if (existing) {
        existing.subscriberIds.add(subscriptionId);
      } else {
        const path = fileURLToPath(uri);
        const shared: SharedWatcher = {
          watcher: this.watcherFactory({
            path,
            recursive,
            onAdd: (absolutePath) => this.fanOut(key, "add", absolutePath),
            onModify: (absolutePath) => this.fanOut(key, "modify", absolutePath),
            onDelete: (absolutePath) => this.fanOut(key, "delete", absolutePath),
            onError: (error) => this.logError(`File watcher error for ${uri}`, error)
          }),
          subscriberIds: new Set([subscriptionId]),
          path
        };
        this.sharedWatchers.set(key, shared);
      }
      this.subscriptionToKey.set(subscriptionId, key);
    }

    return { subscriptionId };
  }

  public async unwatch(subscriptionId: string): Promise<{ removed: boolean }> {
    const key = this.subscriptionToKey.get(subscriptionId);
    if (key) {
      this.subscriptionToKey.delete(subscriptionId);
      const shared = this.sharedWatchers.get(key);
      if (shared) {
        shared.subscriberIds.delete(subscriptionId);
        if (shared.subscriberIds.size === 0) {
          this.sharedWatchers.delete(key);
          try {
            await shared.watcher.close();
          } catch (error) {
            this.logError(
              `Failed to close watcher for key ${key}`,
              error instanceof Error ? error : new Error(String(error))
            );
          }
        }
      }
    }
    return { removed: this.subscriptions.delete(subscriptionId) };
  }

  public mutePath(uri: string, durationMs: number): { muted: boolean } {
    const existing = this.muteTimers.get(uri);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const duration = Math.max(0, durationMs);
    if (duration === 0) {
      this.muteTimers.delete(uri);
      return { muted: false };
    }
    const timer = setTimeout(() => {
      this.muteTimers.delete(uri);
    }, duration);
    this.muteTimers.set(uri, timer);
    return { muted: true };
  }

  public unmutePath(uri: string): { unmuted: boolean } {
    const existing = this.muteTimers.get(uri);
    if (existing === undefined) {
      return { unmuted: false };
    }
    clearTimeout(existing);
    this.muteTimers.delete(uri);
    return { unmuted: true };
  }

  public isMuted(uri: string): boolean {
    return this.muteTimers.has(uri);
  }

  public dispose(): void {
    for (const timer of this.muteTimers.values()) {
      clearTimeout(timer);
    }
    this.muteTimers.clear();
  }

  public subscriptionCount(): number {
    return this.subscriptions.size;
  }

  public watcherCount(): number {
    return this.sharedWatchers.size;
  }

  public listSubscriptions(): FileWatcherSubscriptionRecord[] {
    return [...this.subscriptions.values()];
  }

  private fanOut(key: string, type: FileWatcherEventType, absolutePath: string): void {
    const shared = this.sharedWatchers.get(key);
    if (!shared) {
      return;
    }
    for (const subscriptionId of shared.subscriberIds) {
      const record = this.subscriptions.get(subscriptionId);
      if (record) {
        this.deliverEvent(record, type, absolutePath);
      }
    }
  }

  private deliverEvent(
    record: FileWatcherSubscriptionRecord,
    type: FileWatcherEventType,
    absolutePath: string
  ): void {
    const uri = pathToFileURL(absolutePath).toString();
    if (this.isMuted(uri)) {
      return;
    }
    const sink = this.webContentsLookup(record.webContentsId);
    if (!sink || sink.isDestroyed()) {
      return;
    }
    const event: FileWatcherEvent = {
      type,
      uri,
      timestamp: new Date(this.now()).toISOString()
    };
    sink.send("file-watcher:event", { subscriptionId: record.subscriptionId, event });
  }

  private assertLocalUri(uri: string): void {
    if (!uri.startsWith("file:") && !uri.startsWith("untitled:")) {
      throw new Error(`Unsupported file watcher URI scheme: ${uri}`);
    }
  }
}
