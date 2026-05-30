import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileWatcherMainService,
  type WatcherFactory,
  type WatcherFactoryParams,
  type WatcherHandle,
  type WebContentsSink
} from "./file-watcher-service.js";

function makeTestUri(name: string): string {
  return pathToFileURL(join(tmpdir(), name)).toString();
}

function makeService(opts?: {
  now?: () => number;
  ids?: string[];
  watcherFactory?: WatcherFactory;
  webContentsLookup?: (id: number) => WebContentsSink | null;
}): FileWatcherMainService {
  const idQueue = opts?.ids ? [...opts.ids] : undefined;
  return new FileWatcherMainService({
    generateSubscriptionId: idQueue ? () => idQueue.shift()! : undefined,
    now: opts?.now,
    watcherFactory: opts?.watcherFactory,
    webContentsLookup: opts?.webContentsLookup
  });
}

describe("FileWatcherMainService subscription bookkeeping", () => {
  it("registers a subscription and returns an id", () => {
    const service = makeService({ ids: ["sub-1"] });

    const result = service.watch(makeTestUri("a.txt"), {}, 101);

    expect(result.subscriptionId).toBe("sub-1");
    expect(service.subscriptionCount()).toBe(1);
  });

  it("returns removed=false for unknown subscription id", async () => {
    const service = makeService();
    await expect(service.unwatch("does-not-exist")).resolves.toEqual({ removed: false });
  });

  it("rejects non-local URIs", () => {
    const service = makeService();
    expect(() => service.watch("https://remote/x.txt", {}, 101)).toThrow(/Unsupported/);
  });

  it("honors recursive option", () => {
    const service = makeService({ ids: ["sub-1"] });
    service.watch(makeTestUri("dir"), { recursive: true }, 101);

    expect(service.listSubscriptions()[0].recursive).toBe(true);
  });

  it("does not invoke the watcher factory for untitled URIs", () => {
    const factory = vi.fn<WatcherFactory>(() => ({ close: async () => {} }));
    const service = makeService({ watcherFactory: factory, ids: ["sub-1"] });

    service.watch("untitled:new-1", {}, 101);

    expect(factory).not.toHaveBeenCalled();
    expect(service.subscriptionCount()).toBe(1);
  });
});

describe("FileWatcherMainService mute API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses events within the window and auto-clears on expiry", () => {
    const service = makeService();

    service.mutePath(makeTestUri("a.txt"), 500);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(true);

    vi.advanceTimersByTime(400);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(true);

    vi.advanceTimersByTime(200);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(false);
  });

  it("mutePath is per-uri, not global", () => {
    const service = makeService();

    service.mutePath(makeTestUri("a.txt"), 500);

    expect(service.isMuted(makeTestUri("a.txt"))).toBe(true);
    expect(service.isMuted(makeTestUri("b.txt"))).toBe(false);
  });

  it("calling mutePath again on the same URI resets the timer", () => {
    const service = makeService();

    service.mutePath(makeTestUri("a.txt"), 500);
    vi.advanceTimersByTime(400);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(true);

    service.mutePath(makeTestUri("a.txt"), 500);
    vi.advanceTimersByTime(400);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(true);

    vi.advanceTimersByTime(200);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(false);
  });

  it("unmutePath cancels the timer immediately", () => {
    const service = makeService();

    service.mutePath(makeTestUri("a.txt"), 500);
    const result = service.unmutePath(makeTestUri("a.txt"));

    expect(result.unmuted).toBe(true);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(false);
  });

  it("unmutePath returns false for unmuted URI", () => {
    const service = makeService();
    expect(service.unmutePath(makeTestUri("never.txt")).unmuted).toBe(false);
  });

  it("mutePath with duration 0 does not mute", () => {
    const service = makeService();

    const result = service.mutePath(makeTestUri("a.txt"), 0);

    expect(result.muted).toBe(false);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(false);
  });

  it("dispose clears all pending mute timers", () => {
    const service = makeService();

    service.mutePath(makeTestUri("a.txt"), 500);
    service.mutePath(makeTestUri("b.txt"), 500);
    expect(service.isMuted(makeTestUri("a.txt"))).toBe(true);
    expect(service.isMuted(makeTestUri("b.txt"))).toBe(true);

    service.dispose();

    expect(service.isMuted(makeTestUri("a.txt"))).toBe(false);
    expect(service.isMuted(makeTestUri("b.txt"))).toBe(false);
  });
});

describe("FileWatcherMainService watcher lifecycle", () => {
  function captureHandlers(): {
    factory: WatcherFactory;
    handle: WatcherHandle;
    current: () => WatcherFactoryParams;
  } {
    let captured: WatcherFactoryParams | null = null;
    const handle: WatcherHandle = { close: vi.fn(async () => {}) };
    const factory: WatcherFactory = (params) => {
      captured = params;
      return handle;
    };
    return {
      factory,
      handle,
      current: () => {
        if (!captured) {
          throw new Error("Watcher factory was not called");
        }
        return captured;
      }
    };
  }

  it("creates a watcher via the factory and forwards uri path", () => {
    const cap = captureHandlers();
    const service = makeService({ watcherFactory: cap.factory, ids: ["sub-1"] });
    const uri = makeTestUri("watched.txt");

    service.watch(uri, { recursive: true }, 101);

    const params = cap.current();
    expect(params.recursive).toBe(true);
    expect(params.path).toContain("watched.txt");
  });

  it("closes the watcher on unwatch", async () => {
    const cap = captureHandlers();
    const service = makeService({ watcherFactory: cap.factory, ids: ["sub-1"] });
    service.watch(makeTestUri("a.txt"), {}, 101);

    await service.unwatch("sub-1");

    expect(cap.handle.close).toHaveBeenCalledTimes(1);
    expect(service.subscriptionCount()).toBe(0);
  });

  it("delivers add/modify/delete events to the owning webContents sink", () => {
    const sink: WebContentsSink = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    };
    const cap = captureHandlers();
    const service = makeService({
      watcherFactory: cap.factory,
      webContentsLookup: (id) => (id === 101 ? sink : null),
      ids: ["sub-1"]
    });
    service.watch(makeTestUri("a.txt"), {}, 101);

    const { path, onAdd, onModify, onDelete } = cap.current();
    onAdd(path);
    onModify(path);
    onDelete(path);

    expect(sink.send).toHaveBeenCalledTimes(3);
    const calls = (sink.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("file-watcher:event");
    const events = calls.map((c) => (c[1] as { event: { type: string } }).event.type);
    expect(events).toEqual(["add", "modify", "delete"]);
  });

  it("suppresses events for muted URIs", () => {
    const sink: WebContentsSink = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    };
    const cap = captureHandlers();
    const service = makeService({
      watcherFactory: cap.factory,
      webContentsLookup: () => sink,
      now: () => 1_000,
      ids: ["sub-1"]
    });
    const uri = makeTestUri("muted.txt");
    service.watch(uri, {}, 101);
    service.mutePath(uri, 500);

    const { path, onModify } = cap.current();
    onModify(path);

    expect(sink.send).not.toHaveBeenCalled();
  });

  it("drops events when the webContents is destroyed", () => {
    const sink: WebContentsSink = {
      isDestroyed: vi.fn(() => true),
      send: vi.fn()
    };
    const cap = captureHandlers();
    const service = makeService({
      watcherFactory: cap.factory,
      webContentsLookup: () => sink,
      ids: ["sub-1"]
    });
    service.watch(makeTestUri("a.txt"), {}, 101);

    const { path, onModify } = cap.current();
    onModify(path);

    expect(sink.send).not.toHaveBeenCalled();
  });

  it("drops events when lookup returns null", () => {
    const cap = captureHandlers();
    const service = makeService({
      watcherFactory: cap.factory,
      webContentsLookup: () => null,
      ids: ["sub-1"]
    });
    service.watch(makeTestUri("a.txt"), {}, 101);

    const { path, onModify } = cap.current();
    expect(() => onModify(path)).not.toThrow();
  });

  it("logs error events from the factory", () => {
    const logError = vi.fn();
    const cap = captureHandlers();
    const service = new FileWatcherMainService({
      watcherFactory: cap.factory,
      logError,
      generateSubscriptionId: () => "sub-1"
    });
    service.watch(makeTestUri("a.txt"), {}, 101);

    cap.current().onError(new Error("disk exploded"));

    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0][0]).toMatch(/File watcher error/);
  });
});

describe("FileWatcherMainService watcher deduplication", () => {
  function collectAllParams(): {
    factory: WatcherFactory;
    all: () => WatcherFactoryParams[];
    handles: () => WatcherHandle[];
  } {
    const collected: WatcherFactoryParams[] = [];
    const handles: WatcherHandle[] = [];
    const factory: WatcherFactory = (params) => {
      collected.push(params);
      const handle: WatcherHandle = { close: vi.fn(async () => {}) };
      handles.push(handle);
      return handle;
    };
    return { factory, all: () => collected, handles: () => handles };
  }

  it("shares one watcher for two subscriptions on the same uri + recursive", () => {
    const cap = collectAllParams();
    const service = makeService({ watcherFactory: cap.factory, ids: ["sub-1", "sub-2"] });
    const uri = makeTestUri("shared.txt");

    service.watch(uri, {}, 101);
    service.watch(uri, {}, 102);

    expect(cap.all()).toHaveLength(1);
    expect(service.subscriptionCount()).toBe(2);
    expect(service.watcherCount()).toBe(1);
  });

  it("creates separate watchers when recursive differs on the same uri", () => {
    const cap = collectAllParams();
    const service = makeService({ watcherFactory: cap.factory, ids: ["sub-1", "sub-2"] });
    const uri = makeTestUri("dir");

    service.watch(uri, { recursive: false }, 101);
    service.watch(uri, { recursive: true }, 101);

    expect(cap.all()).toHaveLength(2);
    expect(service.watcherCount()).toBe(2);
  });

  it("fans events out to every subscriber sharing a watcher", () => {
    const sinkA: WebContentsSink = { isDestroyed: () => false, send: vi.fn() };
    const sinkB: WebContentsSink = { isDestroyed: () => false, send: vi.fn() };
    const cap = collectAllParams();
    const service = makeService({
      watcherFactory: cap.factory,
      webContentsLookup: (id) => (id === 101 ? sinkA : id === 102 ? sinkB : null),
      ids: ["sub-A", "sub-B"]
    });
    const uri = makeTestUri("fanout.txt");

    service.watch(uri, {}, 101);
    service.watch(uri, {}, 102);

    const shared = cap.all()[0]!;
    shared.onModify(shared.path);

    expect(sinkA.send).toHaveBeenCalledTimes(1);
    expect(sinkB.send).toHaveBeenCalledTimes(1);
    const sentA = (sinkA.send as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      subscriptionId: string;
    };
    const sentB = (sinkB.send as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      subscriptionId: string;
    };
    expect(sentA.subscriptionId).toBe("sub-A");
    expect(sentB.subscriptionId).toBe("sub-B");
  });

  it("keeps the shared watcher open while other subscribers remain", async () => {
    const cap = collectAllParams();
    const service = makeService({ watcherFactory: cap.factory, ids: ["sub-1", "sub-2"] });
    const uri = makeTestUri("keep.txt");

    service.watch(uri, {}, 101);
    service.watch(uri, {}, 102);

    await service.unwatch("sub-1");

    expect(cap.handles()[0]!.close).not.toHaveBeenCalled();
    expect(service.watcherCount()).toBe(1);
    expect(service.subscriptionCount()).toBe(1);
  });

  it("closes the shared watcher only when the last subscriber unwatches", async () => {
    const cap = collectAllParams();
    const service = makeService({ watcherFactory: cap.factory, ids: ["sub-1", "sub-2"] });
    const uri = makeTestUri("last.txt");

    service.watch(uri, {}, 101);
    service.watch(uri, {}, 102);

    await service.unwatch("sub-1");
    await service.unwatch("sub-2");

    expect(cap.handles()[0]!.close).toHaveBeenCalledTimes(1);
    expect(service.watcherCount()).toBe(0);
    expect(service.subscriptionCount()).toBe(0);
  });

  it("after dedup release, a new subscription reopens a fresh watcher", async () => {
    const cap = collectAllParams();
    const service = makeService({
      watcherFactory: cap.factory,
      ids: ["sub-1", "sub-2"]
    });
    const uri = makeTestUri("reopen.txt");

    service.watch(uri, {}, 101);
    await service.unwatch("sub-1");
    service.watch(uri, {}, 102);

    expect(cap.all()).toHaveLength(2);
    expect(service.watcherCount()).toBe(1);
  });
});
