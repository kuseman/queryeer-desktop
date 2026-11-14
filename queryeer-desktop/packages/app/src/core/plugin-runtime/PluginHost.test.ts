import { describe, expect, it } from "vitest";
import type { Plugin, PluginContext } from "@queryeer/api/plugin/Plugin";
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

  it("provides external-engine host services to activating plugins", async () => {
    const host = new PluginHost({
      fileWatcher: {
        watch: async () => ({ subscriptionId: "test", unsubscribe: async () => {} }),
        mutePath: async () => {}
      }
    });
    let context: PluginContext | undefined;
    host.register({
      manifest: { id: "plugin.engine", name: "Engine", version: "1.0.0", kind: "feature" },
      activate: (value) => {
        context = value;
      }
    });

    await host.start();

    expect(context?.queryEngines.registerEngine).toBeTypeOf("function");
    expect(context?.queryEngines.invoke).toBeTypeOf("function");
    expect(context?.queryEngines.registerExecutionContextProvider).toBeTypeOf("function");
    expect(context?.queryEngines.onQueryEvent).toBeTypeOf("function");
    expect(context?.queryEngines.registerEditorHeaderItem).toBeTypeOf("function");
    expect(context?.queryEngines.registerEditorStatusItem).toBeTypeOf("function");
    expect(context?.settings.getValue).toBeTypeOf("function");
    expect(context?.settings.subscribe).toBeTypeOf("function");
    expect(context?.settings.open).toBeTypeOf("function");
    expect(context?.editorLanguages.registerMimeType).toBeTypeOf("function");
    expect(context?.editorLanguages.registerLanguage).toBeTypeOf("function");
    expect(context?.components.PasswordFieldInput).toBeTypeOf("function");
    expect(context?.components.CollectionSettingsListEditor).toBeTypeOf("function");
    expect(context?.components.useCollectionSettingsPersistence).toBeTypeOf("function");
  });
});
