import type { PluginChangelogEntry } from "@queryeer/api/extensions/AboutExtension.js";

type Listener = () => void;

type AboutDialogState = {
  isOpen: boolean;
  desktopChangelog: string | null;
  backendChangelogs: PluginChangelogEntry[];
  appVersion: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
};

const listeners = new Set<Listener>();
let state: AboutDialogState = {
  isOpen: false,
  desktopChangelog: null,
  backendChangelogs: [],
  appVersion: "",
  electronVersion: "",
  chromiumVersion: "",
  nodeVersion: "",
  platform: "",
  arch: ""
};

export function openAboutDialog(): void {
  if (state.isOpen) {
    return;
  }
  state = { ...state, isOpen: true };
  emitChanged();
}

export function closeAboutDialog(): void {
  if (!state.isOpen) {
    return;
  }
  state = { ...state, isOpen: false };
  emitChanged();
}

export function isAboutDialogOpen(): boolean {
  return state.isOpen;
}

export function subscribeAboutDialog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAboutDialogState(): AboutDialogState {
  return state;
}

export function setDesktopChangelog(text: string | null): void {
  state = { ...state, desktopChangelog: text };
  emitChanged();
}

export function setBackendChangelogs(entries: PluginChangelogEntry[]): void {
  state = { ...state, backendChangelogs: entries };
  emitChanged();
}

export function setAppMetadata(metadata: {
  appVersion: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}): void {
  state = { ...state, ...metadata };
  emitChanged();
}

export function registerChangelog(entry: PluginChangelogEntry): void {
  const existingIndex = state.backendChangelogs.findIndex((e) => e.pluginId === entry.pluginId);
  const updated = [...state.backendChangelogs];
  if (existingIndex >= 0) {
    updated[existingIndex] = entry;
  } else {
    updated.push(entry);
  }
  state = { ...state, backendChangelogs: updated };
  emitChanged();
}

export function getChangelogEntries(): PluginChangelogEntry[] {
  return [...state.backendChangelogs].sort((a, b) => a.pluginName.localeCompare(b.pluginName));
}

export function hasChangelog(pluginId: string): boolean {
  return state.backendChangelogs.some((e) => e.pluginId === pluginId);
}

function emitChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}
