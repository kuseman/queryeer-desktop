import { useEffect, useState } from "react";
import type { BackendGatewayStatus } from "../../contracts/backend";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { Plugin } from "../../contracts/plugin/Plugin";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getRegisteredQueryExecutableEngines } from "../core.queryengine/engine-registration";
import { getRuntimeData } from "./runtime-data";

export const OBSERVABILITY_MIME_TYPE = "application/x-observability";
export const OBSERVABILITY_URI = "observability://system";

export const coreObservabilityPlugin: Plugin = {
  manifest: {
    id: "core.observability",
    name: "Core Observability",
    version: "0.1.0",
    kind: "core",
    description: "System observability: runtime diagnostics, plugin status, and backend status"
  },
  activate: (context) => {
    context.layout.registerEditor({
      id: "core.observability.editor",
      title: "Observability",
      order: 1,
      supportedMimeTypes: [OBSERVABILITY_MIME_TYPE],
      render: () => (
        <ObservabilityEditor
          listFiles={() => context.files.listFiles()}
        />
      )
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

type CollapsibleSectionProps = {
  title: string;
  defaultCollapsed?: boolean;
  wide?: boolean;
  children: React.ReactNode;
};

function CollapsibleSection({ title, defaultCollapsed = true, wide = false, children }: CollapsibleSectionProps) {
  const storageKey = `observability-section-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? JSON.parse(stored) : defaultCollapsed;
    } catch {
      return defaultCollapsed;
    }
  });

  const handleToggle = (newCollapsed: boolean) => {
    setCollapsed(newCollapsed);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newCollapsed));
    } catch {
      // ignore storage errors
    }
  };

  return (
    <details className={`collapsible-section${wide ? " panel-card-wide" : ""}`} open={!collapsed}>
      <summary onClick={(e) => {
        e.preventDefault();
        handleToggle(!collapsed);
      }}>
        {title}
      </summary>
      {!collapsed && <div className="collapsible-content">{children}</div>}
    </details>
  );
}

type ObservabilityEditorProps = {
  listFiles: () => FileEntity[];
};

function ObservabilityEditor({ listFiles }: ObservabilityEditorProps) {
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

  const queryRegistrations = getRegisteredQueryExecutableEngines();
  const openFiles = listFiles();
  const queryResolverDiagnostics = getQueryEngineService().getEngineResolverDiagnostics();

  const { hostState, diagnostics, extensions, keybindingDiagnostics } = runtime;
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
        <div>
          <span className="label">JVM debug port</span>
          <span className="value">
            {backendStatus?.mode === "dev-maven"
              ? (backendStatus.javaDebugPort ?? "not detected")
              : "n/a"}
          </span>
        </div>
      </section>

      <section className="shell-runtime-grid">
        <CollapsibleSection title="Plugins" defaultCollapsed={true}>
          <article className="panel-card">
            <ul>
              {hostState.loadedPluginIds.map((pluginId) => (
                <li key={pluginId}>{pluginId}</li>
              ))}
            </ul>
          </article>
        </CollapsibleSection>

        <CollapsibleSection title="Commands" defaultCollapsed={true}>
          <article className="panel-card">
            <ul>
              {extensions.commands.map((command) => (
                <li key={command.id}>{command.id}</li>
              ))}
            </ul>
          </article>
        </CollapsibleSection>

        <CollapsibleSection title="Keybindings" defaultCollapsed={true}>
          <article className="panel-card">
            <ul>
              <li>Registered: {extensions.keybindings.length}</li>
              <li>Invalid user bindings: {keybindingDiagnostics.invalidUserBindings.length}</li>
              <li>Duplicates resolved: {keybindingDiagnostics.duplicateBindings.length}</li>
            </ul>
          </article>
        </CollapsibleSection>

        <CollapsibleSection title="Filesystems" defaultCollapsed={true}>
          <article className="panel-card">
            <ul>
              {extensions.filesystems.map((filesystem) => (
                <li key={filesystem.id}>{filesystem.title}</li>
              ))}
            </ul>
          </article>
        </CollapsibleSection>

        <CollapsibleSection title="Activation order" defaultCollapsed={true}>
          <article className="panel-card">
            <ul>
              {diagnostics.activationOrder.map((pluginId) => (
                <li key={pluginId}>{pluginId}</li>
              ))}
            </ul>
          </article>
        </CollapsibleSection>

        <CollapsibleSection title="Capabilities" defaultCollapsed={true}>
          <article className="panel-card">
            <ul>
              {diagnostics.providedCapabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </article>
        </CollapsibleSection>

        <CollapsibleSection title="Query engines" defaultCollapsed={true} wide={true}>
          <article className="panel-card">
            <h3>queryexecutable MIME registrations</h3>
            {queryRegistrations.length === 0 ? (
              <p>none</p>
            ) : (
              <ul>
                {queryRegistrations.map((registration) => (
                  <li key={registration.engineId}>
                    {registration.engineId}: {registration.mimeTypes.join(", ") || "-"}
                  </li>
                ))}
              </ul>
            )}

            <h3>Engine resolvers</h3>
            {queryResolverDiagnostics.resolvers.length === 0 ? (
              <p>none</p>
            ) : (
              <ul>
                {queryResolverDiagnostics.resolvers.map((resolverId) => (
                  <li key={resolverId}>{resolverId}</li>
                ))}
              </ul>
            )}

            <h3>Open file matches</h3>
            {openFiles.length === 0 ? (
              <p>none</p>
            ) : (
              <div className="manifest-grid-head">
                <span>URI</span>
                <span>MIME</span>
                <span>Engine</span>
                <span>Resolver</span>
                <span>Binding</span>
              </div>
            )}
            {openFiles.map((file) => {
              const fileDiagnostics = getQueryEngineService().getEngineResolverDiagnostics(file.fileId);
              return (
                <div className="manifest-grid-row" key={file.fileId}>
                  <span>{file.uri}</span>
                  <span>{file.mimeType}</span>
                  <span>{fileDiagnostics.matchedEngineId ?? "none"}</span>
                  <span>{fileDiagnostics.matchedByResolver ?? "none"}</span>
                  <span>{file.engineBinding?.engineId ?? "-"}</span>
                </div>
              );
            })}
          </article>
        </CollapsibleSection>

        <CollapsibleSection title="Manifest diagnostics" defaultCollapsed={true} wide={true}>
          <article className="panel-card">
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
        </CollapsibleSection>

        <CollapsibleSection title="Backend gateway" defaultCollapsed={true} wide={true}>
          <article className="panel-card">
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

            <CollapsibleSection title="Capabilities" defaultCollapsed={true}>
              <ul>
                {(backendStatus?.supportedCapabilities ?? []).map((capability) => (
                  <li key={capability}>{capability}</li>
                ))}
              </ul>
            </CollapsibleSection>

            <CollapsibleSection title="Runtime plugin status" defaultCollapsed={true}>
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
            </CollapsibleSection>

          </article>
        </CollapsibleSection>
      </section>
    </div>
  );
}
