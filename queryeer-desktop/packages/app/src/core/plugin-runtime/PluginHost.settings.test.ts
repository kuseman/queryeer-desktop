import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "@queryeer/api/plugin/Plugin";

const settingsMocks = vi.hoisted(() => ({
  runCoreSettingsOnce: vi.fn(),
  dropPendingCoreSettingsTasks: vi.fn()
}));
vi.mock("../../plugins/core.settings/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/core.settings/service")>()),
  ...settingsMocks
}));

const { PluginHost } = await import("./PluginHost");

describe("PluginHost one-time settings tasks", () => {
  it("prefixes each plugin's task ids with its id, and drops a failed plugin's tasks", async () => {
    const host = new PluginHost({
      fileWatcher: {
        watch: async () => ({ subscriptionId: "test", unsubscribe: async () => {} }),
        mutePath: async () => {}
      }
    });
    const plugin = (id: string, fail: boolean): Plugin => ({
      manifest: { id, name: id, version: "1.0.0", kind: "feature" },
      activate: (context) => {
        context.settings.runOnce("migration.v1", () => {});
        if (fail) {
          throw new Error("boom");
        }
      }
    });
    host.register(plugin("fine.plugin", false));
    host.register(plugin("broken.plugin", true));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await host.start();

    expect(settingsMocks.runCoreSettingsOnce.mock.calls.map(([id]) => id)).toEqual(["fine.plugin/migration.v1", "broken.plugin/migration.v1"]);
    expect(settingsMocks.dropPendingCoreSettingsTasks).toHaveBeenCalledWith("broken.plugin/");
  });
});
