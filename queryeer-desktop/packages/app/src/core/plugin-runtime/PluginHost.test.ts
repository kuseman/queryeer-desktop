import { describe, expect, it } from "vitest";
import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { PluginHost } from "./PluginHost";

describe("PluginHost JDBC driver contexts", () => {
  it("associates registrations with each activating plugin manifest", async () => {
    const host = new PluginHost({
      fileWatcher: {
        watch: async () => ({ subscriptionId: "test", unsubscribe: async () => {} }),
        mutePath: async () => {}
      }
    });
    const createPlugin = (id: string, dialectId: string): Plugin => ({
      manifest: { id, name: id, version: "1.0.0", kind: "core" },
      activate: (context) => context.jdbcDrivers.registerDriver({
        dialectId,
        displayName: dialectId,
        groupId: "example",
        artifactId: dialectId,
        driverClassName: `example.${dialectId}.Driver`
      })
    });
    host.register(createPlugin("plugin.one", "one"));
    host.register(createPlugin("plugin.two", "two"));

    await host.start();

    expect(host.getJdbcDrivers().map(({ dialectId, ownerPluginId }) => ({ dialectId, ownerPluginId }))).toEqual([
      { dialectId: "one", ownerPluginId: "plugin.one" },
      { dialectId: "two", ownerPluginId: "plugin.two" }
    ]);
  });
});
