import type { Plugin } from "@queryeer/api/plugin/Plugin";

export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();

  public register(plugin: Plugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      throw new Error(`Duplicate plugin id: ${plugin.manifest.id}`);
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  public all(): Plugin[] {
    return [...this.plugins.values()];
  }
}
