import { describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../../contracts/files/FilesRegistry";
import type { TextEditorApi } from "./TextEditorApi";
import { ViewStateStore } from "./ViewStateStore";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    uri: "file:///test.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    version: 1,
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("ViewStateStore", () => {
  it("prefers runtime over persistent", () => {
    const store = new ViewStateStore();
    const file = makeFile({
      persistentViewState: { "monaco.editor": { cursor: { line: 1 } } }
    });
    const runtime = { cursor: { line: 9 } };
    store.putRuntime(file.fileId, runtime);

    expect(store.resolveForFile(file)).toEqual(runtime);
  });

  it("restores keyed persistent state for clean files", () => {
    const store = new ViewStateStore();
    const persistent = { cursor: { line: 3 } };
    const file = makeFile({
      persistentViewState: { "monaco.editor": persistent }
    });

    expect(store.resolveForFile(file)).toEqual(persistent);
  });

  it("does not restore persistent state for dirty file unless backup restored", () => {
    const store = new ViewStateStore();
    const persistent = { cursor: { line: 3 } };
    const file = makeFile({
      dirtyVsDisk: true,
      persistentViewState: { "monaco.editor": persistent }
    });

    expect(store.resolveForFile(file)).toBeNull();

    store.markBackupRestored(file.fileId);
    expect(store.resolveForFile(file)).toEqual(persistent);
  });

  it("saves captured state to runtime and persistent", () => {
    const store = new ViewStateStore();
    const setEditorState = vi.fn();
    const mockFilesRegistry: FilesRegistry = {
      capabilities: {
        registerCapabilities: vi.fn(),
        hasCapability: vi.fn(() => false),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn()
      },
      openFile: vi.fn(),
      closeFile: vi.fn(),
      getFile: vi.fn(),
      listFiles: vi.fn(),
      updateFile: vi.fn(),
      subscribe: vi.fn(),
      registerMimeResolver: vi.fn(),
      registerEditorResolver: vi.fn(),
      classifyUri: vi.fn(() => "text/plain"),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState,
      markDirty: vi.fn()
    };
    store.setFilesRegistry(mockFilesRegistry);

    const api = {
      getViewState: () => ({ cursor: { line: 42 } })
    } as unknown as TextEditorApi;

    store.captureForFile("file-1", api);

    expect(store.getRuntime("file-1")).toEqual({ cursor: { line: 42 } });
    expect(setEditorState).toHaveBeenCalledWith("file-1", "monaco.editor", { cursor: { line: 42 } });
  });

  it("supports legacy unkeyed persistent bag", () => {
    const store = new ViewStateStore();
    const legacy = { cursor: { line: 13 } };
    const file = makeFile({
      persistentViewState: legacy
    });

    expect(store.resolveForFile(file)).toEqual(legacy);
  });
});
