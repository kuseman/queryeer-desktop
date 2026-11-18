import { describe, expect, it, vi } from "vitest";
import { ExtensionRegistry, getTableOutputContextMenuProviders } from "./ExtensionRegistry";

describe("ExtensionRegistry settings registration", () => {
  it("accepts password settings without Ref suffix", () => {
    const registry = new ExtensionRegistry().createSettingsRegistry();

    expect(() =>
      registry.registerSettings({
        moduleId: "test.module",
        title: "Test",
        settings: [
          {
            id: "test.module.apiKey",
            moduleId: "test.module",
            title: "API key",
            sectionPath: ["Test"],
            type: "password",
            defaultValue: ""
          }
        ]
      })
    ).not.toThrow();
  });

  it("lists registered tooltip sections", () => {
    const extensionRegistry = new ExtensionRegistry();
    const tooltipRegistry = extensionRegistry.createTooltipRegistry();

    tooltipRegistry.registerTooltipSection({
      id: "test.tooltip.section",
      order: 10,
      render: () => ({ label: "Path", value: "file:///tmp/a.sql" })
    });

    const sections = tooltipRegistry.listTooltipSections?.();

    expect(sections?.map((section) => section.id)).toEqual(["test.tooltip.section"]);
  });

  it("registers and unregisters table output context menu providers", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const extensionRegistry = new ExtensionRegistry();
    const tableRegistry = extensionRegistry.createTableOutputContextMenuRegistry();

    tableRegistry.registerProvider({
      id: "provider-a",
      getItems: async () => []
    });
    tableRegistry.registerProvider({
      id: "provider-a",
      when: "global",
      getItems: async () => []
    });

    expect(getTableOutputContextMenuProviders().length).toBe(1);
    expect(getTableOutputContextMenuProviders()[0]?.when).toBe("global");

    tableRegistry.unregisterProvider("provider-a");
    expect(getTableOutputContextMenuProviders().length).toBe(0);
    tableRegistry.unregisterProvider("missing");
  });

  it("removes a table output context menu provider through its disposable", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const extensionRegistry = new ExtensionRegistry();
    const tableRegistry = extensionRegistry.createTableOutputContextMenuRegistry();

    const first = tableRegistry.registerProvider({ id: "provider-b", getItems: async () => [] });
    first.dispose();
    expect(getTableOutputContextMenuProviders().length).toBe(0);

    // A stale disposable must not remove the provider that replaced it.
    const stale = tableRegistry.registerProvider({ id: "provider-b", getItems: async () => [] });
    const replacement = tableRegistry.registerProvider({ id: "provider-b", when: "global", getItems: async () => [] });
    stale.dispose();
    expect(getTableOutputContextMenuProviders().map((p) => p.when)).toEqual(["global"]);
    replacement.dispose();
    replacement.dispose();
    expect(getTableOutputContextMenuProviders().length).toBe(0);
  });

  it("collects assistant context and lists tools in deterministic applicable order", async () => {
    vi.stubGlobal("window", {
      appShell: {
        evaluateExpressionSync: (params: { expression: string; context: Record<string, unknown> }) => ({
          ok: true,
          result: params.expression === "activeFile.mimeType == 'application/sql'"
            && (params.context.activeFile as { mimeType?: string } | undefined)?.mimeType === "application/sql"
        })
      }
    });
    const extensionRegistry = new ExtensionRegistry();
    const assistant = extensionRegistry.createAssistantRegistry();

    assistant.registerContextContribution({
      id: "later",
      title: "Later",
      order: 20,
      collect: () => [{ id: "later", label: "Later", kind: "test", value: "later" }]
    });
    assistant.registerContextContribution({
      id: "first",
      title: "First",
      order: 10,
      when: "hasActiveTextEditor",
      collect: () => [{ id: "first", label: "First", kind: "test", value: "first" }]
    });
    assistant.registerToolContribution({
      id: "tool-hidden",
      title: "Hidden",
      description: "Hidden",
      inputSchema: {},
      when: "missing",
      invoke: () => ({ ok: true })
    });
    assistant.registerToolContribution({
      id: "tool-visible",
      title: "Visible",
      description: "Visible",
      inputSchema: {},
      when: "hasActiveTextEditor",
      invoke: () => ({ ok: true })
    });
    assistant.registerToolContribution({
      id: "tool-sql",
      title: "SQL",
      description: "SQL",
      inputSchema: {},
      when: "activeFile.mimeType == 'application/sql'",
      invoke: () => ({ ok: true })
    });

    const request = {
      activeFileId: "file-1",
      contextValues: { global: true, hasActiveTextEditor: true, activeFile: { mimeType: "application/sql" } }
    };

    await expect(assistant.collectContext(request)).resolves.toMatchObject([
      { id: "first" },
      { id: "later" }
    ]);
    expect(assistant.listTools(request).map((tool) => tool.id)).toEqual(["tool-sql", "tool-visible"]);
  });

  it("returns an assistant tool failure for unknown tool ids", async () => {
    const assistant = new ExtensionRegistry().createAssistantRegistry();

    await expect(assistant.invokeTool({
      toolId: "missing",
      input: {},
      activeFileId: null,
      contextValues: { global: true }
    })).resolves.toMatchObject({ ok: false });
  });

});

describe("ExtensionRegistry registrations return a Disposable (F6)", () => {
  it("a disposed command is gone, unless a later registration replaced it", async () => {
    const registry = new ExtensionRegistry();
    const commands = registry.createCommandRegistry();
    const first = vi.fn();
    const second = vi.fn();

    const firstRegistration = commands.registerCommand({ id: "test.command", title: "First", handler: first });
    const secondRegistration = commands.registerCommand({ id: "test.command", title: "Second", handler: second });
    firstRegistration.dispose();
    await commands.executeCommand("test.command");
    expect(second).toHaveBeenCalledTimes(1);
    expect(registry.snapshot().commands.map((command) => command.title)).toEqual(["Second"]);

    secondRegistration.dispose();
    expect(commands.canExecuteCommand("test.command")).toBe(false);
    expect(registry.snapshot().commands).toEqual([]);
    expect(first).not.toHaveBeenCalled();
  });

  it("disposing settings removes the contribution and its definitions, so they can be registered again", () => {
    const settings = new ExtensionRegistry().createSettingsRegistry();
    const contribution = {
      moduleId: "test.module",
      title: "Test",
      settings: [
        { id: "test.module.a", moduleId: "test.module", title: "A", sectionPath: ["Test"], type: "string" as const, defaultValue: "" }
      ]
    };

    const registration = settings.registerSettings(contribution);
    expect(() => settings.registerSettings(contribution)).toThrow("Duplicate setting id");
    registration.dispose();
    expect(settings.listSettingsContributions()).toEqual([]);
    expect(settings.listSettingsDefinitions()).toEqual([]);
    expect(() => settings.registerSettings(contribution)).not.toThrow();
  });

  it("a settings contribution that fails validation leaves nothing behind", () => {
    const settings = new ExtensionRegistry().createSettingsRegistry();
    const setting = (id: string) =>
      ({ id, moduleId: "test.module", title: id, sectionPath: ["Test"], type: "string" as const, defaultValue: "" });

    expect(() =>
      settings.registerSettings({ moduleId: "test.module", title: "Test", settings: [setting("test.module.a"), setting("test.module.a")] })
    ).toThrow("Duplicate setting id");
    expect(settings.listSettingsDefinitions()).toEqual([]);
    expect(() =>
      settings.registerSettings({ moduleId: "test.module", title: "Test", settings: [setting("test.module.a")] })
    ).not.toThrow();
  });

  it("the same command object registered twice stays until both registrations are disposed", async () => {
    const registry = new ExtensionRegistry();
    const commands = registry.createCommandRegistry();
    const command = { id: "test.twice", title: "Twice", handler: vi.fn() };

    const first = commands.registerCommand(command);
    const second = commands.registerCommand(command);
    first.dispose();
    expect(commands.canExecuteCommand("test.twice")).toBe(true);
    expect(registry.snapshot().commands).toHaveLength(1);
    second.dispose();
    expect(commands.canExecuteCommand("test.twice")).toBe(false);
    expect(registry.snapshot().commands).toEqual([]);
  });

  it("editor changes and supplementary outline providers stop on dispose", () => {
    const registry = new ExtensionRegistry();
    const listener = vi.fn();
    const editors = registry.createEditorRegistry();
    const subscription = editors.onActiveEditorChanged(listener);
    const again = editors.onActiveEditorChanged(listener);
    subscription.dispose();
    subscription.dispose();
    registry.getEditorRegistryHost().setActiveEditor(null);
    expect(listener).toHaveBeenCalledTimes(1);
    again.dispose();

    const outline = registry.createOutlineRegistry();
    const supplementary = outline.registerSupplementaryOutlineProvider({ mimeType: "text/x-test", provider: () => [] });
    supplementary.dispose();
    return expect(outline.getSymbols("text/x-test", "x")).resolves.toEqual([]);
  });

  it("layout, menu, keybinding, tooltip, quick command, outline and assistant registrations are removed on dispose", async () => {
    const registry = new ExtensionRegistry();
    const disposables = [
      registry.createLayoutRegistry().registerToolbarAction({ id: "test.toolbar", title: "T", commandId: "x" }),
      registry.createLayoutRegistry().registerView({ id: "test.view", title: "V", defaultZone: "primarySidebar", render: () => null }),
      registry.createMenuRegistry().registerMenuItem({ id: "test.menu", label: "M", commandId: "x" }),
      registry.createKeybindingRegistry().registerKeybinding({ id: "test.key", key: "CmdOrCtrl+K", commandId: "x" }),
      registry.createTooltipRegistry().registerTooltipSection({ id: "test.tooltip", order: 1, render: () => null }),
      registry.createQuickCommandRegistry().registerProvider({ id: "test.quick", prefix: ">", provide: () => [] } as never),
      registry.createOutlineRegistry().registerOutlineProvider({ mimeType: "text/x-test", provider: () => [] }),
      registry.createAssistantRegistry().registerToolContribution({
        id: "test.tool",
        name: "tool",
        description: "",
        inputSchema: {},
        invoke: async () => ({ ok: true })
      } as never)
    ];
    const rebuild = vi.fn(async () => {});
    disposables.push(registry.createMenuRegistry().onRebuild(rebuild));

    const before = registry.snapshot();
    expect(before.layout.toolbarActions).toHaveLength(1);
    expect(before.layout.views).toHaveLength(1);
    expect(before.menu.items).toHaveLength(1);
    expect(before.keybindings).toHaveLength(1);
    expect(before.tooltip.sections).toHaveLength(1);
    expect(registry.getQuickCommandProviders()).toHaveLength(1);
    expect(registry.createOutlineRegistry().hasProvider("text/x-test")).toBe(true);
    expect(registry.createAssistantRegistry().listTools({ contextValues: {} } as never)).toHaveLength(1);

    for (const disposable of disposables) {
      disposable.dispose();
    }
    await registry.rebuildMenu();

    const after = registry.snapshot();
    expect(after.layout.toolbarActions).toEqual([]);
    expect(after.layout.views).toEqual([]);
    expect(after.menu.items).toEqual([]);
    expect(after.keybindings).toEqual([]);
    expect(after.tooltip.sections).toEqual([]);
    expect(registry.getQuickCommandProviders()).toEqual([]);
    expect(registry.createOutlineRegistry().hasProvider("text/x-test")).toBe(false);
    expect(registry.createAssistantRegistry().listTools({ contextValues: {} } as never)).toEqual([]);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("files registrations and subscriptions are removed on dispose", () => {
    const files = new ExtensionRegistry().createFilesRegistry();
    const subscriber = vi.fn();

    const label = files.capabilities.registerLabel?.("text/x-test", "Test");
    const icon = files.mimeIcons.registerMimeIcon({ moduleId: "test", mimeType: "text/x-test", icon: () => null as never });
    const subscription = files.subscribe(subscriber);
    expect(files.capabilities.getLabel?.("text/x-test")).toBe("Test");
    expect(files.mimeIcons.getMimeIcon("text/x-test")).toBeDefined();

    label?.dispose();
    icon.dispose();
    subscription.dispose();
    subscriber.mockClear();
    files.openFile({ uri: "file:///tmp/a.sql" } as never);

    expect(files.capabilities.getLabel?.("text/x-test")).toBeUndefined();
    expect(files.mimeIcons.getMimeIcon("text/x-test")).toBeUndefined();
    expect(subscriber).not.toHaveBeenCalled();
  });
});
