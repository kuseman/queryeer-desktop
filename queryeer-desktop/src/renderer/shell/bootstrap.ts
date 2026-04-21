import { PluginHost } from "../../core/plugin-runtime/PluginHost";
import type { FileBackendSync } from "../../core/plugin-runtime/FileMediator";
import { toPluginManifestFile } from "../../contracts/plugin/PluginManifestFile";
import { discoverPluginModules } from "../../plugins/discovery";

export async function bootstrapShell() {
  const backendSync: FileBackendSync = {
    openFile: async (file, initialText) => {
      if (!file.engineBinding) {
        return;
      }
      await window.appShell.openBackendFile({
        fileId: file.fileId,
        uri: file.uri,
        mimeType: file.mimeType,
        engineBinding: file.engineBinding,
        initialText
      });
    },
    closeFile: async (file) => {
      await window.appShell.closeBackendFile({ fileId: file.fileId });
    },
    bindFile: async (file) => {
      if (!file.engineBinding) {
        return;
      }
      await window.appShell.bindBackendFile({
        fileId: file.fileId,
        engineId: file.engineBinding.engineId,
        connectionId: file.engineBinding.connectionId
      });
    },
    changeFile: async (file, text) => {
      await window.appShell.notifyBackendFileChange({
        fileId: file.fileId,
        version: file.version,
        text
      });
    }
  };

  const host = new PluginHost({
    executeBackendQuery: (params) => window.appShell.executeBackendQuery(params),
    backendSync
  });

  const externalFrontendPlugins = await window.appShell.getExternalFrontendPlugins();
  const externalManifests = externalFrontendPlugins.map(toPluginManifestFile);

  const discovery = await discoverPluginModules(externalManifests);
  for (const pluginModule of discovery.modules) {
    host.register(pluginModule.plugin);
  }

  await host.start(discovery.manifests);
  host.setExternalLoadErrors(discovery.loadErrors);

  const commandExecution = await host.executeCommand("core.commands.about");

  return {
    hostState: host.getState(),
    extensions: host.getExtensions(),
    filesRegistry: host.getFilesRegistry(),
    fileMediator: host.getFileMediator(),
    commandExecution,
    diagnostics: host.getDiagnostics()
  };
}
