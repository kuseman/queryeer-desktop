import type { SectionId } from "./model";

export type ObservabilityLocation = { section: SectionId; pluginId?: string; filter?: "problems" };

const STORAGE_KEY = "core.observability.section";
const SECTIONS: readonly SectionId[] = ["overview", "plugins", "contributions", "engines", "backend"];

type Listener = (location: ObservabilityLocation) => void;
const listeners = new Set<Listener>();
let pending: ObservabilityLocation | null = null;

/**
 * Asks the observability view to show a location. An open view navigates at once; otherwise the view starts there
 * the next time it opens.
 */
export function revealInObservability(location: ObservabilityLocation): void {
  if (listeners.size === 0) {
    pending = location;
    return;
  }
  for (const listener of listeners) {
    listener(location);
  }
}

export function onRevealInObservability(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The location the view opens on: a pending reveal, else the last section shown. */
export function takeInitialLocation(): ObservabilityLocation {
  if (pending) {
    const location = pending;
    pending = null;
    return location;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SECTIONS as string[]).includes(stored)) {
      return { section: stored as SectionId };
    }
  } catch {
    // storage unavailable: start on the overview
  }
  return { section: "overview" };
}

export function rememberSection(section: SectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, section);
  } catch {
    // not remembered
  }
}

export function resetNavigationForTests(): void {
  listeners.clear();
  pending = null;
}
