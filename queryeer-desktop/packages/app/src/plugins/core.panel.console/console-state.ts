import type { BackendLogEntry, BackendLogLevel } from "@queryeer/api/backend";

type Listener = () => void;

type ConsoleNotificationState = {
  unseenErrorCount: number;
};

export type ConsoleLogOrigin = "backend" | "frontend";

export type ConsoleLogEntry = {
  origin: ConsoleLogOrigin;
  timestamp: string;
  level: BackendLogLevel;
  source: string;
  message: string;
};

/**
 * Max entries retained in the renderer. The main process only keeps a small
 * ring buffer, so the console accumulates entries here to keep them available
 * regardless of whether the panel was open when they were logged.
 */
export const MAX_CONSOLE_LOG_ENTRIES = 2000;

const state: ConsoleNotificationState = {
  unseenErrorCount: 0
};

let consolePanelVisible = false;

const listeners = new Set<Listener>();

/** Immutable snapshot, replaced on every mutation (stable for useSyncExternalStore). */
let logEntries: readonly ConsoleLogEntry[] = [];
/** Keys of the backend entries in the most recent main-process snapshot. */
let backendEntryKeys = new Set<string>();
/** Backend entries older than this (ISO timestamp) are ignored, so a poll in flight during Clear cannot resurrect them. */
let backendClearCutoff = "";

function backendEntryKey(entry: BackendLogEntry): string {
  return `${entry.timestamp}-${entry.level}-${entry.source}-${entry.message}`;
}

function isHighPriority(level: BackendLogLevel): boolean {
  return level === "warn" || level === "error";
}

function appendEntries(added: ConsoleLogEntry[]): void {
  logEntries = trimToCapacity([...logEntries, ...added]);
}

/** Drops the oldest low-priority entries first (then the oldest warn/error) in a single pass. */
function trimToCapacity(entries: ConsoleLogEntry[]): ConsoleLogEntry[] {
  const overflow = entries.length - MAX_CONSOLE_LOG_ENTRIES;
  if (overflow <= 0) {
    return entries;
  }
  const lowPriorityCount = entries.reduce((count, entry) => (isHighPriority(entry.level) ? count : count + 1), 0);
  let lowToDrop = Math.min(overflow, lowPriorityCount);
  let highToDrop = overflow - lowToDrop;
  return entries.filter((entry) => {
    if (isHighPriority(entry.level)) {
      if (highToDrop > 0) {
        highToDrop -= 1;
        return false;
      }
      return true;
    }
    if (lowToDrop > 0) {
      lowToDrop -= 1;
      return false;
    }
    return true;
  });
}

export function addFrontendLogEntry(level: BackendLogLevel, source: string, message: string): void {
  appendEntries([{ origin: "frontend", timestamp: new Date().toISOString(), level, source, message }]);
  if (level === "error" && !consolePanelVisible) {
    state.unseenErrorCount += 1;
  }
  emit();
}

/**
 * Merges a snapshot of the main-process backend log buffer into the console store.
 * Entries already ingested are skipped; new errors bump the unseen counter while the panel is hidden.
 */
export function ingestBackendLogEntries(entries: readonly BackendLogEntry[]): void {
  const added: ConsoleLogEntry[] = [];
  // Dedupe against the previous main-process snapshot rather than the renderer store: an entry
  // the renderer has evicted but main still holds must not be re-ingested (and re-counted).
  const snapshotKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.timestamp < backendClearCutoff) {
      continue;
    }
    const key = backendEntryKey(entry);
    snapshotKeys.add(key);
    if (backendEntryKeys.has(key)) {
      continue;
    }
    added.push({ origin: "backend", ...entry });
    if (entry.level === "error" && !consolePanelVisible) {
      state.unseenErrorCount += 1;
    }
  }
  backendEntryKeys = snapshotKeys;
  if (added.length === 0) {
    return;
  }
  appendEntries(added);
  emit();
}

export function getConsoleLogEntries(): readonly ConsoleLogEntry[] {
  return logEntries;
}

export function clearConsoleLogEntries(): void {
  logEntries = [];
  backendEntryKeys = new Set<string>();
  backendClearCutoff = new Date().toISOString();
  emit();
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeConsoleNotification(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConsoleNotificationState(): ConsoleNotificationState {
  return { ...state };
}

export function getConsolePanelVisible(): boolean {
  return consolePanelVisible;
}

export function setConsolePanelVisible(visible: boolean): void {
  if (consolePanelVisible === visible) {
    return;
  }
  consolePanelVisible = visible;
  if (visible) {
    resetConsoleNotifications();
  } else {
    emit();
  }
}

export function notifyConsoleErrorAppended(): void {
  state.unseenErrorCount += 1;
  emit();
}

export function resetConsoleNotifications(): void {
  if (state.unseenErrorCount === 0) {
    return;
  }
  state.unseenErrorCount = 0;
  emit();
}
