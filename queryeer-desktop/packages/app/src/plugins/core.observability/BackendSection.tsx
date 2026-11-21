import type { BackendGatewayState, BackendGatewayStatus, QueryExecutionState } from "@queryeer/api/backend";
import { Badge, Card, EmptyState, KeyValueGrid, Meter, Mono, Sparkline, StatusDot, type Tone } from "./components";
import { formatAgo, formatBytes, formatClock, formatDuration } from "./model";
import type { Sample } from "./use-observability-data";

export const BACKEND_STATE_TONES: Record<BackendGatewayState, Tone> = {
  healthy: "ok",
  starting: "warning",
  unavailable: "error"
};

const EXECUTION_TONES: Record<QueryExecutionState, Tone> = {
  accepted: "info",
  running: "info",
  completed: "ok",
  failed: "error",
  cancelled: "neutral"
};

const MODE_LABELS: Record<BackendGatewayStatus["mode"], string> = {
  "dev-maven": "Development (Maven)",
  "prod-jar": "Bundled runtime",
  "mock-stdio": "Mock"
};

export function BackendSection({
  status,
  history,
  now,
  onSelectPlugin
}: {
  status: BackendGatewayStatus | null;
  history: readonly Sample[];
  now: number;
  onSelectPlugin: (pluginId: string) => void;
}) {
  if (!status) {
    return <EmptyState icon="loading" title="Waiting for backend status" />;
  }
  const runtime = status.runtimeStatus;
  const executions = [...status.recentExecutions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const active = new Set(status.activeExecutionIds);

  return (
    <div className="obs-stack">
      {status.error && status.state !== "healthy" && (
        <div className="obs-alert obs-alert-error" role="alert">
          <strong>Backend {status.state}</strong>
          <span>{status.error}</span>
        </div>
      )}

      <div className="obs-grid-2">
        <Card
          title="Connection"
          icon="plug"
          actions={
            <Badge tone={BACKEND_STATE_TONES[status.state]}>
              <StatusDot tone={BACKEND_STATE_TONES[status.state]} pulse={status.state === "starting"} />
              {status.state}
            </Badge>
          }
        >
          <KeyValueGrid
            items={[
              ["Mode", MODE_LABELS[status.mode] ?? status.mode],
              ["Server", status.serverName ? `${status.serverName} ${status.serverVersion ?? ""}`.trim() : undefined],
              ["Protocol", status.protocolVersion],
              ["Connected", status.handshakeAt ? `${formatClock(status.handshakeAt)} (${formatAgo(status.handshakeAt, now)})` : undefined],
              ["Last ping", formatAgo(status.lastPingAt, now)],
              ["Round trip", status.lastPingRttMs !== undefined ? formatDuration(status.lastPingRttMs) : undefined],
              ...(status.mode === "dev-maven"
                ? ([["JVM debug port", status.javaDebugPort !== undefined ? <Mono>{status.javaDebugPort}</Mono> : "not detected"]] as [string, React.ReactNode][])
                : []),
              ["Payload tracing", status.tracePayloads ? "on" : "off"]
            ]}
          />
          <div className="obs-trend">
            <span className="obs-muted">Ping round trip</span>
            <Sparkline values={history.map((sample) => sample.rttMs)} label="Ping round trip in ms" />
          </div>
        </Card>

        <Card title="JVM memory" icon="pulse">
          {status.jvmMemory ? (
            <>
              <div className="obs-memory-figure">
                <span className="obs-memory-used">{formatBytes(status.jvmMemory.heapUsedBytes)}</span>
                <span className="obs-muted">of {formatBytes(status.jvmMemory.heapMaxBytes)} max heap</span>
              </div>
              <Meter value={status.jvmMemory.heapUsedBytes} max={status.jvmMemory.heapMaxBytes} label="JVM heap used" />
              <div className="obs-trend">
                <span className="obs-muted">Heap used, last {history.length} samples</span>
                <Sparkline values={history.map((sample) => sample.jvmUsedBytes)} max={status.jvmMemory.heapMaxBytes} label="JVM heap used" />
              </div>
            </>
          ) : (
            <p className="obs-muted">Not reported yet.</p>
          )}
        </Card>
      </div>

      <Card
        title="Query executions"
        icon="run-all"
        actions={active.size > 0 ? <Badge tone="info">{active.size} running</Badge> : undefined}
        flush
      >
        {executions.length === 0 ? (
          <EmptyState icon="history" title="No executions yet">
            Queries run in this session appear here.
          </EmptyState>
        ) : (
          <div className="obs-table-scroll">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Engine</th>
                  <th>Started</th>
                  <th className="obs-num">Duration</th>
                  <th className="obs-num">Rows</th>
                  <th className="obs-num">Chunks</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((execution) => {
                  const end = execution.completedAt ? Date.parse(execution.completedAt) : active.has(execution.queryExecutionId) ? now : Date.parse(execution.updatedAt);
                  const duration = end - Date.parse(execution.startedAt);
                  return (
                    <tr key={execution.queryExecutionId} title={execution.queryExecutionId}>
                      <td className="obs-nowrap">
                        <Badge tone={EXECUTION_TONES[execution.state]}>
                          {execution.state === "running" && <StatusDot tone="info" pulse />}
                          {execution.state}
                          {execution.state === "running" && execution.progressPercent !== undefined && ` ${Math.round(execution.progressPercent)}%`}
                        </Badge>
                      </td>
                      <td>{execution.engineId ? <Mono>{execution.engineId}</Mono> : <span className="obs-muted">-</span>}</td>
                      <td className="obs-nowrap obs-muted">{formatClock(execution.startedAt)}</td>
                      <td className="obs-num">{Number.isFinite(duration) ? formatDuration(duration) : "-"}</td>
                      <td className="obs-num">{execution.rows.toLocaleString()}</td>
                      <td className="obs-num">{execution.chunks.toLocaleString()}</td>
                      <td className={`obs-break${execution.error ? " obs-tone-text-error" : " obs-muted"}`}>{execution.error ?? execution.progressMessage ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="obs-grid-2">
        <Card
          title="Backend plugins"
          icon="extensions"
          actions={runtime ? <span className="obs-muted">started {formatAgo(runtime.startedAt, now) ?? formatClock(runtime.startedAt)}</span> : undefined}
          flush
        >
          {!runtime || runtime.pluginStatuses.length === 0 ? (
            <EmptyState icon="extensions" title="No runtime status reported" />
          ) : (
            <div className="obs-table-scroll">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Plugin</th>
                  <th>State</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {runtime.pluginStatuses.map((plugin, index) => (
                  <tr key={`${plugin.pluginId}-${index}`}>
                    <td>
                      <button type="button" className="obs-link" onClick={() => onSelectPlugin(plugin.pluginId)}>
                        {plugin.pluginId}
                      </button>
                    </td>
                    <td>
                      <Badge tone={plugin.state === "failed" ? "error" : plugin.state === "skipped" ? "warning" : plugin.state === "deactivated" ? "neutral" : "ok"}>
                        {plugin.state}
                      </Badge>
                    </td>
                    <td className="obs-muted obs-break">{plugin.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
        <Card title="Capabilities" icon="checklist">
          {status.supportedCapabilities.length === 0 ? (
            <p className="obs-muted">None reported.</p>
          ) : (
            <div className="obs-badge-row">
              {[...status.supportedCapabilities].sort().map((capability) => (
                <Badge key={capability}>{capability}</Badge>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
