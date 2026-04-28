import type { ContextValues } from "../../plugins/core.commands/when-evaluator";

export type BackendCommandContext = {
  snapshot: () => ContextValues;
  initialize: () => Promise<void>;
  dispose: () => void;
};

export function createBackendCommandContext(pollIntervalMs = 1200): BackendCommandContext {
  const values: ContextValues = {
    backendHealthy: false,
    backendStarting: true,
    backendUnavailable: false
  };
  let intervalHandle: number | null = null;

  const refresh = async () => {
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
  };

  return {
    snapshot: () => ({ ...values }),
    initialize: async () => {
      await refresh();
      intervalHandle = window.setInterval(() => {
        void refresh();
      }, pollIntervalMs);
    },
    dispose: () => {
      if (intervalHandle !== null) {
        window.clearInterval(intervalHandle);
        intervalHandle = null;
      }
    }
  };
}
