import type { PluginChangelogEntry } from "@queryeer/api/extensions/AboutExtension.js";
import type { Disposable } from "@queryeer/api/editor/EditorApi";
import { toDisposable } from "../../core/plugin-runtime/disposables";

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

/** Adds or replaces the plugin's changelog. Disposing removes it, unless a later registration replaced it. */
export function registerChangelog(entry: PluginChangelogEntry): Disposable {
  // A copy per registration, so the same entry registered twice is two registrations
  const stored = { ...entry };
  const existingIndex = state.backendChangelogs.findIndex((e) => e.pluginId === entry.pluginId);
  const updated = [...state.backendChangelogs];
  if (existingIndex >= 0) {
    updated[existingIndex] = stored;
  } else {
    updated.push(stored);
  }
  state = { ...state, backendChangelogs: updated };
  emitChanged();
  return toDisposable(() => {
    if (!state.backendChangelogs.includes(stored)) {
      return;
    }
    state = { ...state, backendChangelogs: state.backendChangelogs.filter((e) => e !== stored) };
    emitChanged();
  });
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
