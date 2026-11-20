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
      activate: (context) => {
        context.jdbcDrivers.registerDriver({
          dialectId,
          displayName: dialectId,
          groupId: "example",
          artifactId: dialectId,
          driverClassName: `example.${dialectId}.Driver`
        });
      }
    });
    host.register(createPlugin("plugin.one", "one"));
    host.register(createPlugin("plugin.two", "two"));

    await host.start();

    expect(host.getJdbcDrivers().map(({ dialectId, ownerPluginId }) => ({ dialectId, ownerPluginId }))).toEqual([
      { dialectId: "one", ownerPluginId: "plugin.one" },
      { dialectId: "two", ownerPluginId: "plugin.two" }
    ]);
  });

  it("gives each plugin its own identity as context.plugin", async () => {
    const host = new PluginHost({
      fileWatcher: {
        watch: async () => ({ subscriptionId: "test", unsubscribe: async () => {} }),
        mutePath: async () => {}
      }
    });
    const seen: PluginContext["plugin"][] = [];
    const createPlugin = (id: string, version: string): Plugin => ({
      manifest: { id, name: `Name of ${id}`, version, kind: "feature" },
      activate: (context) => {
        seen.push(context.plugin);
      }
    });
    host.register(createPlugin("plugin.one", "1.0.0"));
    host.register({ ...createPlugin("plugin.two", "2.0.0"), manifest: { id: "plugin.two", name: "Name of plugin.two", version: "2.0.0", kind: "feature", description: "Two" } });

    await host.start();

    expect(seen).toEqual([
      { id: "plugin.one", name: "Name of plugin.one", version: "1.0.0" },
      { id: "plugin.two", name: "Name of plugin.two", version: "2.0.0", description: "Two" }
    ]);
    expect(Object.isFrozen(seen[0])).toBe(true);
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
    expect(context?.queryEngines.execute).toBeTypeOf("function");
    expect(context?.components.PasswordFieldInput).toBeTypeOf("function");
    expect(context?.components.CollectionSettingsListEditor).toBeTypeOf("function");
    expect(context?.components.useCollectionSettingsPersistence).toBeTypeOf("function");
    expect(context?.jdbcTreeActions.registerTemplate).toBeTypeOf("function");
    expect(context?.symbolActions.registerTemplate).toBeTypeOf("function");
    expect(context?.whenExpressions.registerTemplates).toBeTypeOf("function");
    expect(context?.whenExpressions.registerVariables).toBeTypeOf("function");
  });
});

describe("PluginHost failure containment and optional dependencies", () => {
  const createHost = () =>
    new PluginHost({
      fileWatcher: {
        watch: async () => ({ subscriptionId: "test", unsubscribe: async () => {} }),
        mutePath: async () => {}
      }
    });
  const createPlugin = (id: string, manifest: Partial<Plugin["manifest"]> = {}, activate: Plugin["activate"] = () => {}): Plugin => ({
    manifest: { id, name: id, version: "1.0.0", kind: "feature", ...manifest },
    activate
  });

  it("keeps activating the other plugins when one throws, and skips the plugins that require it", async () => {
    const host = createHost();
    host.register(createPlugin("broken", {}, () => {
      throw new Error("boom");
    }));
    host.register(createPlugin("needs.broken", { dependencies: ["broken"] }));
    host.register(createPlugin("fine"));

    await host.start();

    expect(host.getState().loadedPluginIds).toEqual(["fine"]);
    expect(host.getPluginProblems()).toEqual([
      { pluginId: "broken", state: "failed", message: "boom" },
      { pluginId: "needs.broken", state: "skipped", message: "Dependency broken failed to activate" }
    ]);
  });

  it("starts with a plugin whose required dependency is missing, and reports it", async () => {
    const host = createHost();
    host.register(createPlugin("orphan", { dependencies: ["not.installed"] }));
    host.register(createPlugin("fine"));

    await host.start();

    expect(host.getState().loadedPluginIds).toEqual(["fine"]);
    expect(host.getPluginProblems()).toEqual([{ pluginId: "orphan", state: "skipped", message: "Missing dependency: not.installed" }]);
  });

  it("tells a plugin whether its optional dependency is active", async () => {
    const host = createHost();
    const seen: Record<string, boolean> = {};
    host.register(
      createPlugin("mongo", { dependencies: [{ id: "pb", optional: true }, { id: "kafka", optional: true }] }, (context) => {
        seen.pb = context.isDependencyActive("pb");
        seen.kafka = context.isDependencyActive("kafka");
        seen.unrelated = context.isDependencyActive("fine");
      })
    );
    host.register(createPlugin("pb"));
    host.register(createPlugin("fine"));

    await host.start();

    expect(seen).toEqual({ pb: true, kafka: false, unrelated: false });
    expect(host.getState().loadedPluginIds).toEqual(["pb", "fine", "mongo"]);
  });

  it("activates a plugin without an optional dependency that failed, which then reports it inactive", async () => {
    const host = createHost();
    let pbActive: boolean | undefined;
    host.register(createPlugin("pb", {}, () => {
      throw new Error("pb broke");
    }));
    host.register(createPlugin("mongo", { dependencies: [{ id: "pb", optional: true }] }, (context) => {
      pbActive = context.isDependencyActive("pb");
    }));

    await host.start();

    expect(pbActive).toBe(false);
    expect(host.getState().loadedPluginIds).toEqual(["mongo"]);
  });

  it("skips a plugin once every provider of its required capability failed", async () => {
    const host = createHost();
    // No dependency: only the capability ties them, and the provider happens to activate first
    host.register(createPlugin("provider", { providesCapabilities: ["cap"] }, () => {
      throw new Error("no");
    }));
    host.register(createPlugin("consumer", { requiredCapabilities: ["cap"] }));

    await host.start();

    expect(host.getState().loadedPluginIds).toEqual([]);
    expect(host.getPluginProblems()).toEqual([
      { pluginId: "provider", state: "failed", message: "no" },
      { pluginId: "consumer", state: "skipped", message: "Requires capability 'cap', whose providers failed to activate" }
    ]);
  });

  it("starts when an external plugin's manifest has malformed capabilities, skipping only that plugin", async () => {
    const host = createHost();
    host.register(createPlugin("bad", { requiredCapabilities: "cap" as unknown as string[] }));
    host.register(createPlugin("worse", { providesCapabilities: 5 as unknown as string[] }));
    host.register(createPlugin("fine"));

    await host.start();

    expect(host.getState().loadedPluginIds).toEqual(["fine"]);
    expect(host.getPluginProblems().map((problem) => `${problem.pluginId}: ${problem.message}`)).toEqual([
      "bad: Plugin 'bad' has invalid requiredCapabilities: expected a list of capability names",
      "worse: Plugin 'worse' has invalid providesCapabilities: expected a list of capability names"
    ]);
  });

  it("lets a plugin that failed to activate undo what it registered", async () => {
    const host = createHost();
    let undone = false;
    host.register({
      ...createPlugin("broken", {}, () => {
        throw new Error("boom");
      }),
      deactivate: () => {
        undone = true;
      }
    });

    await host.start();

    expect(undone).toBe(true);
  });

  it("does not skip a plugin whose capability provider activates after it", async () => {
    const host = createHost();
    host.register(createPlugin("consumer", { requiredCapabilities: ["cap"] }));
    host.register(createPlugin("provider", { providesCapabilities: ["cap"] }));

    await host.start();

    expect(host.getState().loadedPluginIds).toEqual(["consumer", "provider"]);
    expect(host.getPluginProblems()).toEqual([]);
  });
});
