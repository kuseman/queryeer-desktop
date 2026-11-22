import { useEffect, useState } from "react";
import type { BackendGatewayStatus } from "@queryeer/api/backend";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { BACKEND_STATE_TONES, BackendSection } from "./BackendSection";
import { Badge, Card, CopyButton, EmptyState, Icon, Meter, Sparkline, StatTile, StatusDot, toneOfSeverity, type Tone } from "./components";
import { ContributionsSection } from "./ContributionsSection";
import { EnginesSection } from "./EnginesSection";
import { formatBytes, formatDuration, summarize, type AttentionItem, type PluginRow } from "./model";
import { revealInObservability, useObservabilityEditorOpen, useObservabilityLocation, type ObservabilityLocation } from "./navigation";
import { PluginsSection, type PluginFilter } from "./PluginsSection";
import type { RuntimeData } from "./runtime-data";
import { getHistory, readRendererMemory, type Sample } from "./use-observability-data";
import { useObservabilityModel } from "./use-observability-model";

type ObservabilityEditorProps = {
  listFiles: () => FileEntity[];
  /** Shows an open file's tab. */
  openFile: (fileId: string) => void;
};

/** The section the sidebar menu (`ObservabilityNav`) picks; the editor itself has no menu. */
export function ObservabilityEditor({ listFiles, openFile }: ObservabilityEditorProps) {
  useObservabilityEditorOpen();
  const location = useObservabilityLocation();
  const [pluginFilter, setPluginFilter] = useState<PluginFilter>(location.filter ?? "all");
  const { backendStatus, refresh, runtime, engines, contributions, rows, fileMatches, attention } = useObservabilityModel(listFiles);

  // A location with a filter, such as "plugin problems", also sets the plugin list's filter
  useEffect(() => {
    if (location.filter) {
      setPluginFilter(location.filter);
    }
  }, [location]);

  if (!runtime) {
    return (
      <div className="obs-root">
        <EmptyState icon="loading" title="Runtime data is not available yet" />
      </div>
    );
  }

  const now = Date.now();
  const selectPlugin = (pluginId: string) => revealInObservability({ section: "plugins", pluginId });
  const errorCount = attention.filter((item) => item.severity === "error").length;
  const warningCount = attention.filter((item) => item.severity === "warning").length;

  return (
    <div className="obs-root">
      <header className="obs-header">
        <div className="obs-header-title">
          <h1>Observability</h1>
          <span className="obs-muted">
            Queryeer {window.appShell?.version ?? ""} · {window.appShell?.platform ?? "unknown"} · up{" "}
            {runtime.hostState.startedAt !== "not-started" ? formatDuration(now - Date.parse(runtime.hostState.startedAt)) : "-"}
          </span>
        </div>
        <div className="obs-header-actions">
          <span className="obs-live" title="Refreshes every 2 seconds while open">
            <StatusDot tone={backendStatus ? BACKEND_STATE_TONES[backendStatus.state] : "neutral"} pulse />
            Live
          </span>
          <button type="button" className="obs-button" onClick={refresh} title="Refresh now">
            <Icon name="refresh" />
            Refresh
          </button>
          <CopyButton text={() => buildReport(runtime, rows, attention, backendStatus)} label="Copy report" />
        </div>
      </header>

      <main className="obs-content">
        {location.section === "overview" && (
          <OverviewSection
            rows={rows}
            attention={attention}
            backendStatus={backendStatus}
            history={getHistory()}
            runtime={runtime}
            errorCount={errorCount}
            warningCount={warningCount}
            navigate={revealInObservability}
          />
        )}
        {location.section === "plugins" && (
          <PluginsSection
            rows={rows}
            selectedId={location.pluginId}
            onSelect={selectPlugin}
            filter={pluginFilter}
            onFilterChange={setPluginFilter}
          />
        )}
        {location.section === "contributions" && (
          <ContributionsSection contributions={contributions} keybindingDiagnostics={runtime.keybindingDiagnostics} onSelectPlugin={selectPlugin} />
        )}
        {location.section === "engines" && (
          <EnginesSection
            registrations={engines}
            resolvers={getQueryEngineService().getEngineResolverDiagnostics().resolvers}
            fileMatches={fileMatches}
            ownerOf={(engineId) => runtime.owners.ownerOf("queryEngine", engineId)}
            onSelectPlugin={selectPlugin}
            onOpenFile={openFile}
          />
        )}
        {location.section === "backend" && <BackendSection status={backendStatus} history={getHistory()} now={now} onSelectPlugin={selectPlugin} />}
      </main>
    </div>
  );
}

function OverviewSection({
  rows,
  attention,
  backendStatus,
  history,
  runtime,
  errorCount,
  warningCount,
  navigate
}: {
  rows: PluginRow[];
  attention: AttentionItem[];
  backendStatus: BackendGatewayStatus | null;
  history: readonly Sample[];
  runtime: RuntimeData;
  errorCount: number;
  warningCount: number;
  navigate: (location: ObservabilityLocation) => void;
}) {
  const summary = summarize(rows);
  const renderer = readRendererMemory();
  const jvm = backendStatus?.jvmMemory;
  const backendTone: Tone = backendStatus ? BACKEND_STATE_TONES[backendStatus.state] : "neutral";
  const durations = Object.entries(runtime.diagnostics.activationDurations ?? {}).sort(([, a], [, b]) => b - a);
  const totalActivation = durations.reduce((sum, [, ms]) => sum + ms, 0);
  const slowest = durations.slice(0, 8);
  const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? id;

  return (
    <div className="obs-stack">
      <div className={`obs-health-banner obs-health-${errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "ok"}`}>
        <Icon name={errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "pass-filled"} />
        <div>
          <strong>
            {errorCount > 0
              ? `${errorCount} problem${errorCount === 1 ? "" : "s"} need attention`
              : warningCount > 0
                ? `Running with ${warningCount} warning${warningCount === 1 ? "" : "s"}`
                : "All systems healthy"}
          </strong>
          <span>
            {summary.frontendActive} frontend and {summary.backendActive} backend plugins active
            {backendStatus ? ` · backend ${backendStatus.state}` : ""}
          </span>
        </div>
      </div>

      <div className="obs-stats">
        <StatTile
          label="Backend"
          icon="server-process"
          value={
            <>
              <StatusDot tone={backendTone} pulse={backendStatus?.state === "starting"} />
              {backendStatus?.state ?? "loading"}
            </>
          }
          sub={backendStatus?.lastPingRttMs !== undefined ? `${formatDuration(backendStatus.lastPingRttMs)} round trip` : undefined}
          onClick={() => navigate({ section: "backend" })}
        >
          <Sparkline values={history.map((sample) => sample.rttMs)} label="Ping round trip in ms" />
        </StatTile>
        <StatTile
          label="Plugins"
          icon="extensions"
          value={summary.total}
          tone={summary.errors > 0 ? "error" : summary.warnings > 0 ? "warning" : undefined}
          sub={summary.errors + summary.warnings > 0 ? `${summary.errors} failed · ${summary.warnings} with warnings` : "No problems"}
          onClick={() => navigate({ section: "plugins", filter: summary.errors + summary.warnings > 0 ? "problems" : undefined })}
        />
        <StatTile
          label="JVM heap"
          icon="pulse"
          value={jvm ? formatBytes(jvm.heapUsedBytes) : "-"}
          sub={jvm ? `of ${formatBytes(jvm.heapMaxBytes)}` : "Not reported"}
          onClick={() => navigate({ section: "backend" })}
        >
          {jvm && <Meter value={jvm.heapUsedBytes} max={jvm.heapMaxBytes} label="JVM heap used" />}
          <Sparkline values={history.map((sample) => sample.jvmUsedBytes)} max={jvm?.heapMaxBytes} label="JVM heap used" />
        </StatTile>
        <StatTile label="Renderer heap" icon="browser" value={renderer ? formatBytes(renderer.usedBytes) : "-"} sub={renderer ? `of ${formatBytes(renderer.limitBytes)} limit` : "Not available"}>
          {renderer && <Meter value={renderer.usedBytes} max={renderer.limitBytes} label="Renderer heap used" />}
          <Sparkline values={history.map((sample) => sample.rendererUsedBytes)} label="Renderer heap used" />
        </StatTile>
        <StatTile
          label="Executions"
          icon="run-all"
          value={backendStatus?.activeExecutionIds.length ?? 0}
          sub={`running · ${backendStatus?.recentExecutions.length ?? 0} recent`}
          onClick={() => navigate({ section: "backend" })}
        />
      </div>

      <div className="obs-grid-2 obs-grid-wide-left">
        <Card title="Needs attention" icon="bell" actions={attention.length > 0 ? <Badge>{attention.length}</Badge> : undefined} flush>
          {attention.length === 0 ? (
            <EmptyState icon="pass" title="Nothing needs attention">
              Plugins, backend and keybindings look good.
            </EmptyState>
          ) : (
            <ul className="obs-attention">
              {attention.map((item, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className={`obs-attention-item obs-attention-${item.severity}`}
                    onClick={() => navigate({ section: item.section, pluginId: item.pluginId })}
                  >
                    <StatusDot tone={toneOfSeverity(item.severity)} />
                    <span className="obs-attention-text">
                      <strong>{item.title}</strong>
                      {item.detail && <span>{item.detail}</span>}
                    </span>
                    <Icon name="chevron-right" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Slowest activations" icon="watch" actions={<span className="obs-muted">{formatDuration(totalActivation)} total</span>}>
          {slowest.length === 0 ? (
            <p className="obs-muted">No activation timings recorded.</p>
          ) : (
            <ul className="obs-bars">
              {slowest.map(([id, ms]) => (
                <li key={id}>
                  <button type="button" className="obs-bar-row" onClick={() => navigate({ section: "plugins", pluginId: id })} title={id}>
                    <span className="obs-bar-label">{nameOf(id)}</span>
                    <span className="obs-bar-track">
                      <span className="obs-bar-fill" style={{ width: `${Math.max(2, (ms / slowest[0][1]) * 100).toFixed(1)}%` }} />
                    </span>
                    <span className="obs-bar-value">{formatDuration(ms)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** A plain-text summary for bug reports: versions, problems and plugin states, without logs or file contents. */
export function buildReport(runtime: RuntimeData, rows: PluginRow[], attention: AttentionItem[], backendStatus: BackendGatewayStatus | null): string {
  const report = {
    generatedAt: new Date().toISOString(),
    shell: { version: window.appShell?.version, platform: window.appShell?.platform, hostStartedAt: runtime.hostState.startedAt },
    backend: backendStatus
      ? {
          mode: backendStatus.mode,
          state: backendStatus.state,
          server: backendStatus.serverName ? `${backendStatus.serverName} ${backendStatus.serverVersion ?? ""}`.trim() : undefined,
          protocolVersion: backendStatus.protocolVersion,
          lastPingRttMs: backendStatus.lastPingRttMs,
          jvmMemory: backendStatus.jvmMemory,
          error: backendStatus.error
        }
      : null,
    attention: attention.map(({ severity, title, detail }) => ({ severity, title, detail })),
    plugins: rows.map((row) => ({
      id: row.id,
      version: row.version,
      kind: row.kind,
      frontend: row.frontend?.state,
      backend: row.backend?.state,
      activationMs: row.frontend?.activationMs !== undefined ? Math.round(row.frontend.activationMs) : undefined,
      messages: [...(row.frontend?.messages ?? []), ...(row.backend?.reason ? [row.backend.reason] : [])]
    }))
  };
  return JSON.stringify(report, null, 2);
}
