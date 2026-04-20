import { describe, expect, it, vi } from "vitest";
import { BackendExecutionStore } from "./backend-execution-store";

describe("BackendExecutionStore", () => {
  it("tracks accepted execution and active ids", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const store = new BackendExecutionStore();
    store.markAccepted("exec-1", "payloadbuilder");

    expect(store.getActiveExecutionIds()).toEqual(["exec-1"]);
    expect(store.getRecentExecutions(1)[0]?.state).toBe("accepted");

    vi.useRealTimers();
  });

  it("updates execution lifecycle to completed", () => {
    vi.useFakeTimers();
    const store = new BackendExecutionStore();
    store.markAccepted("exec-2", "payloadbuilder");

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    store.onProgress({ queryExecutionId: "exec-2", percent: 50, message: "half" });

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    store.onResultChunk({ queryExecutionId: "exec-2", rows: [[1], [2]] });

    vi.setSystemTime(new Date("2026-01-01T00:00:03.000Z"));
    store.onCompleted({ queryExecutionId: "exec-2" });

    const execution = store.getRecentExecutions(1)[0];
    expect(execution?.state).toBe("completed");
    expect(execution?.chunks).toBe(1);
    expect(execution?.rows).toBe(2);
    expect(store.getActiveExecutionIds()).toEqual([]);

    vi.useRealTimers();
  });
});
