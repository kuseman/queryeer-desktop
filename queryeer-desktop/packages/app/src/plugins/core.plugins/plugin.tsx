import { useEffect, useState } from "react";
import type { ManagedPluginInventory, ManagedPluginInventoryEntry } from "@queryeer/api/plugin/PluginInventory";
import type { Plugin } from "@queryeer/api/plugin/Plugin";

export const PLUGIN_MANAGER_EDITOR_ID = "core.plugins.editor";
export const PLUGIN_MANAGER_MIME_TYPE = "application/x-queryeer-plugin-manager";
export const PLUGIN_MANAGER_URI = "queryeer-plugins://managed";

export const corePluginsPlugin: Plugin = {
  manifest: {
    id: "core.plugins",
    name: "Plugin Manager",
    version: "0.1.0",
    kind: "core",
    dependencies: ["core.commands", "core.files", "core.menu"],
    description: "External plugin inventory and restart-based enablement controls"
  },
  activate: (context) => {
    context.layout.registerEditor({
      id: PLUGIN_MANAGER_EDITOR_ID,
      title: "Plugin Manager",
      order: 30,
      supportedMimeTypes: [PLUGIN_MANAGER_MIME_TYPE],
      render: () => <PluginManagerEditor />
    });

    context.commands.registerCommand({
      id: "core.plugins.open",
      title: "Open Plugin Manager",
      category: "Plugins",
      handler: async () => {
        await context.fileMediator.openFile(PLUGIN_MANAGER_URI, {
          mimeType: PLUGIN_MANAGER_MIME_TYPE,
          editorId: PLUGIN_MANAGER_EDITOR_ID
        });
      }
    });

    context.menu.registerMenuItem({
      id: "core.menu.tools.plugins",
      label: "Plugins",
      order: 24,
      parentId: "core.menu.tools",
      commandId: "core.plugins.open"
    });

    context.files.capabilities.registerCapabilities(PLUGIN_MANAGER_MIME_TYPE, ["viewable"]);
    context.files.capabilities.registerContentCategory(PLUGIN_MANAGER_MIME_TYPE, "binary");
    context.files.capabilities.registerLabel?.(PLUGIN_MANAGER_MIME_TYPE, "Plugin Manager");
  }
};

type InventoryState = {
  inventory: ManagedPluginInventory | null;
  loading: boolean;
  error: string | null;
  updatingPluginId: string | null;
};

export function PluginManagerEditor() {
  const [state, setState] = useState<InventoryState>({
    inventory: null,
    loading: true,
    error: null,
    updatingPluginId: null
  });

  const loadInventory = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const inventory = await window.appShell.getPluginInventory();
      setState((current) => ({ ...current, inventory, loading: false, error: null, updatingPluginId: null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  };

  useEffect(() => {
    void loadInventory();
  }, []);

  const handleToggle = async (plugin: ManagedPluginInventoryEntry) => {
    setState((current) => ({ ...current, updatingPluginId: plugin.id, error: null }));
    try {
      const result = await window.appShell.setPluginEnabled({
        pluginId: plugin.id,
        enabled: !plugin.enabled
      });
      if (!result.accepted) {
        setState((current) => ({
          ...current,
          updatingPluginId: null,
          error: result.reason ?? `Plugin '${plugin.id}' could not be updated`
        }));
        return;
      }
      await loadInventory();
    } catch (error) {
      setState((current) => ({
        ...current,
        updatingPluginId: null,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  };

  const inventory = state.inventory;
  const plugins = inventory?.plugins ?? [];
  const restartRequired = plugins.some((plugin) => plugin.restartRequired);

  return (
    <section className="plugin-manager-editor">
      <header className="plugin-manager-header">
        <div>
          <p className="plugin-manager-eyebrow">Managed external plugins</p>
          <h2>Plugin Manager</h2>
          <p>
            Enable or disable user-installed plugins. Built-in plugins are always active and are not listed here.
          </p>
        </div>
        <button type="button" className="plugin-manager-refresh" onClick={() => void loadInventory()} disabled={state.loading}>
          Refresh
        </button>
      </header>

      {state.error && <div className="plugin-manager-alert plugin-manager-alert-error">{state.error}</div>}
      {inventory?.safeMode && (
        <div className="plugin-manager-alert plugin-manager-alert-warning">
          Safe mode is active. External plugins are skipped until the app is restarted without safe mode.
        </div>
      )}
      {restartRequired && (
        <div className="plugin-manager-alert plugin-manager-alert-warning">
          Restart Queryeer to apply pending plugin enablement changes.
        </div>
      )}

      <div className="plugin-manager-meta">
        <div>
          <span>Plugin directory</span>
          <code>{inventory?.pluginsDir ?? "loading"}</code>
        </div>
        <div>
          <span>Inventory lockfile</span>
          <code>{inventory?.lockfilePath ?? "loading"}</code>
        </div>
      </div>

      {state.loading && !inventory ? (
        <div className="plugin-manager-empty">Loading plugin inventory...</div>
      ) : plugins.length === 0 ? (
        <div className="plugin-manager-empty">
          No external plugins are installed in the managed plugin directory.
        </div>
      ) : (
        <div className="plugin-manager-list">
          {plugins.map((plugin) => (
            <PluginInventoryCard
              key={plugin.id}
              plugin={plugin}
              updating={state.updatingPluginId === plugin.id}
              onToggle={() => void handleToggle(plugin)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PluginInventoryCard({
  plugin,
  updating,
  onToggle
}: {
  plugin: ManagedPluginInventoryEntry;
  updating: boolean;
  onToggle: () => void;
}) {
  const canToggle = plugin.status !== "missing";

  return (
    <article className={`plugin-manager-card plugin-manager-card-${plugin.status}`}>
      <div className="plugin-manager-card-main">
        <div>
          <h3>{plugin.name}</h3>
          <p className="plugin-manager-plugin-id">{plugin.id}</p>
        </div>
        <div className="plugin-manager-badges" aria-label="Plugin status">
          <span className={plugin.enabled ? "plugin-manager-badge-enabled" : "plugin-manager-badge-disabled"}>
            {plugin.enabled ? "Enabled" : "Disabled"}
          </span>
          <span>{statusLabel(plugin)}</span>
          {plugin.restartRequired && <span className="plugin-manager-badge-restart">Restart required</span>}
        </div>
      </div>
      <dl className="plugin-manager-details">
        <div>
          <dt>Version</dt>
          <dd>{plugin.version}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{plugin.sourceType}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{runtimeTargets(plugin)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{plugin.sourcePath}</dd>
        </div>
      </dl>
      {plugin.lastError && <p className="plugin-manager-error-text">{plugin.lastError}</p>}
      <div className="plugin-manager-card-actions">
        <button type="button" onClick={onToggle} disabled={!canToggle || updating}>
          {updating ? "Updating..." : plugin.enabled ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  );
}

function statusLabel(plugin: ManagedPluginInventoryEntry): string {
  if (plugin.status === "available") {
    return "Available";
  }
  if (plugin.status === "missing") {
    return "Missing";
  }
  return "Invalid";
}

function runtimeTargets(plugin: ManagedPluginInventoryEntry): string {
  if (plugin.hasFrontend && plugin.hasBackend) {
    return "Frontend and backend";
  }
  if (plugin.hasFrontend) {
    return "Frontend";
  }
  if (plugin.hasBackend) {
    return "Backend";
  }
  return "Unknown";
}
