import { describe, expect, it, vi } from "vitest";
import type { LayoutEditorContribution } from "../../contracts/extensions/LayoutExtension";
import { FileRegistry } from "./FileRegistry";
import {
  createFileMediator,
  type FileBackendSync
} from "./FileMediator";

function makeEditor(
  id: string,
  supportedMimeTypes?: string[],
  overrides?: Partial<
    Pick<
      LayoutEditorContribution,
      "openIntents" | "priority" | "order" | "supportedContentCategories" | "requiredCapabilities"
    >
  >
): LayoutEditorContribution {
  return { id, title: id, supportedMimeTypes, ...overrides, render: () => null };
}

type Harness = {
  registry: FileRegistry;
  sync: Required<FileBackendSync>;
  writeFile: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  resolveFileContent: ReturnType<typeof vi.fn>;
  showSaveDialog: ReturnType<typeof vi.fn>;
  mediator: ReturnType<typeof createFileMediator>;
};

function setupHarness(options?: {
  editors?: LayoutEditorContribution[];
  changeDebounceMs?: number;
}): Harness {
  const registry = new FileRegistry({
    getEditors: () => options?.editors ?? []
  });
  const filesRegistry = registry.createFilesRegistry();
  const sync: Required<FileBackendSync> = {
    openFile: vi.fn(async () => {}),
    closeFile: vi.fn(async () => {}),
    changeFile: vi.fn(async () => {})
  };
  const writeFile = vi.fn(async () => ({ success: true }));
  const readFile = vi.fn(async () => ({ success: true, content: "" }));
  const resolveFileContent = vi.fn(() => "resolved-content");
  const showSaveDialog = vi.fn();
  const mediator = createFileMediator({
    filesRegistry,
    backendSync: sync,
    writeFile,
    readFile,
    resolveFileContent,
    changeDebounceMs: options?.changeDebounceMs ?? 50,
    showSaveDialog
  });
  return { registry, sync, writeFile, readFile, resolveFileContent, showSaveDialog, mediator };
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

  it("passes openIntent into editor resolution", async () => {
    const editors = [
      makeEditor("editor.viewer", ["text/plain"], { openIntents: ["view"] }),
      makeEditor("editor.editor", ["text/plain"], { openIntents: ["edit"] })
    ];
    const { mediator } = setupHarness({ editors });

    const viewFile = await mediator.openFile("file:///intent-view.txt", {
      mimeType: "text/plain",
      openIntent: "view"
    });
    const editFile = await mediator.openFile("file:///intent-edit.txt", {
      mimeType: "text/plain",
      openIntent: "edit"
    });

    expect(viewFile.editorId).toBe("editor.viewer");
    expect(editFile.editorId).toBe("editor.editor");
  });

  it("re-resolves stale hinted editor id from workspace state", async () => {
    const editors = [
      makeEditor("core.queryengine.editor", undefined, {
        requiredCapabilities: ["queryexecutable"],
        supportedContentCategories: ["text"],
        priority: 500
      }),
      makeEditor("core.editor.text", ["application/sql"], { priority: 100 })
    ];
    const { mediator } = setupHarness({ editors });

    const file = await mediator.openFile("file:///legacy.sql", {
      mimeType: "application/sql",
      editorId: "core.queryengine.editor"
    });

    expect(file.editorId).toBe("core.editor.text");
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

describe("FileMediator active file", () => {
  it("tracks active file when set and clear", async () => {
    const { mediator } = setupHarness();
    const file = await mediator.openFile("file:///active.sql", {
      mimeType: "application/sql"
    });

    expect(mediator.getActiveFileId()).toBe(file.fileId);

    mediator.setActiveFileId("manual-id");
    expect(mediator.getActiveFileId()).toBe("manual-id");

    mediator.setActiveFileId(null);
    expect(mediator.getActiveFileId()).toBeNull();
  });
});

describe("FileMediator.onActiveFileChanged", () => {
  it("notifies when setActiveFileId changes the value", () => {
    const { mediator } = setupHarness();
    const listener = vi.fn();
    mediator.onActiveFileChanged(listener);

    mediator.setActiveFileId("file-a");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("file-a");

    mediator.setActiveFileId(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(null);
  });

  it("does not notify when setActiveFileId is called with the same value", () => {
    const { mediator } = setupHarness();
    const listener = vi.fn();
    mediator.onActiveFileChanged(listener);

    mediator.setActiveFileId("file-a");
    mediator.setActiveFileId("file-a");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies when openFile returns an already-open file and updates activeFileId", async () => {
    const editors = [makeEditor("editor.any", ["text/plain"])];
    const { mediator } = setupHarness({ editors });
    const listener = vi.fn();

    const first = await mediator.openFile("untitled:x", { mimeType: "text/plain" });
    mediator.onActiveFileChanged(listener);

    // Switch away so the file is no longer active
    mediator.setActiveFileId("other-id");
    listener.mockClear();

    // Re-opening the same URI should make it active again
    const second = await mediator.openFile("untitled:x", { mimeType: "text/plain" });

    expect(second.fileId).toBe(first.fileId);
    expect(mediator.getActiveFileId()).toBe(first.fileId);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(first.fileId);
  });

  it("does not notify when openFile returns an already-open file that is already active", async () => {
    const editors = [makeEditor("editor.any", ["text/plain"])];
    const { mediator } = setupHarness({ editors });

    await mediator.openFile("untitled:x", { mimeType: "text/plain" });

    const listener = vi.fn();
    mediator.onActiveFileChanged(listener);

    await mediator.openFile("untitled:x", { mimeType: "text/plain" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops future notifications", () => {
    const { mediator } = setupHarness();
    const listener = vi.fn();
    const unsub = mediator.onActiveFileChanged(listener);

    unsub();
    mediator.setActiveFileId("file-a");

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("FileMediator.saveFile", () => {
  it("writes content via resolveFileContent for file:// uris", async () => {
    const { mediator, registry, resolveFileContent, writeFile } = setupHarness();
    const file = await mediator.openFile("file:///x.sql", {
      mimeType: "application/sql"
    });

    await mediator.saveFile(file.fileId);

    expect(resolveFileContent).toHaveBeenCalledWith(file.fileId, "file:///x.sql");
    expect(writeFile).toHaveBeenCalledWith("file:///x.sql", "resolved-content");
    const updated = registry.createFilesRegistry().getFile(file.fileId);
    expect(updated?.dirtyVsDisk).toBe(false);
  });

  it("uses resolveFileContent when there is no pending text", async () => {
    const { mediator, resolveFileContent, writeFile } = setupHarness();
    const file = await mediator.openFile("file:///y.sql", {
      mimeType: "application/sql"
    });

    await mediator.saveFile(file.fileId);

    expect(resolveFileContent).toHaveBeenCalledWith(file.fileId, "file:///y.sql");
    expect(writeFile).toHaveBeenCalledWith("file:///y.sql", "resolved-content");
  });

  it("shows save dialog for untitled files and converts uri on save", async () => {
    const { mediator, registry, writeFile, showSaveDialog } = setupHarness();
    const file = await mediator.openFile("untitled:Query1.sql", {
      mimeType: "application/sql"
    });

    showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: "C:\\Users\\test\\Query1.sql"
    });

    await mediator.saveFile(file.fileId);

    expect(showSaveDialog).toHaveBeenCalledWith({
      title: "Save Query",
      defaultPath: "Query1.sql",
      filters: [{ name: "SQL Files", extensions: ["sql"] }]
    });
    expect(writeFile).toHaveBeenCalledWith(
      "file:///C:/Users/test/Query1.sql",
      "resolved-content"
    );
    const updated = registry.createFilesRegistry().getFile(file.fileId);
    expect(updated?.uri).toBe("file:///C:/Users/test/Query1.sql");
    expect(updated?.dirtyVsDisk).toBe(false);
  });

  it("handles unix paths in save dialog", async () => {
    const { mediator, registry, writeFile, showSaveDialog } = setupHarness();
    const file = await mediator.openFile("untitled:Query.sql", {
      mimeType: "application/sql"
    });

    showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: "/home/user/Query.sql"
    });

    await mediator.saveFile(file.fileId);

    expect(writeFile).toHaveBeenCalledWith(
      "file:///home/user/Query.sql",
      "resolved-content"
    );
    const updated = registry.createFilesRegistry().getFile(file.fileId);
    expect(updated?.uri).toBe("file:///home/user/Query.sql");
  });

  it("cancels save-as when dialog is canceled", async () => {
    const { mediator, writeFile, showSaveDialog } = setupHarness();
    const file = await mediator.openFile("untitled:MyQuery.sql", {
      mimeType: "application/sql"
    });

    showSaveDialog.mockResolvedValueOnce({ canceled: true });

    await mediator.saveFile(file.fileId);

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does nothing for untitled when showSaveDialog not provided", async () => {
    const registry = new FileRegistry({ getEditors: () => [] });
    const filesRegistry = registry.createFilesRegistry();
    const writeFile = vi.fn(async () => ({ success: true }));
    const mediator = createFileMediator({
      filesRegistry,
      writeFile
    });
    const file = await mediator.openFile("untitled:orphan", {
      mimeType: "application/sql"
    });

    await mediator.saveFile(file.fileId);

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does nothing for unknown URI schemes", async () => {
    const { mediator, writeFile } = setupHarness();
    const file = await mediator.openFile("app-data://config", {
      mimeType: "application/json"
    });

    await mediator.saveFile(file.fileId);

    expect(writeFile).not.toHaveBeenCalled();
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
  });

  it("does not call openFile on rebind (backend auto-upserts)", async () => {
    const { mediator, sync } = setupHarness();
    const file = await mediator.openFile("untitled:r", {
      mimeType: "text/plain",
      engineBinding: { engineId: "payloadbuilder" }
    });

    await mediator.bindEngine(file.fileId, "payloadbuilder", "conn-2");

    expect(sync.openFile).toHaveBeenCalledTimes(1);
  });
});

describe("FileMediator.reloadFile / acceptExternalChange / discardExternalChange", () => {
it("reloadFile resets diskState and dirtyVsDisk", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///rc.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk",
      dirtyVsDisk: true
    });

    const result = await mediator.reloadFile(file.fileId);

    expect(result?.diskState).toBe("inSync");
    expect(result?.dirtyVsDisk).toBe(false);
  });

  it("reloadFile resets deletedOnDisk to inSync", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///del.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      diskState: "deletedOnDisk",
      dirtyVsDisk: true
    });

    const result = await mediator.reloadFile(file.fileId);

    expect(result?.diskState).toBe("inSync");
    expect(result?.dirtyVsDisk).toBe(false);
  });

  it("reloadFile calls readFile when provided", async () => {
    const { mediator, readFile, registry } = setupHarness();
    const file = await mediator.openFile("file:///rc2.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk"
    });

    await mediator.reloadFile(file.fileId);

    expect(readFile).toHaveBeenCalledWith(file.uri);
  });

  it("acceptExternalChange clears diskState and dirtyVsDisk", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk",
      dirtyVsDisk: true
    });

    const result = await mediator.acceptExternalChange(file.fileId);

    expect(result?.diskState).toBe("inSync");
    expect(result?.dirtyVsDisk).toBe(false);
  });

  it("discardExternalChange clears diskState and keeps local dirty", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///d.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk"
    });

    const result = await mediator.discardExternalChange(file.fileId);

    expect(result?.diskState).toBe("inSync");
    expect(result?.dirtyVsDisk).toBe(true);
  });

  it("acceptExternalChange clears deletedOnDisk", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///del2.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      diskState: "deletedOnDisk",
      dirtyVsDisk: true
    });

    const result = await mediator.acceptExternalChange(file.fileId);

    expect(result?.diskState).toBe("inSync");
    expect(result?.dirtyVsDisk).toBe(false);
  });

  it("discardExternalChange clears deletedOnDisk and marks local dirty", async () => {
    const { mediator, registry } = setupHarness();
    const file = await mediator.openFile("file:///del3.txt", { mimeType: "text/plain" });
    registry.createFilesRegistry().updateFile(file.fileId, {
      diskState: "deletedOnDisk"
    });

    const result = await mediator.discardExternalChange(file.fileId);

    expect(result?.diskState).toBe("inSync");
    expect(result?.dirtyVsDisk).toBe(true);
  });

  it("returns undefined when fileId is unknown", async () => {
    const { mediator } = setupHarness();
    expect(await mediator.reloadFile("ghost")).toBeUndefined();
    expect(await mediator.acceptExternalChange("ghost")).toBeUndefined();
    expect(await mediator.discardExternalChange("ghost")).toBeUndefined();
  });
});
