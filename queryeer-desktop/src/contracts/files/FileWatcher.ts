export type FileWatcherEventType = "add" | "modify" | "delete" | "rename";

export type FileWatcherEvent = {
  type: FileWatcherEventType;
  uri: string;
  timestamp: string;
};

export type FileWatcherEventHandler = (event: FileWatcherEvent) => void;

export type FileWatcherSubscription = {
  subscriptionId: string;
  unsubscribe: () => Promise<void>;
};

export type FileWatcherWatchOptions = {
  recursive?: boolean;
};

export type FileWatcherService = {
  watch: (
    uri: string,
    options: FileWatcherWatchOptions,
    handler: FileWatcherEventHandler
  ) => Promise<FileWatcherSubscription>;
  mutePath: (uri: string, durationMs: number) => Promise<void>;
};
