import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutEditorContribution } from "../../contracts/extensions/LayoutExtension";
import { FileRegistry } from "./FileRegistry";
import {
  createFileMediator,
  type BackendQueryExecutor,
  type FileBackendSync
} from "./FileMediator";

function makeEditor(
  id: string,
  supportedMimeTypes?: string[]
): LayoutEditorContribution {
  return { id, title: id, supportedMimeTypes, render: () => null };
}

type Harness = {
  registry: FileRegistry;
  execute: ReturnType<typeof vi.fn>;
  sync: Required<FileBackendSync>;
  mediator: ReturnType<typeof createFileMediator>;
};

function setupHarness(options?: {
  editors?: LayoutEditorContribution[];
  changeDebounceMs?: number;
  executeResult?: { accepted: boolean; queryExecutionId: string };
}): Harness {
  const registry = new FileRegistry({
    getEditors: () => options?.editors ?? []
  });
  const filesRegistry = registry.createFilesRegistry();
  const execute = vi.fn<BackendQueryExecutor>(async (params) => ({
    accepted: options?.executeResult?.accepted ?? true,
    queryExecutionId:
      options?.executeResult?.queryExecutionId ?? params.queryExecutionId
  }));
  const sync: Required<FileBackendSync> = {
    openFile: vi.fn(async () => {}),
    closeFile: vi.fn(async () => {}),
    changeFile: vi.fn(async () => {}),
    bindFile: vi.fn(async () => {})
  };
  const mediator = createFileMediator({
    filesRegistry,
    executeBackendQuery: execute,
    backendSync: sync,
    changeDebounceMs: options?.changeDebounceMs ?? 50,
    generateQueryExecutionId: () => "qx-test"
  });
  return { registry, execute, sync, mediator };
}

describe("FileMediator.openFile", () => {
  it("classifies mime via resolvers when hint omits it", async () => {
    const editors = [makeEditor("editor.sql", ["application/sql"])];
    const { registry, mediator } = setupHarness({ editors });
    registry.createFilesRegistry().registerMimeResolver((_uri, hint) =>
      hint?.extension === "sql" ? "application/sql" : undefined
    );

    const file = await mediator.openFile("file:///a.sql");

    expect(file.mimeType).toBe("application/sql");
    expect(file.editorId).toBe("editor.sql");
  });

  it("respects declared mime hint", async () => {
    const editors = [makeEditor("editor.custom", ["text/custom"])];
    const { mediator } = setupHarness({ editors });

    const file = await mediator.openFile("untitled:x", {
      mimeType: "text/custom"
    });

    expect(file.mimeType).toBe("text/custom");
    expect(file.editorId).toBe("editor.custom");
  });

  it("returns the existing entity when uri already open", async () => {
    const editors = [makeEditor("editor.any", ["text/plain"])];
    const { mediator } = setupHarness({ editors });

    const first = await mediator.openFile("untitled:y", {
      mimeType: "text/plain"
    });
    const second = await mediator.openFile("untitled:y", {
      mimeType: "text/plain"
    });

    expect(second.fileId).toBe(first.fileId);
  });

  it("does not call backend openFile when no engine binding (lazy)", async () => {
    const editors = [makeEditor("editor.any", ["text/plain"])];
    const { mediator, sync } = setupHarness({ editors });

    await mediator.openFile("untitled:z", { mimeType: "text/plain" });

    expect(sync.openFile).not.toHaveBeenCalled();
  });

  it("calls backend openFile when engine binding is provided", async () => {
    const editors = [makeEditor("editor.any", ["text/plain"])];
    const { mediator, sync } = setupHarness({ editors });

    await mediator.openFile("file:///q.pb", {
      mimeType: "text/plain",
      engineBinding: { engineId: "payloadbuilder" }
    });

    expect(sync.openFile).toHaveBeenCalledTimes(1);
  });
});

describe("FileMediator.closeFile", () => {
  it("rejects closing a dirty file without discardDirty", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("untitled:dirty", {
      mimeType: "text/plain"
    });
    registry.createFilesRegistry().updateFile(file.fileId, {
      dirtyVsDisk: true
    });

    await expect(mediator.closeFile(file.fileId)).rejects.toThrow(
      /unsaved changes/
    );
  });

  it("closes a dirty file when discardDirty is true", async () => {
    const { mediator, registry, sync } = setupHarness();
    const file = await mediator.openFile("untitled:dirty", {
      mimeType: "text/plain"
    });
    registry.createFilesRegistry().updateFile(file.fileId, {
      dirtyVsDisk: true
    });

    await mediator.closeFile(file.fileId, { discardDirty: true });

    expect(registry.snapshot()).toHaveLength(0);
    expect(sync.closeFile).toHaveBeenCalledTimes(1);
  });
});

describe("FileMediator.notifyChanged", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces backend change calls", async () => {
    const { mediator, sync } = setupHarness({ changeDebounceMs: 100 });
    const file = await mediator.openFile("untitled:c", {
      mimeType: "text/plain"
    });

    mediator.notifyChanged(file.fileId, "select 1");
    vi.advanceTimersByTime(50);
    mediator.notifyChanged(file.fileId, "select 1");
    vi.advanceTimersByTime(50);
    mediator.notifyChanged(file.fileId, "select 1");
    vi.advanceTimersByTime(100);

    expect(sync.changeFile).toHaveBeenCalledTimes(1);
  });
});

describe("FileMediator.bindEngine", () => {
  it("sets engine binding and triggers backend openFile on first bind", async () => {
    const { mediator, sync } = setupHarness();
    const file = await mediator.openFile("untitled:b", {
      mimeType: "text/plain"
    });

    const bound = await mediator.bindEngine(file.fileId, "payloadbuilder");

    expect(bound?.engineBinding).toEqual({
      engineId: "payloadbuilder",
      connectionId: undefined
    });
    expect(sync.openFile).toHaveBeenCalledTimes(1);
    expect(sync.bindFile).not.toHaveBeenCalled();
  });

  it("calls bindFile (not openFile) on rebind", async () => {
    const { mediator, sync } = setupHarness();
    const file = await mediator.openFile("untitled:r", {
      mimeType: "text/plain",
      engineBinding: { engineId: "payloadbuilder" }
    });

    await mediator.bindEngine(file.fileId, "payloadbuilder", "conn-2");

    expect(sync.openFile).toHaveBeenCalledTimes(1);
    expect(sync.bindFile).toHaveBeenCalledTimes(1);
  });
});

describe("FileMediator.executeFile", () => {
  it("rejects without engine binding", async () => {
    const { mediator } = setupHarness();
    const file = await mediator.openFile("untitled:e", {
      mimeType: "text/plain"
    });

    await expect(mediator.executeFile(file.fileId, "select 1")).rejects.toThrow(
      /engine binding/
    );
  });

  it("forwards engineId and text to the backend executor", async () => {
    const { mediator, execute } = setupHarness();
    const file = await mediator.openFile("untitled:e2", {
      mimeType: "text/plain",
      engineBinding: { engineId: "jdbc" }
    });

    const result = await mediator.executeFile(file.fileId, "select 1");

    expect(execute).toHaveBeenCalledWith({
      queryExecutionId: "qx-test",
      engineId: "jdbc",
      text: "select 1"
    });
    expect(result.accepted).toBe(true);
  });
});

describe("FileMediator.reloadFile / acceptExternalChange / discardExternalChange", () => {
  it("reloadFile clears externallyModified, reloadPending, and dirtyVsDisk", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///r.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      externallyModified: true,
      reloadPending: true,
      dirtyVsDisk: true
    });

    const result = await mediator.reloadFile(file.fileId);

    expect(result?.externallyModified).toBe(false);
    expect(result?.reloadPending).toBe(false);
    expect(result?.dirtyVsDisk).toBe(false);
  });

  it("acceptExternalChange behaves like reloadFile", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      externallyModified: true,
      reloadPending: true,
      dirtyVsDisk: true
    });

    const result = await mediator.acceptExternalChange(file.fileId);

    expect(result?.externallyModified).toBe(false);
    expect(result?.reloadPending).toBe(false);
    expect(result?.dirtyVsDisk).toBe(false);
  });

  it("discardExternalChange clears the external flags but marks dirtyVsDisk", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///d.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      externallyModified: true,
      reloadPending: false
    });

    const result = await mediator.discardExternalChange(file.fileId);

    expect(result?.externallyModified).toBe(false);
    expect(result?.reloadPending).toBe(false);
    expect(result?.dirtyVsDisk).toBe(true);
  });

  it("returns undefined when fileId is unknown", async () => {
    const { mediator } = setupHarness();
    expect(await mediator.reloadFile("ghost")).toBeUndefined();
    expect(await mediator.acceptExternalChange("ghost")).toBeUndefined();
    expect(await mediator.discardExternalChange("ghost")).toBeUndefined();
  });
});
