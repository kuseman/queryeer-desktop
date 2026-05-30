import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";

type KeybindingsRuntimeState = {
  getExtensions: () => ExtensionSnapshot;
  refresh: () => Promise<void>;
};

let runtimeState: KeybindingsRuntimeState | null = null;
const listeners = new Set<() => void>();

export function setKeybindingsRuntimeState(state: KeybindingsRuntimeState): void {
  runtimeState = state;
  for (const listener of listeners) {
    listener();
  }
}

export function getKeybindingsExtensionsSnapshot(): ExtensionSnapshot | null {
  return runtimeState?.getExtensions() ?? null;
}

export async function refreshKeybindingsFromRuntime(): Promise<void> {
  if (!runtimeState) {
    return;
  }
  await runtimeState.refresh();
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeKeybindingsRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
