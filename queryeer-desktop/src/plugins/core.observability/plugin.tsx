import { useEffect, useState } from "react";
import type { BackendGatewayStatus } from "../../contracts/backend";
import type { Plugin } from "../../contracts/plugin/Plugin";
import { getRuntimeData } from "./runtime-data";

export const OBSERVABILITY_MIME_TYPE = "application/x-observability";
export const OBSERVABILITY_URI = "observability://system";

export const coreObservabilityPlugin: Plugin = {
  manifest: {
    id: "core.observability",
    name: "Core Observability",
    version: "0.1.0",
    kind: "core",
    description: "System observability: runtime diagnostics, plugin status, backend status, and logs"
  },
  activate: (context) => {
    context.layout.registerEditor({
      id: "core.observability.editor",
      title: "Observability",
      order: 1,
      supportedMimeTypes: [OBSERVABILITY_MIME_TYPE],
      render: () => <ObservabilityEditor />
    });

    context.layout.registerStatusItem({
      id: "core.observability.statusItem",
      alignment: "right",
      order: 100,
      commandId: "core.observability.open",
      render: () => <BackendStatusIndicator />
    });

    context.commands.registerCommand({
      id: "core.observability.open",
      title: "Open Observability",
      handler: async () => {
        await context.fileMediator.openFile(OBSERVABILITY_URI, {
          mimeType: OBSERVABILITY_MIME_TYPE,
          editorId: "core.observability.editor"
        });
      }
    });

    context.files.capabilities.registerCapabilities(OBSERVABILITY_MIME_TYPE, ["viewable"]);
    context.files.capabilities.registerContentCategory(OBSERVABILITY_MIME_TYPE, "binary");
  }
};

function BackendStatusIndicator() {
  const [status, setStatus] = useState<BackendGatewayStatus | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const s = await window.appShell.getBackendStatus();
      if (active) {
        setStatus(s);
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

  return <span>Backend: {status?.state ?? "loading"}</span>;
}

function ObservabilityEditor() {
  const [backendStatus, setBackendStatus] = useState<BackendGatewayStatus | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const s = await window.appShell.getBackendStatus();
      if (active) {
        setBackendStatus(s);
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

  const runtime = getRuntimeData();
  if (!runtime) {
    return <div>Runtime data not available yet.</div>;
  }

  const { hostState, diagnostics, extensions } = runtime;
  const platformLabel =
    typeof window !== "undefined" ? window.appShell?.platform ?? "unknown" : "unknown";

  return (
    <div className="observability-editor">
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
          {(diagnostics.externalLoadErrors?.length ?? 0) === 0 ? (
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
                  <li
                    key={`${entry.timestamp}-${index}`}
                    className={`backend-log-${entry.level}`}
                  >
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
    </div>
  );
}
