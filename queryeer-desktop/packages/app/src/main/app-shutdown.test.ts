import { describe, expect, it, vi } from "vitest";
import { createBeforeQuitHandler } from "./app-shutdown.js";

describe("createBeforeQuitHandler", () => {
  it("awaits backend stop and workspace flush before quit", async () => {
    let releaseStop: () => void = () => {
      throw new Error("stopBackend release callback was not initialized");
    };
    const stopBackendPromise = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const stopBackend = vi.fn(() => stopBackendPromise);
    const flushWorkspace = vi.fn(async () => {});
    const flushWindowState = vi.fn(async () => {});
    const requestQuit = vi.fn();
    const preventDefault = vi.fn();

    const handler = createBeforeQuitHandler({ stopBackend, flushWorkspace, flushWindowState, requestQuit });
    handler({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopBackend).toHaveBeenCalledTimes(1);
    expect(flushWorkspace).not.toHaveBeenCalled();
    expect(flushWindowState).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();

    releaseStop();
    await vi.waitFor(() => {
      expect(flushWorkspace).toHaveBeenCalledTimes(1);
      expect(flushWindowState).toHaveBeenCalledTimes(1);
      expect(requestQuit).toHaveBeenCalledTimes(1);
    });
  });

  it("runs shutdown once for repeated before-quit events", async () => {
    const stopBackend = vi.fn(async () => {});
    const flushWorkspace = vi.fn(async () => {});
    const flushWindowState = vi.fn(async () => {});
    const requestQuit = vi.fn();
    const preventDefault = vi.fn();

    const handler = createBeforeQuitHandler({ stopBackend, flushWorkspace, flushWindowState, requestQuit });
    handler({ preventDefault });
    handler({ preventDefault });

    await vi.waitFor(() => {
      expect(preventDefault).toHaveBeenCalledTimes(1);
      expect(stopBackend).toHaveBeenCalledTimes(1);
      expect(flushWorkspace).toHaveBeenCalledTimes(1);
      expect(flushWindowState).toHaveBeenCalledTimes(1);
      expect(requestQuit).toHaveBeenCalledTimes(1);
    });
  });
});
