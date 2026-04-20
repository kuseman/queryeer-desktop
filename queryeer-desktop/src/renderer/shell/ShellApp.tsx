import { useEffect, useMemo, useState } from "react";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";
import type { PluginHostState } from "../../core/plugin-runtime/PluginHost";
import type { BackendGatewayStatus } from "../../contracts/backend";
import type { ExternalFrontendPluginManifest } from "../../contracts/plugin/ExternalFrontendPluginManifest";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";

declare global {
  interface Window {
    appShell: {
      platform: string;
      version: string;
      getBackendStatus: () => Promise<BackendGatewayStatus>;
      getExternalFrontendPlugins: () => Promise<ExternalFrontendPluginManifest[]>;
      executeBackendQuery: (params: {
        queryExecutionId: string;
        engineId: string;
        text: string;
      }) => Promise<{ accepted: boolean; queryExecutionId: string }>;
      cancelBackendQuery: (params: {
        queryExecutionId: string;
        reason?: string;
      }) => Promise<{ accepted: boolean; queryExecutionId: string }>;
    };
  }
}

type ShellAppProps = {
  hostState: PluginHostState;
  extensions: ExtensionSnapshot;
  commandExecution: CommandExecutionResult;
  diagnostics: PluginDiagnostics;
};

export function ShellApp({
  hostState,
  extensions,
  commandExecution,
  diagnostics
}: ShellAppProps): JSX.Element {
  const [backendStatus, setBackendStatus] = useState<BackendGatewayStatus | null>(null);

  const platformLabel = useMemo(() => {
    const platform = window.appShell?.platform;
    if (!platform) {
      return "unknown";
    }
    return platform;
  }, []);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const status = await window.appShell.getBackendStatus();
      if (active) {
        setBackendStatus(status);
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div className="shell-page">
      <header className="shell-topbar">
        <span className="shell-brand">Queryeer</span>
        <span className="shell-chip">Desktop Shell</span>
      </header>

      <main className="shell-main">
        <h1>Incremental migration starting point</h1>
        <p>
          This is an intentionally empty shell with strict boundaries between main,
          preload and renderer processes.
        </p>

        <section className="shell-status">
          <div>
            <span className="label">Platform</span>
            <span className="value">{platformLabel}</span>
          </div>
          <div>
            <span className="label">Shell version</span>
            <span className="value">{window.appShell?.version ?? "n/a"}</span>
          </div>
          <div>
            <span className="label">Loaded plugins</span>
            <span className="value">{hostState.loadedPluginIds.length}</span>
          </div>
          <div>
            <span className="label">Host started at</span>
            <span className="value">{hostState.startedAt}</span>
          </div>
          <div>
            <span className="label">Command bus probe</span>
            <span className="value">
              {commandExecution.executed
                ? `ok (${commandExecution.commandId})`
                : `failed (${commandExecution.reason ?? "unknown"})`}
            </span>
          </div>
          <div>
            <span className="label">Backend state</span>
            <span className="value">{backendStatus?.state ?? "loading"}</span>
          </div>
        </section>

        <section className="shell-runtime-grid">
          <article className="panel-card">
            <h2>Plugins</h2>
            <ul>
              {hostState.loadedPluginIds.map((pluginId) => (
                <li key={pluginId}>{pluginId}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Commands</h2>
            <ul>
              {extensions.commands.map((command) => (
                <li key={command.id}>{command.id}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Filesystems</h2>
            <ul>
              {extensions.filesystems.map((filesystem) => (
                <li key={filesystem.id}>{filesystem.title}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Panels</h2>
            {extensions.panels.map((panel) => (
              <div key={panel.id} className="embedded-panel">
                <h3>{panel.title}</h3>
                {panel.render()}
              </div>
            ))}
          </article>

          <article className="panel-card">
            <h2>Activation order</h2>
            <ul>
              {diagnostics.activationOrder.map((pluginId) => (
                <li key={pluginId}>{pluginId}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Capabilities</h2>
            <ul>
              {diagnostics.providedCapabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card panel-card-wide">
            <h2>Manifest diagnostics</h2>
            <div className="manifest-grid-head">
              <span>Plugin</span>
              <span>Module path</span>
              <span>Dependencies</span>
              <span>Required capabilities</span>
              <span>Provided capabilities</span>
            </div>
            {diagnostics.pluginManifests.map((manifest) => (
              <div className="manifest-grid-row" key={manifest.id}>
                <span>{manifest.id}</span>
                <span>{manifest.modulePath}</span>
                <span>{manifest.dependencies.join(", ") || "-"}</span>
                <span>{manifest.requiredCapabilities.join(", ") || "-"}</span>
                <span>{manifest.providesCapabilities.join(", ") || "-"}</span>
              </div>
            ))}

            <h3>External plugin load errors</h3>
            <div className="manifest-grid-head">
              <span>Plugin</span>
              <span>Module path</span>
              <span>Error</span>
              <span>-</span>
              <span>-</span>
            </div>
            {(diagnostics.externalLoadErrors ?? []).length === 0 ? (
              <div className="manifest-grid-row">
                <span>-</span>
                <span>-</span>
                <span>none</span>
                <span>-</span>
                <span>-</span>
              </div>
            ) : (
              (diagnostics.externalLoadErrors ?? []).map((error, index) => (
                <div className="manifest-grid-row" key={`${error.pluginId}-${index}`}>
                  <span>{error.pluginId}</span>
                  <span>{error.modulePath}</span>
                  <span>{error.message}</span>
                  <span>-</span>
                  <span>-</span>
                </div>
              ))
            )}
          </article>

          <article className="panel-card panel-card-wide">
            <h2>Backend gateway</h2>
            <div className="manifest-grid-head">
              <span>Mode</span>
              <span>Server</span>
              <span>Protocol</span>
              <span>Last ping</span>
              <span>RTT ms</span>
            </div>
            <div className="manifest-grid-row">
              <span>{backendStatus?.mode ?? "-"}</span>
              <span>
                {backendStatus?.serverName
                  ? `${backendStatus.serverName} ${backendStatus.serverVersion ?? ""}`
                  : "-"}
              </span>
              <span>{backendStatus?.protocolVersion ?? "-"}</span>
              <span>{backendStatus?.lastPingAt ?? "-"}</span>
              <span>
                {backendStatus?.lastPingRttMs !== undefined
                  ? String(backendStatus.lastPingRttMs)
                  : "-"}
              </span>
            </div>

            <h3>Capabilities</h3>
            <ul>
              {(backendStatus?.supportedCapabilities ?? []).map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>

            <h3>Runtime plugin status</h3>
            <div className="manifest-grid-head">
              <span>Plugin</span>
              <span>State</span>
              <span>Reason</span>
              <span>Runtime started</span>
              <span>Activated IDs</span>
            </div>
            {(backendStatus?.runtimeStatus?.pluginStatuses ?? []).map((pluginStatus, index) => (
              <div className="manifest-grid-row" key={`${pluginStatus.pluginId}-${index}`}>
                <span>{pluginStatus.pluginId}</span>
                <span>{pluginStatus.state}</span>
                <span>{pluginStatus.reason ?? "-"}</span>
                <span>{index === 0 ? backendStatus?.runtimeStatus?.startedAt ?? "-" : ""}</span>
                <span>
                  {index === 0
                    ? (backendStatus?.runtimeStatus?.activatedPluginIds ?? []).join(", ") || "-"
                    : ""}
                </span>
              </div>
            ))}

            <h3>Recent executions</h3>
            <div className="manifest-grid-head">
              <span>Execution</span>
              <span>Engine</span>
              <span>State</span>
              <span>Progress</span>
              <span>Chunks/Rows</span>
            </div>
            {(backendStatus?.recentExecutions ?? []).map((execution) => (
              <div className="manifest-grid-row" key={execution.queryExecutionId}>
                <span>{execution.queryExecutionId}</span>
                <span>{execution.engineId ?? "-"}</span>
                <span>{execution.state}</span>
                <span>
                  {execution.progressPercent !== undefined
                    ? `${execution.progressPercent}% ${execution.progressMessage ?? ""}`
                    : "-"}
                </span>
                <span>{`${execution.chunks}/${execution.rows}`}</span>
              </div>
            ))}

            <h3>Error</h3>
            <p>{backendStatus?.error ?? "none"}</p>

            <h3>Backend log panel</h3>
            <div className="backend-log-panel">
              {(backendStatus?.backendLogs ?? []).length === 0 ? (
                <p className="backend-log-empty">No backend logs yet.</p>
              ) : (
                <ul className="backend-log-list">
                  {(backendStatus?.backendLogs ?? []).map((entry, index) => (
                    <li key={`${entry.timestamp}-${index}`} className={`backend-log-${entry.level}`}>
                      <span className="backend-log-time">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="backend-log-level">{entry.level}</span>
                      <span className="backend-log-source">{entry.source}</span>
                      <span className="backend-log-message">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
