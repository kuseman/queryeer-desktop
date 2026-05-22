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
