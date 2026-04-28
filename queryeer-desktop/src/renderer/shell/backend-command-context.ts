import type { ContextValues } from "../../plugins/core.commands/when-evaluator";

export type BackendCommandContext = {
  snapshot: () => ContextValues;
  initialize: () => Promise<void>;
  onDidChange: (listener: () => void) => () => void;
  dispose: () => void;
};

export function createBackendCommandContext(pollIntervalMs = 1200): BackendCommandContext {
  const values: ContextValues = {
    backendHealthy: false,
    backendStarting: true,
    backendUnavailable: false
  };
  let intervalHandle: number | null = null;
  const listeners = new Set<() => void>();

  const notifyChanged = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const refresh = async () => {
    const previous = `${values.backendHealthy}|${values.backendStarting}|${values.backendUnavailable}`;
    try {
      const status = await window.appShell.getBackendStatus();
      values.backendHealthy = status.state === "healthy";
      values.backendStarting = status.state === "starting";
      values.backendUnavailable = status.state === "unavailable";
    } catch {
      values.backendHealthy = false;
      values.backendStarting = false;
      values.backendUnavailable = true;
    }
    const next = `${values.backendHealthy}|${values.backendStarting}|${values.backendUnavailable}`;
    if (next !== previous) {
      notifyChanged();
    }
  };

  return {
    snapshot: () => ({ ...values }),
    initialize: async () => {
      await refresh();
      intervalHandle = window.setInterval(() => {
        void refresh();
      }, pollIntervalMs);
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (intervalHandle !== null) {
        window.clearInterval(intervalHandle);
        intervalHandle = null;
      }
    }
  };
}
