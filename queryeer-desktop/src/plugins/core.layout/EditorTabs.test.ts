import { describe, expect, it } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { TabTitleContribution } from "../../contracts/extensions/LayoutExtension";
import { composeTabTitle } from "./EditorTabs";

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
