import { describe, expect, it, vi } from "vitest";
import { ExplorerStore } from "./store";

describe("ExplorerStore", () => {
  it("does not emit when marking a file with its current open state", () => {
    const store = new ExplorerStore();
    store.replaceFolders([{ uri: "file:///workspace", name: "workspace", filterRegex: ".*" }]);
    const folder = store.getRootNodes()[0]!;
    store.setChildren(folder.id, [{
      type: "file",
      id: "file-1",
      name: "query.sql",
      uri: "file:///workspace/query.sql",
      parentId: folder.id,
      isOpen: true,
      file: {
        fileId: "file-1",
        version: 1,
        uri: "file:///workspace/query.sql",
        mimeType: "application/sql",
        dirtyVsBackend: false,
        dirtyVsDisk: false,
        diskState: "inSync",
        openedAt: "2026-01-01T00:00:00.000Z"
      }
    }]);

    const listener = vi.fn();
    store.subscribe(listener);

    store.markFileOpen("file-1", true);

    expect(listener).not.toHaveBeenCalled();
  });
});
