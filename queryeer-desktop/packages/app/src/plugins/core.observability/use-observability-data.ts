import { useSyncExternalStore } from "react";
import type { BackendGatewayStatus } from "@queryeer/api/backend";

export const POLL_INTERVAL_MS = 2000;
const HISTORY_LENGTH = 90;

export type Sample = {
  at: number;
  rttMs?: number;
  jvmUsedBytes?: number;
  jvmMaxBytes?: number;
  rendererUsedBytes?: number;
  rendererLimitBytes?: number;
};

// Kept across view re-mounts, so reopening the view keeps the recent trend
const history: Sample[] = [];

export function readRendererMemory(): { usedBytes: number; limitBytes: number } | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return memory ? { usedBytes: memory.usedJSHeapSize, limitBytes: memory.jsHeapSizeLimit } : null;
}

export function recordSample(status: BackendGatewayStatus | null, now = Date.now()): void {
  const renderer = readRendererMemory();
  history.push({
    at: now,
    rttMs: status?.lastPingRttMs,
    jvmUsedBytes: status?.jvmMemory?.heapUsedBytes,
    jvmMaxBytes: status?.jvmMemory?.heapMaxBytes,
    rendererUsedBytes: renderer?.usedBytes,
    rendererLimitBytes: renderer?.limitBytes
  });
  if (history.length > HISTORY_LENGTH) {
    history.splice(0, history.length - HISTORY_LENGTH);
  }
}

export function getHistory(): readonly Sample[] {
  return history;
}

type PollState = { backendStatus: BackendGatewayStatus | null; tick: number };

// One poller for the editor and the sidebar menu, so each interval records one sample
let pollState: PollState = { backendStatus: null, tick: 0 };
const subscribers = new Set<() => void>();
let interval: number | undefined;
// Changes when polling stops, so an answer that arrives later is dropped
let generation = 0;
// Numbers each request; an answer older than the last one applied is dropped, so a slow poll can't overwrite a newer one
let lastRequest = 0;
let lastApplied = 0;

export function resetHistoryForTests(): void {
  history.length = 0;
  pollState = { backendStatus: null, tick: 0 };
  subscribers.clear();
  window.clearInterval(interval);
  interval = undefined;
  generation += 1;
}

async function poll(): Promise<void> {
  const started = generation;
  const request = ++lastRequest;
  const status = await window.appShell.getBackendStatus().catch((): BackendGatewayStatus | null => null);
  if (started !== generation || request < lastApplied) {
    return;
  }
  lastApplied = request;
  recordSample(status);
  pollState = { backendStatus: status, tick: pollState.tick + 1 };
  for (const subscriber of subscribers) {
    subscriber();
  }
}

/** Polls now and restarts the interval from here, so samples stay evenly spaced. */
function startPolling(): void {
  window.clearInterval(interval);
  void poll();
  interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  if (subscribers.size === 1) {
    startPolling();
  }
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      window.clearInterval(interval);
      interval = undefined;
      generation += 1;
    }
  };
}

function getPollState(): PollState {
  return pollState;
}

function refresh(): void {
  if (subscribers.size > 0) {
    startPolling();
  }
}

/**
 * Polls the backend status while the editor or the sidebar menu is shown. The shell pushes status only when the
 * backend run changes, so ping times, memory and executions are read on an interval. `tick` changes on every poll so
 * the frontend state, which has no change events, is re-read too.
 */
export function useObservabilityPolling(): { backendStatus: BackendGatewayStatus | null; tick: number; refresh: () => void } {
  const state = useSyncExternalStore(subscribe, getPollState);
  return { backendStatus: state.backendStatus, tick: state.tick, refresh };
}
