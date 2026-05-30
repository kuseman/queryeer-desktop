import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LayoutToolbarContribution } from "@queryeer/api/extensions/LayoutExtension";
import { filterToolbarActions } from "./toolbar-action-filter";

describe("filterToolbarActions", () => {
  const originalAppShell = window.appShell;

  beforeEach(() => {
    window.appShell = {
      ...originalAppShell,
      evaluateExpressionSync: (params) => {
        if (params.expression === "hasActiveFile") {
          return { ok: true as const, result: !!params.context.hasActiveFile };
        }
        return { ok: false as const, message: "unsupported" };
      }
    };
  });

  afterEach(() => {
    window.appShell = originalAppShell;
  });

  it("filters toolbar actions by when and order", () => {
    const actions: LayoutToolbarContribution[] = [
      { id: "b", type: "action", order: 20, commandId: "cmd.b", when: "hasActiveFile" },
      { id: "sep", type: "separator", order: 15 },
      {
        id: "select",
        type: "select",
        order: 12,
        getOptions: () => [{ value: "x", label: "X" }],
        getValue: () => "x",
        onChange: () => {}
      },
      { id: "a", type: "action", order: 10, commandId: "cmd.a" }
    ];

    const withoutFile = filterToolbarActions(actions, { hasActiveFile: false }).map((action) => action.id);
    expect(withoutFile).toEqual(["a", "select", "sep"]);

    const withFile = filterToolbarActions(actions, { hasActiveFile: true }).map((action) => action.id);
    expect(withFile).toEqual(["a", "select", "sep", "b"]);
  });
});
