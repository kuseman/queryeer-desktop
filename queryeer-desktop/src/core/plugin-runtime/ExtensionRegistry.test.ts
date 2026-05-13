import { describe, expect, it } from "vitest";
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
});
