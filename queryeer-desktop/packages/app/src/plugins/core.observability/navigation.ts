import { useEffect, useSyncExternalStore } from "react";
import type { SectionId } from "./model";

export type ObservabilityLocation = { section: SectionId; pluginId?: string; filter?: "problems" };

const STORAGE_KEY = "core.observability.section";
const SECTIONS: readonly SectionId[] = ["overview", "plugins", "contributions", "engines", "backend"];

// The location the editor shows and the sidebar menu highlights: one store, so both follow each other
let current: ObservabilityLocation | null = null;
const listeners = new Set<() => void>();

/** Shows a location: an open view navigates at once; otherwise it opens there. */
export function revealInObservability(location: ObservabilityLocation): void {
  current = location;
  rememberSection(location.section);
  for (const listener of listeners) {
    listener();
  }
}

/** The location shown: the last one navigated to, else the last section of an earlier run, else the overview. */
function getObservabilityLocation(): ObservabilityLocation {
  if (!current) {
    current = { section: storedSection() ?? "overview" };
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useObservabilityLocation(): ObservabilityLocation {
  return useSyncExternalStore(subscribe, getObservabilityLocation);
}

let openEditors = 0;

/**
 * Called by each Observability editor while it's open. When the last one closes, the location keeps only its section:
 * a plugin or a "problems" filter asked for by "Show Plugin Problems" or the Plugin Manager applies to that visit, not
 * to the next time Observability is opened.
 */
export function useObservabilityEditorOpen(): void {
  useEffect(() => {
    openEditors += 1;
    return () => {
      openEditors -= 1;
      if (openEditors === 0 && current) {
        current = { section: current.section };
      }
    };
  }, []);
}

function storedSection(): SectionId | undefined {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && (SECTIONS as string[]).includes(stored) ? (stored as SectionId) : undefined;
  } catch {
    // storage unavailable
    return undefined;
  }
}

function rememberSection(section: SectionId): void {
  try {
    localStorage.setItem(STORAGE_KEY, section);
  } catch {
    // not remembered
  }
}

export function resetNavigationForTests(): void {
  listeners.clear();
  current = null;
  openEditors = 0;
}
