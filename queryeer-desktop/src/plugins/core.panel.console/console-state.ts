import type { BackendLogLevel } from "../../contracts/backend";

type Listener = () => void;

type ConsoleNotificationState = {
  unseenErrorCount: number;
};

export type FrontendLogEntry = {
  timestamp: string;
  level: BackendLogLevel;
  source: string;
  message: string;
};

const state: ConsoleNotificationState = {
  unseenErrorCount: 0
};

let consolePanelVisible = false;

const listeners = new Set<Listener>();

const frontendLogs: FrontendLogEntry[] = [];

export function addFrontendLogEntry(level: BackendLogLevel, source: string, message: string): void {
  frontendLogs.push({ timestamp: new Date().toISOString(), level, source, message });
  if (level === "error" && !consolePanelVisible) {
    state.unseenErrorCount += 1;
  }
  emit();
}

export function getFrontendLogEntries(): FrontendLogEntry[] {
  return frontendLogs.slice();
}

export function clearFrontendLogEntries(): void {
  frontendLogs.length = 0;
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
