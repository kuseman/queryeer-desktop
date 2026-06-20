import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { registerTextEditorKeybindings } from "./keybindings";

describe("registerTextEditorKeybindings", () => {
  it("does not register a blanket Escape binding so Monaco can clear selections", () => {
    const registerKeybinding = vi.fn();

    registerTextEditorKeybindings({
      keybindings: { registerKeybinding }
    } as unknown as PluginContext);

    expect(registerKeybinding.mock.calls.some((call) => call[0]?.key === "Escape")).toBe(false);
  });
});
