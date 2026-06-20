import { describe, expect, it } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { TabTitleContribution } from "@queryeer/api/extensions/LayoutExtension";
import { buildTabContextMenuExpressionContext, composeTabTitle } from "./EditorTabs";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///tmp/report.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("composeTabTitle", () => {
  it("composes title segments in order", () => {
    const file = makeFile({ dirtyVsDisk: true, metadata: { "core.queryengine.jdbc.sessionId": "s-42" } });
    const contributions: TabTitleContribution[] = [
      {
        id: "dirty",
        order: 10,
        render: ({ file: value }) => (value.dirtyVsDisk || value.dirtyVsBackend ? { prefix: "• " } : null)
      },
      {
        id: "jdbc-session",
        order: 20,
        render: ({ file: value }) => {
          const sessionId = value.metadata?.["core.queryengine.jdbc.sessionId"];
          return typeof sessionId === "string" && sessionId.length > 0 ? { prefix: `(${sessionId}) ` } : null;
        }
      }
    ];

    const title = composeTabTitle({
      file,
      editor: undefined,
      tabTitleContributions: contributions,
      isActive: true
    });

    expect(title).toBe("• (s-42) report.sql");
  });

  it("hides session parentheses when session id is missing", () => {
    const file = makeFile();
    const contributions: TabTitleContribution[] = [
      {
        id: "jdbc-session",
        order: 20,
        render: ({ file: value }) => {
          const sessionId = value.metadata?.["core.queryengine.jdbc.sessionId"];
          return typeof sessionId === "string" && sessionId.length > 0 ? { prefix: `(${sessionId}) ` } : null;
        }
      }
    ];

    const title = composeTabTitle({
      file,
      editor: undefined,
      tabTitleContributions: contributions,
      isActive: false
    });

    expect(title).toBe("report.sql");
  });
});

describe("buildTabContextMenuExpressionContext", () => {
  it("allows move right but not move left for the main group when a new right group can be created", () => {
    const context = buildContext({ editorGroupIndex: 0, editorGroupCount: 1, editorGroupFileCount: 2 });

    expect(context.canMoveToLeftGroup).toBe(false);
    expect(context.canMoveToRightGroup).toBe(true);
  });

  it("does not allow move right when the only group has only one tab", () => {
    const context = buildContext({ editorGroupIndex: 0, editorGroupCount: 1, editorGroupFileCount: 1 });

    expect(context.canMoveToLeftGroup).toBe(false);
    expect(context.canMoveToRightGroup).toBe(false);
  });

  it("allows move left for non-main groups", () => {
    const context = buildContext({ editorGroupIndex: 1, editorGroupCount: 2, editorGroupFileCount: 1 });

    expect(context.canMoveToLeftGroup).toBe(true);
    expect(context.canMoveToRightGroup).toBe(false);
  });

  it("allows both move directions for middle groups", () => {
    const context = buildContext({ editorGroupIndex: 1, editorGroupCount: 3, editorGroupFileCount: 1 });

    expect(context.canMoveToLeftGroup).toBe(true);
    expect(context.canMoveToRightGroup).toBe(true);
  });

  function buildContext(options: {
    editorGroupIndex: number;
    editorGroupCount: number;
    editorGroupFileCount: number;
  }) {
    return buildTabContextMenuExpressionContext({
      file: makeFile(),
      editor: undefined,
      editorGroupId: `group-${options.editorGroupIndex + 1}`,
      editorGroupIndex: options.editorGroupIndex,
      editorGroupCount: options.editorGroupCount,
      editorGroupFileCount: options.editorGroupFileCount
    });
  }
});
