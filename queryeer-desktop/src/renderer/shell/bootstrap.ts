import { PluginHost } from "../../core/plugin-runtime/PluginHost";
import { toPluginManifestFile } from "../../contracts/plugin/PluginManifestFile";
import { discoverPluginModules } from "../../plugins/discovery";

export async function bootstrapShell() {
  const host = new PluginHost();

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
    commandExecution,
    diagnostics: host.getDiagnostics()
  };
}
