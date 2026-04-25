import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdvancedSettingsRenderer,
  AdvancedSettingsValidator,
  SettingsRegistry
} from "../../contracts/extensions/SettingsExtension";
import {
  SETTINGS_INDEX_VERSION,
  SETTINGS_MODULE_VERSION
} from "../../contracts/settings/SettingsDocuments";
import { SettingsService } from "./settings-service";

function makeRegistry(): SettingsRegistry {
  const contributions: ReturnType<SettingsRegistry["listSettingsContributions"]> = [
    {
      moduleId: "core.editor",
      title: "Editor",
      settings: [
        {
          id: "core.editor.tabSize",
          moduleId: "core.editor",
          title: "Tab Size",
          sectionPath: ["Editor"],
          type: "number",
          defaultValue: 4
        },
        {
          id: "core.editor.wordWrap",
          moduleId: "core.editor",
          title: "Word Wrap",
          sectionPath: ["Editor"],
          tags: ["wrapping"],
          type: "enum",
          defaultValue: "off",
          options: [
            { value: "off", label: "Off" },
            { value: "on", label: "On" }
          ]
        },
        {
          id: "core.editor.token",
          moduleId: "core.editor",
          title: "API Token",
          sectionPath: ["Editor"],
          type: "string",
          defaultValue: "",
          isSecret: true
        }
      ]
    }
  ];
  const renderers = new Map<string, AdvancedSettingsRenderer>();
  const validators = new Map<string, AdvancedSettingsValidator>();
  return {
    registerSettings: vi.fn(),
    registerAdvancedRenderer: vi.fn((renderer) => {
      renderers.set(renderer.id, renderer);
    }),
    registerAdvancedValidator: vi.fn((validator) => {
      validators.set(validator.id, validator);
    }),
    listSettingsContributions: () => contributions,
    listSettingsDefinitions: () => contributions.flatMap((contribution) => contribution.settings),
    getAdvancedRenderer: (id: string) => renderers.get(id),
    getAdvancedValidator: (id: string) => validators.get(id)
  };
}

describe("SettingsService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates defaults and persisted module values", async () => {
    const registry = makeRegistry();
    const service = new SettingsService({
      registry,
      bridge: {
        getSettingsIndex: async () => ({
          version: SETTINGS_INDEX_VERSION,
          updatedAt: "now",
          modules: {
            "core.editor": {
              file: "core.editor.json",
              version: SETTINGS_MODULE_VERSION,
              updatedAt: "now"
            }
          }
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: SETTINGS_MODULE_VERSION,
          moduleId,
          updatedAt: "now",
          values: {
            "core.editor.tabSize": 2
          }
        }),
        saveSettingsIndex: async () => ({ accepted: true }),
        saveSettingsModule: async () => ({ accepted: true })
      }
    });

    await service.initialize();

    expect(service.getValue("core.editor.tabSize")).toBe(2);
    expect(service.getValue("core.editor.wordWrap")).toBe("off");
  });

  it("debounces persistence after setValue", async () => {
    const saveSettingsIndex = vi.fn(async () => ({ accepted: true }));
    const saveSettingsModule = vi.fn(async () => ({ accepted: true }));
    const service = new SettingsService({
      registry: makeRegistry(),
      debounceMs: 100,
      bridge: {
        getSettingsIndex: async () => ({
          version: SETTINGS_INDEX_VERSION,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: SETTINGS_MODULE_VERSION,
          moduleId,
          updatedAt: "now",
          values: {}
        }),
        saveSettingsIndex,
        saveSettingsModule
      }
    });
    await service.initialize();

    await service.setValue("core.editor.tabSize", 8);
    await service.setValue("core.editor.tabSize", 6);

    expect(saveSettingsModule).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120);

    expect(saveSettingsModule).toHaveBeenCalledTimes(1);
    expect(saveSettingsIndex).toHaveBeenCalledTimes(1);
  });

  it("keeps secret setting read-only", async () => {
    const service = new SettingsService({
      registry: makeRegistry(),
      bridge: {
        getSettingsIndex: async () => ({
          version: SETTINGS_INDEX_VERSION,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: SETTINGS_MODULE_VERSION,
          moduleId,
          updatedAt: "now",
          values: {}
        }),
        saveSettingsIndex: async () => ({ accepted: true }),
        saveSettingsModule: async () => ({ accepted: true })
      }
    });
    await service.initialize();

    const result = await service.setValue("core.editor.token", "abc123");

    expect(result.ok).toBe(false);
    expect(service.getValue("core.editor.token")).toBe("");
  });

  it("searches by title and tags", async () => {
    const service = new SettingsService({
      registry: makeRegistry(),
      bridge: {
        getSettingsIndex: async () => ({
          version: SETTINGS_INDEX_VERSION,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: SETTINGS_MODULE_VERSION,
          moduleId,
          updatedAt: "now",
          values: {}
        }),
        saveSettingsIndex: async () => ({ accepted: true }),
        saveSettingsModule: async () => ({ accepted: true })
      }
    });
    await service.initialize();

    const byTitle = service.listDefinitions("tab");
    const byTag = service.listDefinitions("wrapping");

    expect(byTitle.map((definition) => definition.id)).toContain("core.editor.tabSize");
    expect(byTag.map((definition) => definition.id)).toContain("core.editor.wordWrap");
  });
});
