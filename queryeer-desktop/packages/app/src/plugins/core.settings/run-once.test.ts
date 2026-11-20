import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsContributionRegistry } from "@queryeer/api/settings/SettingsExtension";

const registry: SettingsContributionRegistry = {
  registerSettings: vi.fn(),
  registerAdvancedRenderer: vi.fn(),
  registerAdvancedValidator: vi.fn(),
  listSettingsContributions: () => [],
  listSettingsDefinitions: () => [],
  getAdvancedRenderer: () => undefined,
  getAdvancedValidator: () => undefined
};

/** Settings files that outlive one "app start" (a fresh copy of the settings module). */
function settingsFiles() {
  const files: Record<string, Record<string, unknown>> = {};
  let index = { version: 1, updatedAt: "now", modules: {} as Record<string, unknown> };
  return {
    files,
    appShell: {
      getSettingsIndex: async () => index,
      getSettingsModule: async ({ moduleId }: { moduleId: string }) => ({ version: 1, moduleId, updatedAt: "now", values: structuredClone(files[moduleId] ?? {}) }),
      saveSettingsIndex: async (document: typeof index) => {
        index = document;
        return { accepted: true };
      },
      saveSettingsModule: async ({ moduleId, document }: { moduleId: string; document: { values: Record<string, unknown> } }) => {
        files[moduleId] = structuredClone(document.values);
        return { accepted: true };
      },
      notifyBackendSettingsModuleChanged: async () => {}
    }
  };
}

async function startApp(appShell: unknown) {
  vi.resetModules();
  vi.stubGlobal("window", { appShell });
  const service = await import("./service");
  await service.initializeCoreSettingsService(registry);
  return service;
}

describe("runCoreSettingsOnce", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs a task once settings are loaded, and never again", async () => {
    const store = settingsFiles();
    const run = vi.fn();

    const first = await startApp(store.appShell);
    first.runCoreSettingsOnce("plugin/migration.v1", run);
    expect(run).not.toHaveBeenCalled();
    await first.runPendingCoreSettingsTasks();
    expect(run).toHaveBeenCalledTimes(1);

    const second = await startApp(store.appShell);
    second.runCoreSettingsOnce("plugin/migration.v1", run);
    await second.runPendingCoreSettingsTasks();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs a task that failed again on the next start", async () => {
    const store = settingsFiles();
    const failing = vi.fn(() => {
      throw new Error("vault locked");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await startApp(store.appShell);
    first.runCoreSettingsOnce("plugin/migration.v1", failing);
    await first.runPendingCoreSettingsTasks();

    const succeeding = vi.fn();
    const second = await startApp(store.appShell);
    second.runCoreSettingsOnce("plugin/migration.v1", succeeding);
    await second.runPendingCoreSettingsTasks();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("runs a task registered after startup right away", async () => {
    const store = settingsFiles();
    const service = await startApp(store.appShell);
    await service.runPendingCoreSettingsTasks();
    let done!: () => void;
    const finished = new Promise<void>((resolve) => {
      done = resolve;
    });

    service.runCoreSettingsOnce("plugin/late.v1", () => done());

    await finished;
  });
});

describe("runCoreSettingsOnce ordering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs an id once even when registered twice, and tasks one at a time", async () => {
    const store = settingsFiles();
    const service = await startApp(store.appShell);
    const events: string[] = [];
    const task = (name: string) => async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`end ${name}`);
    };

    service.runCoreSettingsOnce("plugin/a", task("a"));
    service.runCoreSettingsOnce("plugin/a", task("a again"));
    service.runCoreSettingsOnce("plugin/b", task("b"));
    await service.runPendingCoreSettingsTasks();

    expect(events).toEqual(["start a", "end a", "start b", "end b"]);
  });

  it("drops the pending tasks of a plugin that failed to activate", async () => {
    const store = settingsFiles();
    const service = await startApp(store.appShell);
    const dropped = vi.fn();
    const kept = vi.fn();

    service.runCoreSettingsOnce("broken.plugin/migration", dropped);
    service.runCoreSettingsOnce("fine.plugin/migration", kept);
    service.dropPendingCoreSettingsTasks("broken.plugin/");
    await service.runPendingCoreSettingsTasks();

    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });
});
