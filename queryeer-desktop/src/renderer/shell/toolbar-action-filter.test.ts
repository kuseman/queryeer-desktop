import { describe, expect, it } from "vitest";
import type { LayoutToolbarContribution } from "../../contracts/extensions/LayoutExtension";
import { filterToolbarActions } from "./toolbar-action-filter";

describe("filterToolbarActions", () => {
  it("filters toolbar actions by when and order", () => {
    const actions: LayoutToolbarContribution[] = [
      { id: "b", type: "action", order: 20, commandId: "cmd.b", when: "hasActiveFile" },
      { id: "sep", type: "separator", order: 15 },
      { id: "a", type: "action", order: 10, commandId: "cmd.a" }
    ];

    const withoutFile = filterToolbarActions(actions, { hasActiveFile: false }).map((action) => action.id);
    expect(withoutFile).toEqual(["a", "sep"]);

    const withFile = filterToolbarActions(actions, { hasActiveFile: true }).map((action) => action.id);
    expect(withFile).toEqual(["a", "sep", "b"]);
  });
});
