import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileEntity } from "../../../contracts/files/FileEntity";
import type { TextEditorApi } from "./TextEditorApi";
import type { TextDocument } from "./types";
import { TextEditorRegistry } from "./TextEditorRegistry";
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATE_KEY = "monaco.editor";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    uri: "file:///test.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
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

describe("TextEditorRegistry view state", () => {
  let registry: TextEditorRegistry;
  let api: TextEditorApi;

  beforeEach(() => {
    registry = new TextEditorRegistry();
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

  describe("notifyChanged", () => {
    it("forwards content updates to FileMediator.notifyChanged", () => {
      const notifyChanged = vi.fn();
      registry.setFileMediator({ notifyChanged } as any);

      registry.notifyChanged("file-1", "select 1");

      expect(notifyChanged).toHaveBeenCalledWith("file-1", "select 1");
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
      registry.setFilesRegistry({ getFile: () => file } as any);

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
