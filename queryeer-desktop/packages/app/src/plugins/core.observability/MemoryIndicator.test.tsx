import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryIndicator } from "./MemoryIndicator";

describe("MemoryIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);

    // Mock performance.memory for the renderer heap
    Object.defineProperty(performance, "memory", {
      value: { usedJSHeapSize: 104857600, totalJSHeapSize: 209715200 },
      configurable: true,
      writable: true
    });

    (window as unknown as Record<string, unknown>).appShell = {
      ...((window as unknown as Record<string, unknown>).appShell as Record<string, unknown>),
      getBackendStatus: vi.fn(async () => ({
        state: "healthy",
        mode: "mock-stdio",
        supportedCapabilities: [],
        activeExecutionIds: [],
        recentExecutions: [],
        backendLogs: [],
        tracePayloads: false,
        jvmMemory: { heapUsedBytes: 536870912, heapMaxBytes: 2147483648 }
      }))
    };
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    vi.clearAllMocks();
    delete (performance as { memory?: unknown }).memory;
  });

  it("renders JVM and Renderer memory when available", async () => {
    act(() => { root.render(<MemoryIndicator />); });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("JVM: 512 MB");
    });
    expect(container.textContent).toContain("Renderer: 100 MB");
  });

  it("renders nothing when both sources return null", async () => {
    (window.appShell.getBackendStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: "healthy",
      mode: "mock-stdio",
      supportedCapabilities: [],
      activeExecutionIds: [],
      recentExecutions: [],
      backendLogs: [],
      tracePayloads: false
    });
    delete (performance as { memory?: unknown }).memory;

    act(() => { root.render(<MemoryIndicator />); });

    await vi.waitFor(() => {
      expect(container.textContent).toBe("");
    });
  });

  it("includes tooltip with detailed memory breakdown", async () => {
    act(() => { root.render(<MemoryIndicator />); });

    await vi.waitFor(() => {
      const span = container.querySelector("span");
      expect(span?.getAttribute("title")).toContain("JVM heap: 512 MB / 2048 MB");
    });

    const span = container.querySelector("span");
    const tooltip = span!.getAttribute("title");
    expect(tooltip).toContain("Renderer heap: 100 MB / 200 MB");
  });

  it("refreshes data on interval", async () => {
    vi.useFakeTimers();
    act(() => { root.render(<MemoryIndicator />); });
    await vi.waitFor(() => {
      expect(container.textContent).toContain("JVM:");
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(window.appShell.getBackendStatus).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
