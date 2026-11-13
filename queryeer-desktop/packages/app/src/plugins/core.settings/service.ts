import type { SettingsContributionRegistry } from "@queryeer/api/settings/SettingsExtension";
import { SettingsService } from "../../renderer/settings/settings-service";

let coreSettingsService: SettingsService | null = null;
let coreSettingsServiceReady = false;
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
