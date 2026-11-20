import type { AdvancedValidationResult, SettingsContributionRegistry } from "@queryeer/api/settings/SettingsExtension";
import { SettingsService } from "../../renderer/settings/settings-service";

let coreSettingsService: SettingsService | null = null;
let coreSettingsServiceReady = false;
let pendingOpenRequest: { settingId?: string } | null = null;
let registrySync = Promise.resolve();
const coreSettingsServiceSubscribers = new Set<(service: SettingsService) => void>();

export async function initializeCoreSettingsService(registry: SettingsContributionRegistry): Promise<SettingsService> {
  if (!coreSettingsService) {
    coreSettingsService = new SettingsService({
      registry,
      bridge: {
        getSettingsIndex: () => window.appShell.getSettingsIndex(),
        getSettingsModule: (params) => window.appShell.getSettingsModule(params),
        saveSettingsIndex: (document) => window.appShell.saveSettingsIndex(document),
        saveSettingsModule: (params) => window.appShell.saveSettingsModule(params)
      },
      notifyBackendModuleChanged: async (moduleId, version) => {
        await window.appShell.notifyBackendSettingsModuleChanged({ moduleId, version });
      }
    });
  }
  await coreSettingsService.initialize();
  if (!coreSettingsServiceReady) {
    coreSettingsServiceReady = true;
    for (const subscriber of coreSettingsServiceSubscribers) {
      subscriber(coreSettingsService);
    }
  }
  if (pendingOpenRequest) {
    const { settingId } = pendingOpenRequest;
    pendingOpenRequest = null;
    if (settingId) {
      coreSettingsService.openModalForSetting(settingId);
    } else {
      coreSettingsService.openModal();
    }
  }
  return coreSettingsService;
}

export function getCoreSettingsService(): SettingsService | null {
  return coreSettingsService;
}

export function onCoreSettingsServiceInitialized(
  listener: (service: SettingsService) => void
): () => void {
  coreSettingsServiceSubscribers.add(listener);
  if (coreSettingsService && coreSettingsServiceReady) {
    listener(coreSettingsService);
  }
  return () => {
    coreSettingsServiceSubscribers.delete(listener);
  };
}

export function getEffectiveSetting<T = unknown>(settingId: string): T | undefined {
  return coreSettingsServiceReady ? coreSettingsService?.getValue(settingId) as T | undefined : undefined;
}

export function getAllEffectiveSettings(): Readonly<Record<string, unknown>> {
  return coreSettingsServiceReady ? (coreSettingsService?.getAllValues() ?? {}) : {};
}

export function subscribeEffectiveSettings(listener: () => void): () => void {
  let disposed = false;
  let unsubscribeValues: (() => void) | undefined;
  const unsubscribeReady = onCoreSettingsServiceInitialized((service) => {
    if (disposed || unsubscribeValues) {
      return;
    }
    unsubscribeValues = service.subscribe(listener);
    listener();
  });

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    unsubscribeReady();
    unsubscribeValues?.();
  };
}

export function openCoreSettings(settingId?: string): void {
  if (!coreSettingsServiceReady || !coreSettingsService) {
    pendingOpenRequest = { settingId };
    return;
  }
  if (settingId) {
    coreSettingsService.openModalForSetting(settingId);
  } else {
    coreSettingsService.openModal();
  }
}

export function refreshCoreSettingsRegistry(): void {
  if (!coreSettingsServiceReady || !coreSettingsService) {
    return;
  }
  coreSettingsService.refreshSchemaFromRegistry();
  registrySync = registrySync
    .then(() => coreSettingsService?.syncRegistryModules())
    .catch((error: unknown) => {
      console.error("Failed to synchronize registered settings", error);
    });
}

/** A setting's new value, validated and saved like an edit in Settings. Fails for a setting no plugin registers. */
export async function setCoreSetting(settingId: string, value: unknown): Promise<AdvancedValidationResult> {
  if (!coreSettingsServiceReady || !coreSettingsService) {
    return { ok: false, message: "Settings are not loaded yet" };
  }
  await registrySync;
  return coreSettingsService.setValue(settingId, value);
}

/** A module's stored values, also of a module no plugin registers. */
export async function readCoreSettingsModuleValues(moduleId: string): Promise<Readonly<Record<string, unknown>>> {
  if (!coreSettingsServiceReady || !coreSettingsService) {
    throw new Error("Settings are not loaded yet");
  }
  return coreSettingsService.readModuleValues(moduleId);
}

type RunOnceTask = { id: string; run: () => void | Promise<void> };
const pendingRunOnce: RunOnceTask[] = [];
/** Ids queued or run in this session, so the same id never runs twice at once. */
const runOnceIds = new Set<string>();
let runOnceStarted = false;
/** Tasks run one at a time: two at once could interleave their writes. */
let runOnceQueue: Promise<void> = Promise.resolve();

/**
 * Runs `run` once per installation, after settings are loaded (at startup, once every plugin has activated and its
 * settings are read). It counts as done only when it resolves; one that throws runs again on the next start. Tasks
 * run one at a time, in the order they are registered.
 */
export function runCoreSettingsOnce(id: string, run: () => void | Promise<void>): void {
  if (runOnceIds.has(id)) {
    return;
  }
  runOnceIds.add(id);
  const task = { id, run };
  if (runOnceStarted) {
    enqueueRunOnce(task);
  } else {
    pendingRunOnce.push(task);
  }
}

/** Drops the one-time tasks whose id starts with `prefix` that haven't started, e.g. those of a plugin that failed to activate. */
export function dropPendingCoreSettingsTasks(prefix: string): void {
  for (let index = pendingRunOnce.length - 1; index >= 0; index--) {
    if (pendingRunOnce[index].id.startsWith(prefix)) {
      runOnceIds.delete(pendingRunOnce[index].id);
      pendingRunOnce.splice(index, 1);
    }
  }
}

/** Starts the one-time tasks registered so far, in order; later ones run as they are registered. Called by the shell. */
export async function runPendingCoreSettingsTasks(): Promise<void> {
  runOnceStarted = true;
  for (const task of pendingRunOnce.splice(0)) {
    enqueueRunOnce(task);
  }
  await runOnceQueue;
}

function enqueueRunOnce(task: RunOnceTask): void {
  runOnceQueue = runOnceQueue.then(() => executeRunOnce(task));
}

async function executeRunOnce(task: RunOnceTask): Promise<void> {
  const service = coreSettingsService;
  if (!coreSettingsServiceReady || !service) {
    console.error(`[settings] One-time task ${task.id} not run: settings are not loaded`);
    return;
  }
  await registrySync;
  if (service.hasCompletedOnce(task.id)) {
    return;
  }
  try {
    await task.run();
    // What it changed is written before it counts as done
    await service.flushPending();
    await service.completeOnce(task.id);
  } catch (error) {
    console.error(`[settings] One-time task ${task.id} failed; it runs again on the next start`, error);
  }
}
