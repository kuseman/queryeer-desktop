import type {
  FileWatcherEvent,
  FileWatcherEventHandler,
  FileWatcherService,
  FileWatcherSubscription,
  FileWatcherWatchOptions
} from "@queryeer/api/files/FileWatcher";

export type FileWatcherBridge = {
  watchFile: (params: {
    uri: string;
    options: FileWatcherWatchOptions;
  }) => Promise<{ subscriptionId: string }>;
  unwatchFile: (params: { subscriptionId: string }) => Promise<{ removed: boolean }>;
  muteFileWatcherPath: (params: { uri: string; durationMs: number }) => Promise<{ muted: boolean }>;
  onFileWatcherEvent: (
    listener: (params: { subscriptionId: string; event: FileWatcherEvent }) => void
  ) => () => void;
};

export class RendererFileWatcherService implements FileWatcherService {
  private readonly bridge: FileWatcherBridge;
  private readonly handlers = new Map<string, FileWatcherEventHandler>();
  private readonly detachEventListener: () => void;

  public constructor(bridge: FileWatcherBridge) {
    this.bridge = bridge;
    this.detachEventListener = bridge.onFileWatcherEvent(({ subscriptionId, event }) => {
      const handler = this.handlers.get(subscriptionId);
      if (handler) {
        handler(event);
      }
    });
  }

  public async watch(
    uri: string,
    options: FileWatcherWatchOptions,
    handler: FileWatcherEventHandler
  ): Promise<FileWatcherSubscription> {
    const { subscriptionId } = await this.bridge.watchFile({ uri, options });
    this.handlers.set(subscriptionId, handler);
    return {
      subscriptionId,
      unsubscribe: async () => {
        this.handlers.delete(subscriptionId);
        await this.bridge.unwatchFile({ subscriptionId });
      }
    };
  }

  public async mutePath(uri: string, durationMs: number): Promise<void> {
    await this.bridge.muteFileWatcherPath({ uri, durationMs });
  }

  public handlerCount(): number {
    return this.handlers.size;
  }

  public dispose(): void {
    this.detachEventListener();
    this.handlers.clear();
  }
}
