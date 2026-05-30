import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterMenuItemsByWhen } from "./menu-item-filter";

describe("filterMenuItemsByWhen", () => {
  const originalAppShell = window.appShell;

  beforeEach(() => {
    window.appShell = {
      ...originalAppShell,
      evaluateExpressionSync: (params) => {
        if (params.expression === "hasActiveFile") {
          return { ok: true as const, result: !!params.context.hasActiveFile };
        }
        if (params.expression === "backendHealthy") {
          return { ok: true as const, result: !!params.context.backendHealthy };
        }
        return { ok: false as const, message: "unsupported expression" };
      }
    };
  });

  afterEach(() => {
    window.appShell = originalAppShell;
  });

  it("keeps matching items and required ancestors", () => {
    const filtered = filterMenuItemsByWhen(
      [
        { id: "root", label: "Root" },
        { id: "always", parentId: "root", label: "Always" },
        { id: "needs-file", parentId: "root", label: "Needs file", when: "hasActiveFile" },
        { id: "child", parentId: "needs-file", label: "Child", when: "hasActiveFile" }
      ],
      { hasActiveFile: false }
    );

    expect(filtered.map((item) => item.id)).toEqual(["root", "always"]);
  });

  it("includes hidden parent when child is visible", () => {
    const filtered = filterMenuItemsByWhen(
      [
        { id: "root", label: "Root" },
        { id: "hidden-parent", parentId: "root", when: "hasActiveFile", label: "Hidden parent" },
        { id: "visible-child", parentId: "hidden-parent", when: "backendHealthy", label: "Visible child" }
      ],
      { hasActiveFile: false, backendHealthy: true }
    );

    expect(filtered.map((item) => item.id)).toEqual(["root", "hidden-parent", "visible-child"]);
  });
});
