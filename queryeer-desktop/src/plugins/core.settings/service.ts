import type { SettingsRegistry } from "../../contracts/extensions/SettingsExtension";
import { SettingsService } from "../../renderer/settings/settings-service";

let coreSettingsService: SettingsService | null = null;
const coreSettingsServiceSubscribers = new Set<(service: SettingsService) => void>();

export async function initializeCoreSettingsService(registry: SettingsRegistry): Promise<SettingsService> {
  if (!coreSettingsService) {
    coreSettingsService = new SettingsService({
      registry,
      bridge: {
        getSettingsIndex: () => window.appShell.getSettingsIndex(),
        getSettingsModule: (params) => window.appShell.getSettingsModule(params),
        saveSettingsIndex: (document) => window.appShell.saveSettingsIndex(document),
        saveSettingsModule: (params) => window.appShell.saveSettingsModule(params)
      }
    });
    for (const subscriber of coreSettingsServiceSubscribers) {
      subscriber(coreSettingsService);
    }
  }
  await coreSettingsService.initialize();
  return coreSettingsService;
}

export function getCoreSettingsService(): SettingsService | null {
  return coreSettingsService;
}

export function onCoreSettingsServiceInitialized(
  listener: (service: SettingsService) => void
): () => void {
  coreSettingsServiceSubscribers.add(listener);
  if (coreSettingsService) {
    listener(coreSettingsService);
  }
  return () => {
    coreSettingsServiceSubscribers.delete(listener);
  };
}
