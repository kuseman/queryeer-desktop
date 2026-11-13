import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";

const mocks = vi.hoisted(() => ({
  getConfiguredJdbcConnectionsMock: vi.fn(() => [
    { connectionId: "jdbc-1", title: "JDBC", dialectId: "jdbc", url: "jdbc:test", enabled: true }
  ])
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock
}));

vi.mock("./jdbc-navigation-store", () => ({
  getJdbcNavigationStore: () => ({})
}));

vi.mock("./JdbcNavigationTree", () => ({
  JdbcNavigationTree: () => <div data-testid="jdbc-tree" />
}));

vi.mock("./JdbcConnectionSelector", () => ({
  JdbcConnectionSelector: ({ fileId }: { fileId: string }) => (
    <div data-testid="jdbc-selector" data-file-id={fileId} />
  )
}));

import { JdbcNavigationView } from "./JdbcNavigationView";

function makeFile(fileId: string, mimeType: string, engineId: string, connectionId: string): FileEntity {
  return {
    fileId,
    version: 1,
    uri: `file:///${fileId}`,
    mimeType,
    engineBinding: { engineId, connectionId },
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("JdbcNavigationView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not render the JDBC selector after switching from SQL to MongoDB", () => {
    const sqlFile = makeFile("sql-file", "application/sql", "jdbc", "jdbc-1");
    const mongoFile = makeFile("mongo-file", "application/vnd.queryeer.mongodb", "mongodb", "mongo-1");
    const files = new Map([[sqlFile.fileId, sqlFile], [mongoFile.fileId, mongoFile]]);
    let activeFileId: string | null = sqlFile.fileId;
    let activeFileListener: ((fileId: string | null) => void) | undefined;
    const bindEngine = vi.fn();
    const context = {
      files: {
        getFile: (fileId: string) => files.get(fileId),
        getEditorState: vi.fn()
      },
      fileMediator: {
        getActiveFileId: () => activeFileId,
        onActiveFileChanged: (listener: (fileId: string | null) => void) => {
          activeFileListener = listener;
          return () => {};
        },
        bindEngine
      }
    } as unknown as PluginContext;

    act(() => root.render(<JdbcNavigationView context={context} />));
    expect(container.querySelector("[data-testid='jdbc-selector']")?.getAttribute("data-file-id")).toBe("sql-file");

    act(() => {
      activeFileId = mongoFile.fileId;
      activeFileListener?.(mongoFile.fileId);
    });

    expect(container.querySelector("[data-testid='jdbc-selector']")).toBeNull();
    expect(files.get(mongoFile.fileId)?.engineBinding).toEqual({ engineId: "mongodb", connectionId: "mongo-1" });
    expect(bindEngine).not.toHaveBeenCalled();
  });
});
