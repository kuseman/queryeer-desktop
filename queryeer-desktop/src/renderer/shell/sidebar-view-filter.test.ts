import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayoutViewContribution } from "../../contracts/extensions/LayoutExtension";
import { filterSidebarViews } from "./sidebar-view-filter";

function view(partial: Partial<LayoutViewContribution> & Pick<LayoutViewContribution, "id">): LayoutViewContribution {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    defaultZone: partial.defaultZone ?? "primarySidebar",
    order: partial.order,
    when: partial.when,
    render: () => null
  };
}

describe("filterSidebarViews", () => {
  const originalAppShell = window.appShell;

  beforeEach(() => {
    window.appShell = {
      ...originalAppShell,
      evaluateExpressionSync: (params) => {
        const activeFile = params.context.activeFile as { mimeType?: string } | undefined;
        if (params.expression === "hasActiveFile") {
          return { ok: true as const, result: !!params.context.hasActiveFile };
        }
        if (params.expression === "activeFile.mimeType == 'application/sql'") {
          return { ok: true as const, result: activeFile?.mimeType === "application/sql" };
        }
        if (params.expression === "activeFile.mimeType == 'text/plain'") {
          return { ok: true as const, result: activeFile?.mimeType === "text/plain" };
        }
        return { ok: false as const, message: "unsupported expression" };
      }
    };
  });

  afterEach(() => {
    window.appShell = originalAppShell;
  });

  it("returns only views matching zone and when clause", () => {
    const views = [
      view({ id: "always", defaultZone: "primarySidebar", order: 3 }),
      view({ id: "needs-file", defaultZone: "primarySidebar", order: 1, when: "hasActiveFile" }),
      view({ id: "secondary", defaultZone: "secondarySidebar", order: 2 })
    ];

    const withoutActiveFile = filterSidebarViews(views, "primarySidebar", {
      hasActiveFile: false
    }).map((v) => v.id);
    expect(withoutActiveFile).toEqual(["always"]);

    const withActiveFile = filterSidebarViews(views, "primarySidebar", {
      hasActiveFile: true
    }).map((v) => v.id);
    expect(withActiveFile).toEqual(["needs-file", "always"]);
  });

  it("supports comparing active file metadata context keys", () => {
    const views = [
      view({ id: "sql", when: "activeFile.mimeType == 'application/sql'" }),
      view({ id: "text", when: "activeFile.mimeType == 'text/plain'" })
    ];

    const filtered = filterSidebarViews(views, "primarySidebar", {
      activeFile: { mimeType: "application/sql" }
    }).map((v) => v.id);

    expect(filtered).toEqual(["sql"]);
  });
});
