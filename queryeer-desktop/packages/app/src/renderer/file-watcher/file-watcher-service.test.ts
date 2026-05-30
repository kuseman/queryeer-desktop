import { describe, expect, it, vi } from "vitest";
import {
  RendererFileWatcherService,
  type FileWatcherBridge
} from "./file-watcher-service";

type PayloadListener = Parameters<FileWatcherBridge["onFileWatcherEvent"]>[0];

function createBridgeHarness(nextSubscriptionId = "sub-1"): {
  bridge: FileWatcherBridge;
  emit: (subscriptionId: string, event: {
    type: "add" | "modify" | "delete" | "rename";
    uri: string;
    timestamp: string;
  }) => void;
  watchMock: ReturnType<typeof vi.fn>;
  unwatchMock: ReturnType<typeof vi.fn>;
  muteMock: ReturnType<typeof vi.fn>;
  detachMock: ReturnType<typeof vi.fn>;
} {
  let listener: PayloadListener | null = null;
  const detachMock = vi.fn();
  const watchMock = vi.fn(async () => ({ subscriptionId: nextSubscriptionId }));
  const unwatchMock = vi.fn(async () => ({ removed: true }));
  const muteMock = vi.fn(async () => ({ muted: true }));

  const bridge: FileWatcherBridge = {
    watchFile: watchMock,
    unwatchFile: unwatchMock,
    muteFileWatcherPath: muteMock,
    onFileWatcherEvent: (incoming) => {
      listener = incoming;
      return detachMock;
    }
  };

  const emit = (subscriptionId: string, event: {
    type: "add" | "modify" | "delete" | "rename";
    uri: string;
    timestamp: string;
  }) => {
    if (!listener) {
      throw new Error("No listener registered");
    }
    listener({ subscriptionId, event });
  };

  return { bridge, emit, watchMock, unwatchMock, muteMock, detachMock };
}

describe("RendererFileWatcherService", () => {
  it("routes events to the correct handler by subscriptionId", async () => {
    const { bridge, emit, watchMock } = createBridgeHarness("sub-1");
    const service = new RendererFileWatcherService(bridge);
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    watchMock.mockResolvedValueOnce({ subscriptionId: "sub-1" });
    await service.watch("file:///a.txt", {}, handlerA);
    watchMock.mockResolvedValueOnce({ subscriptionId: "sub-2" });
    await service.watch("file:///b.txt", {}, handlerB);

    emit("sub-1", { type: "modify", uri: "file:///a.txt", timestamp: "t" });
    emit("sub-2", { type: "delete", uri: "file:///b.txt", timestamp: "t" });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledWith({
      type: "modify",
      uri: "file:///a.txt",
      timestamp: "t"
    });
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("ignores events for unknown subscriptions", async () => {
    const { bridge, emit } = createBridgeHarness();
    const service = new RendererFileWatcherService(bridge);
    const handler = vi.fn();
    await service.watch("file:///a.txt", {}, handler);

    emit("ghost-sub", { type: "modify", uri: "file:///a.txt", timestamp: "t" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("stops routing after unsubscribe", async () => {
    const { bridge, emit, unwatchMock } = createBridgeHarness();
    const service = new RendererFileWatcherService(bridge);
    const handler = vi.fn();

    const subscription = await service.watch("file:///a.txt", {}, handler);
    await subscription.unsubscribe();

    emit(subscription.subscriptionId, { type: "modify", uri: "file:///a.txt", timestamp: "t" });

    expect(handler).not.toHaveBeenCalled();
    expect(unwatchMock).toHaveBeenCalledWith({ subscriptionId: subscription.subscriptionId });
    expect(service.handlerCount()).toBe(0);
  });

  it("forwards mutePath through the bridge", async () => {
    const { bridge, muteMock } = createBridgeHarness();
    const service = new RendererFileWatcherService(bridge);

    await service.mutePath("file:///a.txt", 500);

    expect(muteMock).toHaveBeenCalledWith({ uri: "file:///a.txt", durationMs: 500 });
  });

  it("dispose detaches the event listener and clears handlers", async () => {
    const { bridge, detachMock } = createBridgeHarness();
    const service = new RendererFileWatcherService(bridge);
    await service.watch("file:///a.txt", {}, vi.fn());

    service.dispose();

    expect(detachMock).toHaveBeenCalledTimes(1);
    expect(service.handlerCount()).toBe(0);
  });
});
