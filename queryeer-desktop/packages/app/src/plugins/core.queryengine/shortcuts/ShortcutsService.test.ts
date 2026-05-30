import { beforeEach, describe, expect, it, vi } from "vitest";

const requestExecuteMock = vi.fn();
const getValueMock = vi.fn();
const getCommandContextMock = vi.fn();

vi.mock("../../core.settings/service", () => ({
  getCoreSettingsService: () => ({
    getValue: getValueMock
  })
}));

vi.mock("../QueryEngineService", () => ({
  getQueryEngineService: () => ({
    requestExecute: requestExecuteMock
  })
}));

vi.mock("../../core.commands/command-context-accessor", () => ({
  getCommandContext: () => getCommandContextMock()
}));

import { ShortcutsService, SHORTCUTS_SETTING_ID } from "./ShortcutsService";

describe("ShortcutsService", () => {
  beforeEach(() => {
    requestExecuteMock.mockReset();
    getValueMock.mockReset();
    getCommandContextMock.mockReset();
    window.appShell = {
      ...window.appShell,
      evaluateExpressionSync: (params) => {
        try {
          const keys = Object.keys(params.context);
          const values = keys.map((k) => params.context[k]);
          const runner = new Function(...keys, `return (${params.expression});`) as (...args: unknown[]) => unknown;
          return { ok: true as const, result: runner(...values) };
        } catch (error) {
          return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
        }
      }
    };
  });

  it("executes first matching rule with selectedText interpolation", () => {
    getValueMock.mockImplementation((id: string) => {
      if (id !== SHORTCUTS_SETTING_ID) return undefined;
      return {
        shortcuts: [{
          slot: 1,
          rules: [
            { id: "r1", when: "activeFile.mimeType == 'application/sql'", query: "select '${selectedText}'", outputId: "rows" },
            { id: "r2", when: "true", query: "select 2" }
          ]
        }]
      };
    });
    getCommandContextMock.mockReturnValue({ activeFile: { mimeType: "application/sql" }, selectedText: "abc" });

    const service = new ShortcutsService();
    service.executeShortcut(1);

    expect(requestExecuteMock).toHaveBeenCalledWith({
      textOverride: "select 'abc'",
      outputIdOverride: "rows"
    });
  });

  it("does nothing when no rule matches", () => {
    getValueMock.mockReturnValue({
      shortcuts: [{
        slot: 1,
        rules: [{ id: "r1", when: "backendHealthy", query: "select 1" }]
      }]
    });
    getCommandContextMock.mockReturnValue({ backendHealthy: false });

    const service = new ShortcutsService();
    service.executeShortcut(1);

    expect(requestExecuteMock).not.toHaveBeenCalled();
  });
});
