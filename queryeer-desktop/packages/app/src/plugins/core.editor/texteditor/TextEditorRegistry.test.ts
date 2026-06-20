import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { TextEditorApi } from "./TextEditorApi";
import type { TextDocument } from "./types";
import { setTextEditorContextChain, TextEditorRegistry } from "./TextEditorRegistry";
import { createContextChain } from "../../core.commands/context-chain";
import { ContextPriority } from "../../core.commands/context-priority";
/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "./TextEditorRegistry" {
  interface TextEditorRegistry {
    [key: string]: unknown;
  }
}

const STATE_KEY = "monaco.editor";

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

function makeMockApi() {
  return {
    setModel: vi.fn(),
    setViewState: vi.fn(),
    getViewState: vi.fn().mockReturnValue({ cursor: "state-" }),
    focus: vi.fn()
  } as unknown as TextEditorApi;
}

function makeDocument(uri: string): TextDocument {
  return {
    uri,
    languageId: "sql",
    getText: () => "select 1",
    lineCount: 1,
    lineAt: () => ({ lineNumber: 1, text: "select 1", range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 9 } })
  };
}

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function wireLegacyDefaultInstanceAccessors(registry: TextEditorRegistry): void {
  type DefaultEditorState = {
    activeFileId: string | null;
    editorApi: TextEditorApi | null;
    pendingFileForEditor: FileEntity | null;
  };

  const getDefaultState = (): DefaultEditorState => {
    const instance = registry as unknown as {
      getEditorState: (editorInstanceId?: string) => DefaultEditorState;
    };
    return instance.getEditorState();
  };

  Object.defineProperties(registry as unknown as object, {
    activeFileId: {
      configurable: true,
      enumerable: false,
      get: () => getDefaultState().activeFileId,
      set: (value: string | null) => {
        getDefaultState().activeFileId = value;
      }
    },
    editorApi: {
      configurable: true,
      enumerable: false,
      get: () => getDefaultState().editorApi,
      set: (value: TextEditorApi | null) => {
        getDefaultState().editorApi = value;
      }
    },
    pendingFileForEditor: {
      configurable: true,
      enumerable: false,
      get: () => getDefaultState().pendingFileForEditor,
      set: (value: FileEntity | null) => {
        getDefaultState().pendingFileForEditor = value;
      }
    }
  });
}

describe("TextEditorRegistry view state", () => {
  let registry: TextEditorRegistry;
  let api: TextEditorApi;

  beforeEach(() => {
    registry = new TextEditorRegistry();
    wireLegacyDefaultInstanceAccessors(registry);
    api = makeMockApi();
  });

  describe("openFileAsync when editor not ready queues file for pending restore", () => {
    it("does not call setViewState when editorApi is null, then restores on onEditorReady", async () => {
      const file = makeFile({
        fileId: "file-1",
        persistentViewState: { [STATE_KEY]: { cursor: { line: 7 } } }
      });

      registry["activeFileId"] = null;
      registry["editorApi"] = null;
      registry.setFilesRegistry({ getFile: () => file } as any);

      await registry["openFileAsync"](file);

      expect(api.setViewState).not.toHaveBeenCalled();
      expect(registry["pendingFileForEditor"]).toEqual(file);

      const model = {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      };
      registry["modelsByFileId"].set(file.fileId, model as any);

      registry.onEditorReady(api);

      expect(api.setViewState).toHaveBeenCalledWith(file.persistentViewState?.[STATE_KEY]);
      expect(registry["pendingFileForEditor"]).toBeNull();
    });

    it("does not queue pending file when editorApi is already available", async () => {
      const file = makeFile({
        fileId: "file-1",
        persistentViewState: { [STATE_KEY]: { cursor: { line: 3 } } }
      });

      registry["activeFileId"] = null;
      registry["editorApi"] = api;
      registry.setFilesRegistry({ getFile: () => file } as any);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      await registry["openFileAsync"](file);

      expect(registry["pendingFileForEditor"]).toBeNull();
      expect(api.setViewState).toHaveBeenCalledWith(file.persistentViewState?.[STATE_KEY]);
    });

    it("onEditorReady restores pending file with runtime state priority", async () => {
      const file = makeFile({ fileId: "file-1" });
      const runtimeState = { cursor: { line: 99 } };
      (file as any).persistentViewState = { [STATE_KEY]: { cursor: { line: 1 } } };

      registry["activeFileId"] = null;
      registry["editorApi"] = null;
      registry.setFilesRegistry({ getFile: () => file } as any);
      registry["runtimeViewState"].set(file.fileId, runtimeState);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      await registry["openFileAsync"](file);
      expect(registry["pendingFileForEditor"]).toEqual(file);

      registry.onEditorReady(api);

      expect(api.setViewState).toHaveBeenCalledWith(runtimeState);
    });

    it("pending file is cleared when model is found via modelsByFileId (cold reload path)", async () => {
      const file = makeFile({
        fileId: "file-1",
        persistentViewState: { [STATE_KEY]: { cursor: { line: 7 } } }
      });

      registry["activeFileId"] = null;
      registry["editorApi"] = null;
      registry.setFilesRegistry({ getFile: () => file } as any);

      await registry["openFileAsync"](file);

      expect(registry["pendingFileForEditor"]).toEqual(file);

      const model = {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      };
      registry["modelsByFileId"].set(file.fileId, model as any);

      registry.onEditorReady(api);

      expect(api.setViewState).toHaveBeenCalledWith(file.persistentViewState?.[STATE_KEY]);
      expect(registry["pendingFileForEditor"]).toBeNull();
    });

    it("onEditorDisposed clears pendingFileForEditor", () => {
      const file = makeFile({ fileId: "file-1" });
      registry["activeFileId"] = file.fileId;
      registry["pendingFileForEditor"] = file;

      registry.onEditorDisposed();

      expect(registry["pendingFileForEditor"]).toBeNull();
      expect(registry["activeFileId"]).toBeNull();
    });

    it("onEditorDisposed captures runtime and persistent view state for active file", () => {
      const file = makeFile({ fileId: "file-1" });
      const filesRegistry = {
        setEditorState: vi.fn(),
        getFile: vi.fn()
      };
      registry.setFilesRegistry(filesRegistry as any);
      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = api;

      registry.onEditorDisposed();

      expect(registry["runtimeViewState"].get(file.fileId)).toEqual(api.getViewState());
      expect(filesRegistry.setEditorState).toHaveBeenCalledWith(
        file.fileId,
        STATE_KEY,
        api.getViewState()
      );
    });

    it("onEditorDisposed can clear active editor without overwriting pre-captured runtime state", async () => {
      const file = makeFile({ fileId: "file-1", dirtyVsDisk: true });
      const capturedViewState = { viewState: { scrollTop: 380 }, cursorState: [{ line: 19 }] };
      registry.setFilesRegistry({
        setEditorState: vi.fn(),
        getFile: () => file
      } as any);
      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = null;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.captureActiveViewState(capturedViewState);
      registry.onEditorDisposed();
      registry.onEditorReady(api);
      await registry.openFileAsync(file);

      expect(registry["runtimeViewState"].get(file.fileId)).toEqual(capturedViewState);
      expect(api.setViewState).toHaveBeenCalledWith(capturedViewState);
    });

    it("restores runtime state captured at dispose when reopening same file", async () => {
      const file = makeFile({ fileId: "file-1" });
      const capturedViewState = { viewState: { scrollTop: 280 }, cursorState: [{ line: 11 }] };
      const filesRegistry = {
        setEditorState: vi.fn(),
        getFile: () => file
      };
      registry.setFilesRegistry(filesRegistry as any);
      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = null;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.onEditorDisposed(capturedViewState);
      registry.onEditorReady(api);
      await registry.openFileAsync(file);

      expect(registry["runtimeViewState"].get(file.fileId)).toEqual(capturedViewState);
      expect(api.setViewState).toHaveBeenCalledWith(capturedViewState);
      expect(filesRegistry.setEditorState).toHaveBeenCalledWith(
        file.fileId,
        STATE_KEY,
        capturedViewState
      );
    });

    it("restores dispose-captured runtime state even when file is dirty", async () => {
      const file = makeFile({ fileId: "file-1", dirtyVsDisk: true });
      const capturedViewState = { viewState: { scrollTop: 510 }, cursorState: [{ line: 27 }] };
      registry.setFilesRegistry({
        setEditorState: vi.fn(),
        getFile: () => file
      } as any);
      registry["activeFileId"] = file.fileId;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.onEditorDisposed(capturedViewState);
      registry.onEditorReady(api);
      await registry.openFileAsync(file);

      expect(api.setViewState).toHaveBeenCalledWith(capturedViewState);
    });

    it("does not overwrite existing runtime state with null during dispose", async () => {
      const file = makeFile({ fileId: "file-1", dirtyVsDisk: true });
      const runtimeState = { viewState: { scrollTop: 700 }, cursorState: [{ line: 33 }] };

      registry.setFilesRegistry({
        setEditorState: vi.fn(),
        getFile: () => file
      } as any);
      registry["activeFileId"] = file.fileId;
      registry["runtimeViewState"].set(file.fileId, runtimeState);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.onEditorDisposed(null);
      registry.onEditorReady(api);
      await registry.openFileAsync(file);

      expect(registry["runtimeViewState"].get(file.fileId)).toEqual(runtimeState);
      expect(api.setViewState).toHaveBeenCalledWith(runtimeState);
    });

    it("does not apply stale pre-dispose file state to next file after non-file tab switch", () => {
      const fileA = makeFile({ fileId: "file-a", uri: "file:///a.sql" });
      const fileB = makeFile({ fileId: "file-b", uri: "file:///b.sql" });
      const staleStateForA = { viewState: { scrollTop: 640 }, cursorState: [{ line: 40 }] };

      registry["activeFileId"] = fileA.fileId;
      registry["modelsByFileId"].set(fileA.fileId, {
        getDocument: () => makeDocument(fileA.uri),
        getUri: () => fileA.uri
      } as any);
      registry["modelsByFileId"].set(fileB.fileId, {
        getDocument: () => makeDocument(fileB.uri),
        getUri: () => fileB.uri
      } as any);

      registry.onEditorDisposed(staleStateForA);

      registry.setFilesRegistry({
        getFile: (id: string) => (id === fileB.fileId ? fileB : fileA)
      } as any);

      registry.setActiveFileId(fileB.fileId);
      registry.onEditorReady(api);

      expect(api.setViewState).not.toHaveBeenCalledWith(staleStateForA);
    });
  });

  describe("setActiveFileId", () => {
    it("saves runtime state for previous file before switching", () => {
      const file1 = makeFile({ fileId: "file-1" });
      const file2 = makeFile({ fileId: "file-2" });

      registry["activeFileId"] = file1.fileId;
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file1.fileId, {
        getDocument: () => makeDocument(file1.uri),
        getUri: () => file1.uri
      } as any);
      registry["modelsByFileId"].set(file2.fileId, {
        getDocument: () => makeDocument(file2.uri),
        getUri: () => file2.uri
      } as any);

      registry.setActiveFileId(file2.fileId);

      const savedState = registry["runtimeViewState"].get(file1.fileId);
      expect(savedState).toEqual(api.getViewState());
    });

    it("restores runtime state for new file from session cache", () => {
      const file1 = makeFile({ fileId: "file-1" });
      const file2 = makeFile({ fileId: "file-2" });
      const savedState = { cursor: { line: 10, column: 5 } };

      registry["activeFileId"] = file1.fileId;
      registry["runtimeViewState"].set(file2.fileId, savedState);
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file1.fileId, {
        getDocument: () => makeDocument(file1.uri),
        getUri: () => file1.uri
      } as any);
      registry["modelsByFileId"].set(file2.fileId, {
        getDocument: () => makeDocument(file2.uri),
        getUri: () => file2.uri
      } as any);

      registry.setActiveFileId(file2.fileId);

      expect(api.setViewState).toHaveBeenCalledWith(savedState);
    });

    it("falls back to persistentViewState when no runtime state in setActiveFileId (cold reload path)", () => {
      const file = makeFile({
        fileId: "file-2",
        persistentViewState: { cursor: { line: 42 } }
      });
      const mockFilesRegistry = {
        getFile: () => file,
        setEditorState: vi.fn(),
        getEditorState: vi.fn()
      };

      registry["activeFileId"] = "file-1";
      registry["editorApi"] = api;
      registry.setFilesRegistry(mockFilesRegistry as any);
      registry["modelsByFileId"].set("file-1", {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.setActiveFileId(file.fileId);

      expect(api.setViewState).toHaveBeenCalledWith(file.persistentViewState);
    });

    it("does NOT restore persistentViewState when file is dirtyVsBackend (setActiveFileId)", () => {
      const file = makeFile({
        fileId: "file-2",
        persistentViewState: { cursor: { line: 42 } },
        dirtyVsBackend: true
      });
      const mockFilesRegistry = {
        getFile: () => file,
        setEditorState: vi.fn(),
        getEditorState: vi.fn()
      };

      registry["activeFileId"] = "file-1";
      registry["editorApi"] = api;
      registry.setFilesRegistry(mockFilesRegistry as any);
      registry["modelsByFileId"].set("file-1", {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.setActiveFileId(file.fileId);

      expect(api.setViewState).not.toHaveBeenCalled();
    });

    it("does NOT restore persistentViewState when file is dirtyVsDisk (setActiveFileId)", () => {
      const file = makeFile({
        fileId: "file-2",
        persistentViewState: { cursor: { line: 42 } },
        dirtyVsDisk: true
      });
      const mockFilesRegistry = {
        getFile: () => file,
        setEditorState: vi.fn(),
        getEditorState: vi.fn()
      };

      registry["activeFileId"] = "file-1";
      registry["editorApi"] = api;
      registry.setFilesRegistry(mockFilesRegistry as any);
      registry["modelsByFileId"].set("file-1", {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.setActiveFileId(file.fileId);

      expect(api.setViewState).not.toHaveBeenCalled();
    });

    it("prefers runtime state over persistentViewState in setActiveFileId", () => {
      const file = makeFile({ fileId: "file-2" });
      const runtimeState = { cursor: { line: 99 } };
      (file as any).persistentViewState = { cursor: { line: 1 } };
      const mockFilesRegistry = {
        getFile: () => file,
        setEditorState: vi.fn(),
        getEditorState: vi.fn()
      };

      registry["activeFileId"] = "file-1";
      registry["runtimeViewState"].set(file.fileId, runtimeState);
      registry["editorApi"] = api;
      registry.setFilesRegistry(mockFilesRegistry as any);
      registry["modelsByFileId"].set("file-1", {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.setActiveFileId(file.fileId);

      expect(api.setViewState).toHaveBeenCalledWith(runtimeState);
      expect(api.setViewState).not.toHaveBeenCalledWith(file.persistentViewState);
    });

    it("does NOT save when switching to null (no previous file)", () => {
      const file = makeFile({ fileId: "file-1" });

      registry["activeFileId"] = null;
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.setActiveFileId(file.fileId);

      expect(registry["runtimeViewState"].has(file.fileId)).toBe(false);
    });

    it("does NOT save/restore when switching to same file", () => {
      const file = makeFile({ fileId: "file-1" });

      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.setActiveFileId(file.fileId);

      expect(api.setViewState).not.toHaveBeenCalled();
    });
  });

  describe("applyRecoveredContent", () => {
    it("applies recovered text immediately when model exists", () => {
      const file = makeFile({ fileId: "file-1" });
      const model = {
        setContent: vi.fn(),
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      };
      registry["modelsByFileId"].set(file.fileId, model as any);

      registry.applyRecoveredContent(file.fileId, "recovered content");

      expect(model.setContent).toHaveBeenCalledWith("recovered content");
    });

    it("queues recovered text until model is created", async () => {
      const file = makeFile({ fileId: "file-1" });
      registry.applyRecoveredContent(file.fileId, "queued content");
      registry["editorApi"] = api;

      await registry.openFileAsync(file);

      const model = registry.getModelForFile(file.fileId);
      expect(model?.getContent()).toBe("queued content");
    });

    it("marks file dirty and fires dirty listeners when pending content is consumed", async () => {
      const file = makeFile({ fileId: "file-1" });
      const filesRegistry = {
        markDirty: vi.fn(),
        getFile: vi.fn(() => file),
        setEditorState: vi.fn(),
        getEditorState: vi.fn()
      };
      registry.setFilesRegistry(filesRegistry as any);
      registry.applyRecoveredContent(file.fileId, "queued content");
      registry["editorApi"] = api;

      const dirtyListener = vi.fn();
      registry.onContentDirty(dirtyListener);

      await registry.openFileAsync(file);

      expect(filesRegistry.markDirty).toHaveBeenCalledWith(file.fileId);
      expect(dirtyListener).toHaveBeenCalledWith(file.fileId, "queued content");
    });
  });

  describe("markDirty", () => {
    it("syncs active model content from editor before tab switch", () => {
      const file = makeFile({ fileId: "file-1", uri: "file:///backup.sql" });
      const model = {
        setContent: vi.fn(),
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      };
      const filesRegistry = {
        markDirty: vi.fn(),
        getFile: vi.fn(() => file),
        setEditorState: vi.fn(),
        getEditorState: vi.fn()
      };
      registry.setFilesRegistry(filesRegistry as any);
      registry["modelsByFileId"].set(file.fileId, model as any);
      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = {
        ...api,
        getContent: vi.fn(() => "edited from monaco")
      } as any;

      registry.markDirty(file.fileId);

      expect(filesRegistry.markDirty).toHaveBeenCalledWith(file.fileId);
      expect(model.setContent).toHaveBeenCalledWith("edited from monaco");
    });
  });

  describe("onEditorReady", () => {
    it("restores runtime state from session cache when editor ready", () => {
      const file = makeFile({ fileId: "file-1" });
      const savedState = { scrollTop: 100, cursor: { line: 3 } };

      registry["activeFileId"] = file.fileId;
      registry["runtimeViewState"].set(file.fileId, savedState);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.onEditorReady(api);

      expect(api.setViewState).toHaveBeenCalledWith(savedState);
    });

    it("falls back to persistentViewState on cold reload when no runtime state", () => {
      const file = makeFile({
        fileId: "file-1",
        persistentViewState: { [STATE_KEY]: { cursor: { line: 42 }, scrollTop: 200 } }
      });
      registry.setFilesRegistry({ getFile: () => file } as any);

      registry["activeFileId"] = file.fileId;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.onEditorReady(api);

      expect(api.setViewState).toHaveBeenCalledWith(file.persistentViewState?.[STATE_KEY]);
      expect(api.setViewState).toHaveBeenCalledTimes(1);
    });

    it("prefers runtime state over persistentViewState", () => {
      const file = makeFile({ fileId: "file-1" });
      const runtimeState = { cursor: { line: 7 } };
      const persistentState = { cursor: { line: 99 } };
      (file as any).persistentViewState = { [STATE_KEY]: persistentState };

      registry["activeFileId"] = file.fileId;
      registry["runtimeViewState"].set(file.fileId, runtimeState);
      registry.setFilesRegistry({ getFile: () => file } as any);
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      registry.onEditorReady(api);

      expect(api.setViewState).toHaveBeenCalledWith(runtimeState);
      expect(api.setViewState).not.toHaveBeenCalledWith(persistentState);
    });

    it("does nothing when no active file", () => {
      registry["activeFileId"] = null;

      registry.onEditorReady(api);

      expect(api.setModel).not.toHaveBeenCalled();
      expect(api.setViewState).not.toHaveBeenCalled();
    });
  });

  describe("dirty file scenario: after edit, switching tabs should not restore stale state", () => {
    it("dirtyVsBackend file does not restore persistentViewState on openFileAsync", async () => {
      const file = makeFile({
        fileId: "file-1",
        persistentViewState: { [STATE_KEY]: { cursor: { line: 1 } } },
        dirtyVsBackend: true
      });

      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      await registry["openFileAsync"](file);

      expect(api.setViewState).not.toHaveBeenCalled();
    });

    it("restores persistentViewState for dirty file when backup content was recovered", async () => {
      const file = makeFile({
        fileId: "file-1",
        persistentViewState: { [STATE_KEY]: { cursor: { line: 44 } } },
        dirtyVsDisk: true
      });
      registry.setFilesRegistry({ getFile: () => file, markDirty: vi.fn() } as any);

      registry.applyRecoveredContent(file.fileId, "recovered");
      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      await registry["openFileAsync"](file);

      expect(api.setViewState).toHaveBeenCalledWith({ cursor: { line: 44 } });
    });

    it("dirtyVsBackend file with runtime state restores session cursor", async () => {
      const file = makeFile({ fileId: "file-1", dirtyVsBackend: true });
      const runtimeState = { cursor: { line: 7 } };

      registry["activeFileId"] = "file-prev";
      registry["runtimeViewState"].set(file.fileId, runtimeState);
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      await registry["openFileAsync"](file);

      expect(api.setViewState).toHaveBeenCalledWith(runtimeState);
    });

    it("runtimeViewState is separate from persistentViewState (filesRegistry)", async () => {
      const file = makeFile({
        fileId: "file-1",
        persistentViewState: { [STATE_KEY]: { cursor: { line: 99 } } }
      });
      registry.setFilesRegistry({} as any);

      registry["activeFileId"] = file.fileId;
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file.fileId, {
        getDocument: () => makeDocument(file.uri),
        getUri: () => file.uri
      } as any);

      await registry["openFileAsync"](file);

      expect(api.setViewState).toHaveBeenCalledWith({ cursor: { line: 99 } });
      expect(registry["runtimeViewState"].has(file.fileId)).toBe(false);
    });

    it("setActiveFileId saves to runtimeViewState AND to filesRegistry (persistent)", () => {
      const file1 = makeFile({ fileId: "file-1" });
      const file2 = makeFile({ fileId: "file-2" });
      const mockFilesRegistry = {
        setEditorState: vi.fn(),
        getEditorState: vi.fn(),
        getFile: vi.fn()
      };
      registry.setFilesRegistry(mockFilesRegistry as any);

      registry["activeFileId"] = file1.fileId;
      registry["editorApi"] = api;
      registry["modelsByFileId"].set(file1.fileId, {
        getDocument: () => makeDocument(file1.uri),
        getUri: () => file1.uri
      } as any);
      registry["modelsByFileId"].set(file2.fileId, {
        getDocument: () => makeDocument(file2.uri),
        getUri: () => file2.uri
      } as any);

      registry.setActiveFileId(file2.fileId);

      expect(mockFilesRegistry.setEditorState).toHaveBeenCalledWith(
        file1.fileId,
        STATE_KEY,
        api.getViewState()
      );
      expect(registry["runtimeViewState"].has(file1.fileId)).toBe(true);
    });
  });
});

describe("TextEditorRegistry editor focus context", () => {
  it("publishes the focused editor file and group into the context chain", () => {
    const registry = new TextEditorRegistry();
    const chain = createContextChain();
    const file = makeFile({ fileId: "focused-file", uri: "file:///focused.sql" });
    let focusListener: (() => void) | undefined;
    const api = {
      setModel: vi.fn(),
      setViewState: vi.fn(),
      focus: vi.fn(),
      getModel: vi.fn(() => ({ languageId: "sql" })),
      getSelection: vi.fn(() => null),
      getSelectedText: vi.fn(() => ""),
      onDidFocusEditorText: vi.fn((callback: () => void) => {
        focusListener = callback;
        return { dispose: vi.fn() };
      }),
      onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFocusEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() }))
    } as unknown as TextEditorApi;

    registry.setFilesRegistry({
      getFile: (fileId: string) => fileId === file.fileId ? file : undefined,
      capabilities: { hasCapability: vi.fn(() => true) }
    } as any);
    setTextEditorContextChain(chain);
    registry.openFile(file, "editor-group-2:core.editor.text");
    registry.onEditorReady(api, "editor-group-2:core.editor.text");

    focusListener?.();

    expect(chain.getEffectiveContext()).toMatchObject({
      activeFileId: "focused-file",
      activeEditorGroupId: "editor-group-2",
      hasActiveFile: true,
      hasActiveQueryExecutableFile: true
    });
  });

  it("refreshes focused editor active file metadata when the files registry changes", () => {
    const registry = new TextEditorRegistry();
    const chain = createContextChain();
    let file = makeFile({ fileId: "focused-file", uri: "file:///focused.sql", metadata: {} });
    let focusListener: (() => void) | undefined;
    let filesListener: ((files: FileEntity[]) => void) | undefined;
    const api = {
      setModel: vi.fn(),
      setViewState: vi.fn(),
      focus: vi.fn(),
      getModel: vi.fn(() => ({ languageId: "sql" })),
      getSelection: vi.fn(() => null),
      getSelectedText: vi.fn(() => ""),
      onDidFocusEditorText: vi.fn((callback: () => void) => {
        focusListener = callback;
        return { dispose: vi.fn() };
      }),
      onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFocusEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() }))
    } as unknown as TextEditorApi;

    registry.setFilesRegistry({
      getFile: (fileId: string) => fileId === file.fileId ? file : undefined,
      capabilities: { hasCapability: vi.fn(() => true) },
      subscribe: vi.fn((callback: (files: FileEntity[]) => void) => {
        filesListener = callback;
        callback([file]);
        return vi.fn();
      })
    } as any);
    setTextEditorContextChain(chain);
    registry.openFile(file, "editor-group-2:core.editor.text");
    registry.onEditorReady(api, "editor-group-2:core.editor.text");
    focusListener?.();

    expect(chain.getEffectiveContext()).toMatchObject({
      activeFile: {
        metadata: {}
      }
    });

    file = makeFile({
      fileId: "focused-file",
      uri: "file:///focused.sql",
      metadata: { "core.queryengine.hasRunningQuery": true }
    });
    filesListener?.([file]);

    expect(chain.getEffectiveContext()).toMatchObject({
      activeFile: {
        metadata: {
          core: {
            queryengine: {
              hasRunningQuery: true
            }
          }
        }
      }
    });
  });

  it("does not let a blurred editor scope override the shell active file context", () => {
    const registry = new TextEditorRegistry();
    const chain = createContextChain();
    const editorFile = makeFile({ fileId: "editor-file", uri: "file:///editor.sql" });
    const shellFile = makeFile({ fileId: "shell-file", uri: "file:///shell.sql" });
    let focusListener: (() => void) | undefined;
    let blurListener: (() => void) | undefined;
    const api = {
      setModel: vi.fn(),
      setViewState: vi.fn(),
      focus: vi.fn(),
      getModel: vi.fn(() => ({ languageId: "sql" })),
      getSelection: vi.fn(() => null),
      getSelectedText: vi.fn(() => ""),
      onDidFocusEditorText: vi.fn((callback: () => void) => {
        focusListener = callback;
        return { dispose: vi.fn() };
      }),
      onDidBlurEditorText: vi.fn((callback: () => void) => {
        blurListener = callback;
        return { dispose: vi.fn() };
      }),
      onDidFocusEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() }))
    } as unknown as TextEditorApi;

    registry.setFilesRegistry({
      getFile: (fileId: string) => fileId === editorFile.fileId ? editorFile : undefined,
      capabilities: { hasCapability: vi.fn(() => true) }
    } as any);
    chain.register({
      id: "shell-active-file",
      priority: ContextPriority.ACTIVE_FILE,
      context: {
        activeFileId: shellFile.fileId,
        hasActiveFile: true,
        activeFile: shellFile
      }
    });
    setTextEditorContextChain(chain);
    registry.openFile(editorFile, "editor-group-2:core.editor.text");
    registry.onEditorReady(api, "editor-group-2:core.editor.text");

    expect(chain.getEffectiveContext()).toMatchObject({ activeFileId: "shell-file" });

    focusListener?.();

    expect(chain.getEffectiveContext()).toMatchObject({ activeFileId: "editor-file" });

    blurListener?.();

    expect(chain.getEffectiveContext()).toMatchObject({ activeFileId: "shell-file" });
  });

  it("does not publish context changes for collapsed cursor movement", () => {
    const registry = new TextEditorRegistry();
    const chain = createContextChain();
    const listener = vi.fn();
    let selectionListener: (() => void) | undefined;
    const api = {
      getModel: vi.fn(() => ({ languageId: "sql" })),
      getSelection: vi.fn(() => ({
        selectionStartLineNumber: 1,
        selectionStartColumn: 1,
        positionLineNumber: 1,
        positionColumn: 1
      })),
      getSelectedText: vi.fn(() => ""),
      onDidFocusEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFocusEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidBlurEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeCursorSelection: vi.fn((callback: () => void) => {
        selectionListener = callback;
        return { dispose: vi.fn() };
      })
    } as unknown as TextEditorApi;

    setTextEditorContextChain(chain);
    registry.onEditorReady(api);
    chain.onDidChange(listener);

    selectionListener?.();
    selectionListener?.();

    expect(api.getSelectedText).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("TextEditorRegistry editor instances", () => {
  let registry: TextEditorRegistry;

  beforeEach(() => {
    registry = new TextEditorRegistry();
    wireLegacyDefaultInstanceAccessors(registry);
  });

  it("tracks active files independently per editor instance", async () => {
    const leftFile = makeFile({ fileId: "file-left", uri: "file:///left.sql" });
    const rightFile = makeFile({ fileId: "file-right", uri: "file:///right.sql" });
    const filesById = new Map<string, FileEntity>([
      [leftFile.fileId, leftFile],
      [rightFile.fileId, rightFile]
    ]);
    registry.setFilesRegistry({
      getFile: (fileId: string) => filesById.get(fileId)
    } as any);

    await registry.openFileAsync(leftFile, "left-instance");
    await registry.openFileAsync(rightFile, "right-instance");

    expect(registry.getActiveFile("left-instance")?.fileId).toBe(leftFile.fileId);
    expect(registry.getActiveFile("right-instance")?.fileId).toBe(rightFile.fileId);
  });

  it("keeps recovered untitled content when split instances open concurrently", async () => {
    const file = makeFile({
      fileId: "file-1",
      uri: "untitled:Untitled1.sql",
      dirtyVsDisk: true
    });
    const filesRegistry = {
      markDirty: vi.fn(),
      getFile: vi.fn(() => file),
      setEditorState: vi.fn(),
      getEditorState: vi.fn()
    };
    registry.setFilesRegistry(filesRegistry as any);

    registry.applyRecoveredContent(file.fileId, "recovered content");

    const readResult1 = createDeferred<{ success: boolean; content: string }>();
    const readResult2 = createDeferred<{ success: boolean; content: string }>();
    const readFile = vi
      .fn()
      .mockReturnValueOnce(readResult1.promise)
      .mockReturnValueOnce(readResult2.promise);

    const appShellTarget = window as unknown as {
      appShell?: Record<string, unknown>;
    };
    const previousAppShell = appShellTarget.appShell;

    appShellTarget.appShell = {
      ...(previousAppShell ?? {}),
      readFile,
      showDialogMessage: vi.fn(async () => ({ action: "" }))
    };

    try {
      const leftOpen = registry.openFileAsync(file, "left-instance");
      const rightOpen = registry.openFileAsync(file, "right-instance");

      readResult1.resolve({ success: true, content: "" });
      await Promise.resolve();
      readResult2.resolve({ success: true, content: "" });

      await Promise.all([leftOpen, rightOpen]);
    } finally {
      if (previousAppShell) {
        appShellTarget.appShell = previousAppShell;
      } else {
        delete appShellTarget.appShell;
      }
    }

    expect(registry.getModelForFile(file.fileId)?.getContent()).toBe("recovered content");
    expect(filesRegistry.markDirty).toHaveBeenCalledWith(file.fileId);
  });

  it("markDirty reads content from the targeted editor instance", async () => {
    const file = makeFile({ fileId: "file-1", uri: "file:///split.sql" });
    const filesRegistry = {
      markDirty: vi.fn(),
      getFile: vi.fn(() => file),
      setEditorState: vi.fn(),
      getEditorState: vi.fn()
    };
    registry.setFilesRegistry(filesRegistry as any);

    await registry.openFileAsync(file, "left-instance");
    await registry.openFileAsync(file, "right-instance");

    const leftApi = {
      ...makeMockApi(),
      getModel: vi.fn(() => makeDocument(file.uri)),
      getContent: vi.fn(() => "left-content")
    } as unknown as TextEditorApi;
    const rightApi = {
      ...makeMockApi(),
      getModel: vi.fn(() => makeDocument(file.uri)),
      getContent: vi.fn(() => "right-content")
    } as unknown as TextEditorApi;

    registry.onEditorReady(leftApi, "left-instance");
    registry.onEditorReady(rightApi, "right-instance");

    const dirtyListener = vi.fn();
    registry.onContentDirty(dirtyListener);

    registry.markDirty(file.fileId, "right-instance");

    expect((rightApi as unknown as { getContent: ReturnType<typeof vi.fn> }).getContent).toHaveBeenCalled();
    expect((leftApi as unknown as { getContent: ReturnType<typeof vi.fn> }).getContent).not.toHaveBeenCalled();
    expect(registry.getModelForFile(file.fileId)?.getContent()).toBe("right-content");
    expect(filesRegistry.markDirty).toHaveBeenCalledWith(file.fileId);
    expect(dirtyListener).toHaveBeenCalledWith(file.fileId, "right-content");
  });

  it("applies runtime view state to all active instances for the same file", async () => {
    const file = makeFile({ fileId: "file-1", uri: "file:///shared.sql" });
    registry.setFilesRegistry({ getFile: () => file } as any);

    await registry.openFileAsync(file, "left-instance");
    await registry.openFileAsync(file, "right-instance");

    const leftApi = {
      ...makeMockApi(),
      getModel: vi.fn(() => makeDocument(file.uri))
    } as unknown as TextEditorApi;
    const rightApi = {
      ...makeMockApi(),
      getModel: vi.fn(() => makeDocument(file.uri))
    } as unknown as TextEditorApi;

    registry.onEditorReady(leftApi, "left-instance");
    registry.onEditorReady(rightApi, "right-instance");

    const runtimeState = { cursor: { line: 12, column: 4 } };
    registry.applyRuntimeViewState(file.fileId, runtimeState);

    expect((leftApi as unknown as { setViewState: ReturnType<typeof vi.fn> }).setViewState).toHaveBeenCalledWith(runtimeState);
    expect((rightApi as unknown as { setViewState: ReturnType<typeof vi.fn> }).setViewState).toHaveBeenCalledWith(runtimeState);
  });

  it("disposing one instance keeps other instances active", async () => {
    const file = makeFile({ fileId: "file-1", uri: "file:///shared.sql" });
    registry.setFilesRegistry({
      getFile: () => file,
      setEditorState: vi.fn(),
      getEditorState: vi.fn()
    } as any);

    await registry.openFileAsync(file, "left-instance");
    await registry.openFileAsync(file, "right-instance");

    const leftApi = {
      ...makeMockApi(),
      getModel: vi.fn(() => makeDocument(file.uri))
    } as unknown as TextEditorApi;
    const rightApi = {
      ...makeMockApi(),
      getModel: vi.fn(() => makeDocument(file.uri))
    } as unknown as TextEditorApi;

    registry.onEditorReady(leftApi, "left-instance");
    registry.onEditorReady(rightApi, "right-instance");

    registry.onEditorDisposed(undefined, "left-instance");

    expect(registry.getActiveEditor("left-instance")).toBeNull();
    expect(registry.getActiveEditor("right-instance")).toBe(rightApi);
    expect(registry.getActiveFile("right-instance")?.fileId).toBe(file.fileId);
  });
});
