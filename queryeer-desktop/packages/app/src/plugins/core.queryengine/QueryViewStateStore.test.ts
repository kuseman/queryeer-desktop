import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import { getQueryViewStateStore, QUERY_VIEW_STATE_KEY } from "./QueryViewStateStore";

const filesById = new Map<string, FileEntity>();

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  const file: FileEntity = {
    fileId: "file-1",
    uri: "file:///q.sql",
    mimeType: "application/sql",
    version: 1,
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
  filesById.set(file.fileId, file);
  return file;
}

function createFilesRegistry(): FilesRegistry {
  return {
    getFile: (fileId: string) => filesById.get(fileId),
    updateFile: (fileId: string, update: Partial<FileEntity>) => {
      const file = filesById.get(fileId);
      if (!file) {
        return undefined;
      }
      const next = { ...file, ...update };
      filesById.set(fileId, next);
      return next;
    },
    listFiles: () => [...filesById.values()],
    openFile: vi.fn(),
    closeFile: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    registerMimeResolver: vi.fn(),
    registerEditorResolver: vi.fn(),
    classifyUri: vi.fn(),
    resolveEditor: vi.fn(),
    getEditorState: vi.fn(),
    setEditorState: vi.fn(),
    markDirty: vi.fn(),
    capabilities: {
      registerCapabilities: vi.fn(),
      registerLabel: vi.fn(),
      registerPreferredNewFileMimeType: vi.fn(),
      listPreferredNewFileMimeTypes: vi.fn(() => []),
      getLabel: vi.fn(),
      hasCapability: vi.fn(() => true),
      listMimeTypesByCapability: vi.fn(() => []),
      listAllMimeTypes: vi.fn(() => []),
      registerContentCategory: vi.fn(),
      getContentCategory: vi.fn()
    },
    mimeIcons: {
      registerMimeIcon: vi.fn(),
      getMimeIcon: vi.fn(),
      listMimeIcons: vi.fn(() => [])
    }
  } as unknown as FilesRegistry;
}

describe("QueryViewStateStore", () => {
  beforeEach(() => {
    filesById.clear();
    getQueryViewStateStore().evict("file-1", "session-a");
    getQueryViewStateStore().evict("file-1", "session-b");
    getQueryViewStateStore().initialize(createFilesRegistry());
  });

  it("persists independent state for multiple output sessions of the same file", () => {
    makeFile();

    getQueryViewStateStore().setSelectedOutput("file-1", "session-a", "core.queryengine.output.text");
    getQueryViewStateStore().setEditorSplitPercent("file-1", "session-a", 35);
    getQueryViewStateStore().setTextOutputFormat("file-1", "session-b", "json");

    const persisted = filesById.get("file-1")?.persistentViewState?.[QUERY_VIEW_STATE_KEY] as {
      version: number;
      sessions: Record<string, unknown>;
    };
    expect(persisted.version).toBe(2);
    expect(persisted.sessions["session-a"]).toMatchObject({
      executionTargetOutputId: "core.queryengine.output.text",
      editorSplitPercent: 35
    });
    expect(persisted.sessions["session-b"]).toMatchObject({
      textOutputFormat: "json"
    });

    getQueryViewStateStore().evict("file-1", "session-a");
    getQueryViewStateStore().evict("file-1", "session-b");

    expect(getQueryViewStateStore().read("file-1", "session-a").executionTargetOutputId).toBe("core.queryengine.output.text");
    expect(getQueryViewStateStore().read("file-1", "session-a").editorSplitPercent).toBe(35);
    expect(getQueryViewStateStore().read("file-1", "session-b").textOutputFormat).toBe("json");
  });

  it("reads legacy flat state as a fallback for any session", () => {
    makeFile({
      persistentViewState: {
        [QUERY_VIEW_STATE_KEY]: {
          executionTargetOutputId: "core.queryengine.output.text",
          textOutputFormat: "csv"
        }
      }
    });

    const state = getQueryViewStateStore().read("file-1", "session-a");

    expect(state.executionTargetOutputId).toBe("core.queryengine.output.text");
    expect(state.textOutputFormat).toBe("csv");
  });
});
