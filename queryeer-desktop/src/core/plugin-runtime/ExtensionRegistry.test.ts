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
});
