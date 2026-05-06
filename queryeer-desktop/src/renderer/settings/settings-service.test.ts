import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdvancedSettingsRenderer,
  AdvancedSettingsValidator,
  SettingsRegistry
} from "../../contracts/extensions/SettingsExtension";
import { SettingsService } from "./settings-service";

function makeRegistry(): SettingsRegistry {
  const contributions: ReturnType<SettingsRegistry["listSettingsContributions"]> = [
    {
      moduleId: "core.editor.texteditor",
      title: "Editor",
      settings: [
        {
          id: "core.editor.texteditor.tabSize",
          moduleId: "core.editor.texteditor",
          title: "Tab Size",
          sectionPath: ["Editor"],
          type: "number",
          defaultValue: 4
        },
        {
          id: "core.editor.texteditor.wordWrap",
          moduleId: "core.editor.texteditor",
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
          id: "core.editor.texteditor.token",
          moduleId: "core.editor.texteditor",
          title: "API Token",
          sectionPath: ["Editor"],
          type: "string",
          defaultValue: "",
          isSecret: true
        },
        {
          id: "core.editor.texteditor.tokenRef",
          moduleId: "core.editor.texteditor",
          title: "API Token Ref",
          sectionPath: ["Editor"],
          type: "password",
          defaultValue: ""
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
          version: 1,
          updatedAt: "now",
          modules: {
            "core.editor.texteditor": {
              file: "core.editor.texteditor.json",
              version: 3,
              updatedAt: "now"
            }
          }
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: 3,
          moduleId,
          updatedAt: "now",
          values: {
            "core.editor.texteditor.tabSize": 2
          }
        }),
        saveSettingsIndex: async () => ({ accepted: true }),
        saveSettingsModule: async () => ({ accepted: true })
      }
    });

    await service.initialize();

    expect(service.getValue("core.editor.texteditor.tabSize")).toBe(2);
    expect(service.getValue("core.editor.texteditor.wordWrap")).toBe("off");
  });

  it("increments version on setValue and notifies backend after persist", async () => {
    const saveSettingsModule = vi.fn(async () => ({ accepted: true }));
    const notifyBackendModuleChanged = vi.fn(async () => {});
    const service = new SettingsService({
      registry: makeRegistry(),
      bridge: {
        getSettingsIndex: async () => ({
          version: 1,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: 1,
          moduleId,
          updatedAt: "now",
          values: {}
        }),
        saveSettingsIndex: async () => ({ accepted: true }),
        saveSettingsModule
      },
      notifyBackendModuleChanged,
      debounceMs: 100
    });
    await service.initialize();

    await service.setValue("core.editor.texteditor.tabSize", 8);

    expect(saveSettingsModule).not.toHaveBeenCalled();
    expect(notifyBackendModuleChanged).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(120);

    expect(saveSettingsModule).toHaveBeenCalledTimes(1);
    const savedCall = (saveSettingsModule.mock.calls[0] as unknown[])[0] as { moduleId: string; document: { version: number } };
    expect(savedCall.document.version).toBe(2);
    expect(notifyBackendModuleChanged).toHaveBeenCalledTimes(1);
    expect(notifyBackendModuleChanged).toHaveBeenCalledWith("core.editor.texteditor", 2);
  });

  it("debounces persistence after setValue", async () => {
    const saveSettingsIndex = vi.fn(async () => ({ accepted: true }));
    const saveSettingsModule = vi.fn(async () => ({ accepted: true }));
    const service = new SettingsService({
      registry: makeRegistry(),
      debounceMs: 100,
      bridge: {
        getSettingsIndex: async () => ({
          version: 1,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: 1,
          moduleId,
          updatedAt: "now",
          values: {}
        }),
        saveSettingsIndex,
        saveSettingsModule
      }
    });
    await service.initialize();

    await service.setValue("core.editor.texteditor.tabSize", 8);
    await service.setValue("core.editor.texteditor.tabSize", 6);

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
          version: 1,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: 1,
          moduleId,
          updatedAt: "now",
          values: {}
        }),
        saveSettingsIndex: async () => ({ accepted: true }),
        saveSettingsModule: async () => ({ accepted: true })
      }
    });
    await service.initialize();

    const result = await service.setValue("core.editor.texteditor.token", "abc123");

    expect(result.ok).toBe(false);
    expect(service.getValue("core.editor.texteditor.token")).toBe("");
  });

  it("accepts password setting ref value", async () => {
    const service = new SettingsService({
      registry: makeRegistry(),
      bridge: {
        getSettingsIndex: async () => ({
          version: 1,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: 1,
          moduleId,
          updatedAt: "now",
          values: {}
        }),
        saveSettingsIndex: async () => ({ accepted: true }),
        saveSettingsModule: async () => ({ accepted: true })
      }
    });
    await service.initialize();

    const result = await service.setValue("core.editor.texteditor.tokenRef", "secret-ref-1");

    expect(result.ok).toBe(true);
    expect(service.getValue("core.editor.texteditor.tokenRef")).toBe("secret-ref-1");
  });

  it("searches by title and tags", async () => {
    const service = new SettingsService({
      registry: makeRegistry(),
      bridge: {
        getSettingsIndex: async () => ({
          version: 1,
          updatedAt: "now",
          modules: {}
        }),
        getSettingsModule: async ({ moduleId }) => ({
          version: 1,
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

    expect(byTitle.map((definition) => definition.id)).toContain("core.editor.texteditor.tabSize");
    expect(byTag.map((definition) => definition.id)).toContain("core.editor.texteditor.wordWrap");
  });
});
