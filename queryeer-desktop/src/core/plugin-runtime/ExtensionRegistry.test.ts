import { describe, expect, it } from "vitest";
import { ExtensionRegistry } from "./ExtensionRegistry";

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
});
