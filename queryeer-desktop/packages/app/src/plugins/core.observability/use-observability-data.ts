import { useEffect, useState } from "react";
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

export function resetHistoryForTests(): void {
  history.length = 0;
}

/**
 * Polls the backend status while the view is shown. The shell pushes status only when the backend run changes, so
 * ping times, memory and executions are read on an interval. `tick` changes on every poll so the frontend state,
 * which has no change events, is re-read too.
 */
export function useObservabilityPolling(): { backendStatus: BackendGatewayStatus | null; tick: number; refresh: () => void } {
  const [backendStatus, setBackendStatus] = useState<BackendGatewayStatus | null>(null);
  const [tick, setTick] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const status = await window.appShell.getBackendStatus().catch((): BackendGatewayStatus | null => null);
      if (!active) {
        return;
      }
      recordSample(status);
      setBackendStatus(status);
      setTick((value) => value + 1);
    };
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refreshToken]);

  return { backendStatus, tick, refresh: () => setRefreshToken((value) => value + 1) };
}
