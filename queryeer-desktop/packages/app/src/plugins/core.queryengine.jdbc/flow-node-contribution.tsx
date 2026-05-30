import { useEffect, useState } from "react";
import { getCoreSettingsService } from "../core.settings/service";
import {
  registerFlowNodeTypeContribution,
  type FlowNodeSummaryItem
} from "../core.flow/flow-node-type-contributions";
import type { FlowNode } from "../core.flow/types";
import { FLOW_CONFIGURE_NODE_COMMAND_ID } from "../core.flow/qflow-codelens";
import {
  FLOW_ENVIRONMENTS_SETTING_ID,
  getFlowEnvironmentConfig,
  getFlowLocalMapping,
  type FlowEnvironmentConfig,
  type FlowLocalMapping,
  withFlowLocalMapping,
  withoutFlowLocalMapping
} from "../core.flow/flow-environment";
import { executeQueryForFlow } from "../core.queryengine/flow-query-execution";
import { getConfiguredJdbcConnections, type JdbcConnectionDefinition } from "./jdbc-settings";
import { getJdbcDatabaseCache } from "./jdbc-database-cache";

const JDBC_FLOW_MAPPING_OWNER = "core.queryengine.jdbc";
const JDBC_CONNECTION_MAPPING_KIND = "jdbc.connection";

export function registerJdbcFlowNodeContribution(): void {
  registerFlowNodeTypeContribution({
    id: "jdbc.query",
    title: "JDBC Query",
    description: "Execute a SQL query through the JDBC query engine.",
    createTemplate: () => ({
      metadata: {
        type: "jdbc.query",
        jdbc: {
          connection: "",
          database: ""
        }
      },
      action: "select 1"
    }),
    getSummary: ({ node }) => summarizeJdbcFlowNode(node.metadata.additional?.jdbc),
    getCodeLens: ({ node }) => getJdbcFlowMappingCodeLens(node),
    validateConfiguration: ({ node }) => validateJdbcFlowConfiguration(node.metadata.additional?.jdbc),
    renderConfiguration: ({ node, updateMetadata }) => (
      <JdbcFlowNodeConfiguration nodeJdbc={node.metadata.additional?.jdbc} updateMetadata={updateMetadata} />
    ),
    execute: async (request) => {
      if (!request.fileId) {
        return {
          ok: false,
          code: "FLOW_FILE_MISSING",
          message: `Flow node '${request.node.metadata.id}' cannot execute without a file id.`
        };
      }
      const engineStateResult = resolveJdbcFlowEngineState(request.node.metadata.additional?.jdbc);
      if (!engineStateResult.ok) {
        return {
          ok: false,
          code: engineStateResult.code ?? "FLOW_NODE_CONFIGURATION_MISSING",
          message: engineStateResult.message,
          ...(engineStateResult.details ? { details: engineStateResult.details } : {})
        };
      }
      try {
        const output = await executeQueryForFlow({
          engineId: "jdbc",
          fileId: request.fileId,
          text: request.action,
          engineState: engineStateResult.engineState
        });
        return { ok: true, output };
      } catch (error) {
        return {
          ok: false,
          code: "QUERY_ENGINE_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  });
}

function summarizeJdbcFlowNode(raw: unknown): FlowNodeSummaryItem[] {
  const state = toRecord(raw);
  const connectionRef = toOptionalString(state?.connection) ?? toOptionalString(state?.connectionId);
  const database = toOptionalString(state?.database);
  const connection = connectionRef ? analyzeJdbcFlowConnection(connectionRef) : undefined;
  return [
    ...(connectionRef ? [{ label: "Connection", value: connection?.resolvedLabel ?? connectionRef }] : []),
    ...(database ? [{ label: "Database", value: database }] : [])
  ];
}

function validateJdbcFlowConfiguration(raw: unknown): Array<{ field: string; message: string }> {
  const state = toRecord(raw);
  const connectionRef = toOptionalString(state?.connection) ?? toOptionalString(state?.connectionId);
  if (!connectionRef) {
    return [{ field: "jdbc.connection", message: "Connection is required." }];
  }

  const connection = analyzeJdbcFlowConnection(connectionRef);
  if (connection.state === "missing" || connection.state === "invalid") {
    return [{ field: "jdbc.connection", message: connection.message }];
  }
  return [];
}

function resolveJdbcFlowEngineState(raw: unknown):
  | { ok: true; engineState: Record<string, unknown> }
  | { ok: false; message: string; code?: string; details?: Record<string, unknown> } {
  const state = toRecord(raw);
  const connectionRef = toOptionalString(state?.connection) ?? toOptionalString(state?.connectionId);
  if (!connectionRef) {
    return {
      ok: false,
      message: "JDBC flow node is missing jdbc.connection."
    };
  }

  const connection = analyzeJdbcFlowConnection(connectionRef);
  if (connection.state === "missing" || connection.state === "invalid" || !connection.resolvedValue) {
    return {
      ok: false,
      code: connection.state === "invalid" ? "FLOW_MAPPING_INVALID" : "FLOW_MAPPING_MISSING",
      message: connection.message,
      details: {
        owner: JDBC_FLOW_MAPPING_OWNER,
        kind: JDBC_CONNECTION_MAPPING_KIND,
        ref: connection.ref,
        field: "connection"
      }
    };
  }

  const database = toOptionalString(state?.database);
  return {
    ok: true,
    engineState: {
      connectionId: connection.resolvedValue,
      ...(database ? { database } : {})
    }
  };
}

function JdbcFlowNodeConfiguration(props: {
  nodeJdbc: unknown;
  updateMetadata: (patch: Record<string, unknown>) => void;
}): JSX.Element {
  const state = toRecord(props.nodeJdbc) ?? {};
  const connectionRef = toOptionalString(state.connection) ?? toOptionalString(state.connectionId) ?? "";
  const database = toOptionalString(state.database) ?? "";
  const connections = listEnabledJdbcConnections();
  const connection = connectionRef ? analyzeJdbcFlowConnection(connectionRef) : undefined;
  const selectedConnectionId = connection?.state === "mapped" || connection?.state === "invalid"
    ? connection.mapping?.value ?? ""
    : connection?.state === "direct"
      ? connection.resolvedValue ?? ""
      : "";
  const resolvedConnectionId = connection?.state === "mapped" || connection?.state === "direct"
    ? connection.resolvedValue ?? ""
    : "";
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const flowEnvironmentConfig = useFlowEnvironmentConfigSnapshot();

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (!resolvedConnectionId) {
        setDatabases([]);
        return;
      }
      setLoadingDatabases(true);
      try {
        const values = await getJdbcDatabaseCache().load(resolvedConnectionId);
        if (!cancelled) {
          setDatabases(values);
        }
      } catch {
        if (!cancelled) {
          setDatabases([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingDatabases(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [resolvedConnectionId]);

  const writeJdbc = (patch: Record<string, unknown>): void => {
    const nextJdbc = {
      ...state,
      ...patch
    };
    delete nextJdbc.connectionId;
    props.updateMetadata({
      jdbc: nextJdbc
    });
  };

  const saveMapping = async (value: string): Promise<void> => {
    const service = getCoreSettingsService();
    if (!service || !connection?.ref || !value) {
      return;
    }
    const nextConfig = withFlowLocalMapping(flowEnvironmentConfig, {
      environment: flowEnvironmentConfig.activeEnvironment,
      owner: JDBC_FLOW_MAPPING_OWNER,
      kind: JDBC_CONNECTION_MAPPING_KIND,
      ref: connection.ref,
      value
    });
    await service.setValue(FLOW_ENVIRONMENTS_SETTING_ID, nextConfig);
  };

  const clearMapping = async (): Promise<void> => {
    const service = getCoreSettingsService();
    if (!service || !connection?.mapping) {
      return;
    }
    const nextConfig = withoutFlowLocalMapping(flowEnvironmentConfig, {
      environment: flowEnvironmentConfig.activeEnvironment,
      owner: JDBC_FLOW_MAPPING_OWNER,
      kind: JDBC_CONNECTION_MAPPING_KIND,
      ref: connection.ref
    });
    await service.setValue(FLOW_ENVIRONMENTS_SETTING_ID, nextConfig);
  };

  const selectLocalConnection = (value: string): void => {
    if (!value) {
      return;
    }

    const selectedConnection = connections.find((candidate) => candidate.connectionId === value);
    const selectedLabel = getJdbcConnectionLabel(selectedConnection) || value;
    if (connection?.state === "direct" && connection.resolvedValue === connection.ref) {
      if (value !== connection.resolvedValue) {
        writeJdbc({ connection: selectedLabel, database: "" });
      }
      return;
    }

    if (connection?.ref) {
      void saveMapping(value);
      return;
    }

    writeJdbc({ connection: selectedLabel, database: "" });
  };

  const status = !connectionRef
    ? "Select"
    : connection?.state === "mapped" || connection?.state === "direct"
      ? "Ready"
      : "Needs Selection";
  const statusClass = !connectionRef ? "pending" : connection?.state ?? "missing";
  const explanation = !connectionRef
    ? "Pick the local connection to use. Its name will be saved as the shared flow ref."
    : connection?.state === "mapped"
      ? `"${connectionRef}" will use ${connection.resolvedLabel ?? connection.mapping?.value ?? "the selected local connection"} on this machine.`
      : connection?.state === "direct"
        ? `"${connectionRef}" matches a local connection on this machine.`
        : connection?.state === "invalid"
          ? `"${connectionRef}" points to a local connection that is not available. Pick another local connection.`
          : `The flow asks for "${connectionRef}". Pick the local connection it should use on this machine.`;

  return (
    <div className="flow-node-sidecar-contribution-fields">
      <div className="flow-node-sidecar-local-mapping">
        <div className="flow-node-sidecar-local-mapping-label">
          <span className={`flow-node-sidecar-local-mapping-status ${statusClass}`.trim()}>
            {status}
          </span>
          <span>Connection</span>
        </div>
        <div className="flow-node-sidecar-local-mapping-description">
          {explanation}
        </div>
        <div className="flow-node-sidecar-local-mapping-controls">
          <span className="flow-node-sidecar-label">Use local</span>
          <select
            className="flow-node-sidecar-input"
            value={selectedConnectionId}
            title={connection?.message}
            onChange={(event) => selectLocalConnection(event.target.value)}
          >
            <option value="">Select connection...</option>
            {connections.map((item) => (
              <option key={item.connectionId} value={item.connectionId}>
                {getJdbcConnectionLabel(item)}
              </option>
            ))}
          </select>
          {connection?.mapping && (
            <button
              type="button"
              className="flow-node-sidecar-local-mapping-clear"
              onClick={() => {
                void clearMapping();
              }}
            >
              Clear mapping
            </button>
          )}
        </div>
        <details className="flow-node-sidecar-local-mapping-advanced">
          <summary>Advanced: shared ref</summary>
          <label className="flow-node-sidecar-local-mapping-ref">
            <span className="flow-node-sidecar-label">Shared ref</span>
            <input
              className="flow-node-sidecar-input"
              value={connectionRef}
              placeholder="portable connection name"
              onChange={(event) => writeJdbc({ connection: event.target.value, database: "" })}
            />
          </label>
        </details>
      </div>
      <label className="flow-node-sidecar-field">
        <span className="flow-node-sidecar-label">Database</span>
        <select
          className="flow-node-sidecar-input"
          value={database}
          disabled={!resolvedConnectionId || loadingDatabases}
          onChange={(event) => writeJdbc({ database: event.target.value })}
        >
          <option value="">{loadingDatabases ? "Loading..." : "Optional database"}</option>
          {[...new Set([database, ...databases].filter(Boolean))].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function getJdbcFlowMappingCodeLens(node: FlowNode): Array<{ title: string; commandId?: string; arguments?: unknown[] }> {
  const state = toRecord(node.metadata.additional?.jdbc);
  const connectionRef = toOptionalString(state?.connection) ?? toOptionalString(state?.connectionId);
  if (!connectionRef) {
    return [];
  }

  const connection = analyzeJdbcFlowConnection(connectionRef);
  if (connection.state === "missing" || connection.state === "invalid") {
    return [{
      title: `${connection.state === "missing" ? "🔴 Missing" : "🟠 Invalid"} mapping: ${connection.ref}`,
      commandId: FLOW_CONFIGURE_NODE_COMMAND_ID,
      arguments: [node.metadata.id]
    }];
  }
  if (connection.state !== "mapped") {
    return [];
  }
  return [{
    title: `🔗 Uses local mapping => ${connection.resolvedLabel ?? connection.mapping?.value ?? connection.ref}`,
    commandId: FLOW_CONFIGURE_NODE_COMMAND_ID,
    arguments: [node.metadata.id]
  }];
}

function analyzeJdbcFlowConnection(
  ref: string,
  config: FlowEnvironmentConfig = getFlowEnvironmentConfig()
): JdbcFlowConnectionAnalysis {
  const connections = listEnabledJdbcConnections();
  const exactValueMatch = connections.find((connection) => connection.connectionId === ref);
  if (exactValueMatch) {
    return {
      ref,
      state: "direct",
      message: "Connection is already a local value.",
      resolvedValue: exactValueMatch.connectionId,
      resolvedLabel: getJdbcConnectionLabel(exactValueMatch)
    };
  }

  const mapping = getFlowLocalMapping(config, {
    environment: config.activeEnvironment,
    owner: JDBC_FLOW_MAPPING_OWNER,
    kind: JDBC_CONNECTION_MAPPING_KIND,
    ref
  });
  const mappedConnection = mapping
    ? connections.find((connection) => connection.connectionId === mapping.value)
    : undefined;
  if (mapping && mappedConnection) {
    return {
      ref,
      state: "mapped",
      message: `${ref} maps to ${getJdbcConnectionLabel(mappedConnection)}.`,
      resolvedValue: mappedConnection.connectionId,
      resolvedLabel: getJdbcConnectionLabel(mappedConnection),
      mapping
    };
  }

  const labelMatch = connections.find((connection) => getJdbcConnectionLabel(connection) === ref);
  if (labelMatch) {
    return {
      ref,
      state: "direct",
      message: "Connection matched a local option label.",
      resolvedValue: labelMatch.connectionId,
      resolvedLabel: getJdbcConnectionLabel(labelMatch)
    };
  }

  return {
    ref,
    state: mapping ? "invalid" : "missing",
    message: mapping
      ? `JDBC flow mapping 'connection' value '${ref}' points to a local connection that is not available.`
      : `JDBC flow mapping 'connection' value '${ref}' is not mapped locally.`,
    mapping
  };
}

function useFlowEnvironmentConfigSnapshot(): FlowEnvironmentConfig {
  const [config, setConfig] = useState(() => getFlowEnvironmentConfig());

  useEffect(() => {
    const service = getCoreSettingsService();
    if (!service) {
      return;
    }
    const syncConfig = (): void => {
      setConfig(getFlowEnvironmentConfig());
    };
    syncConfig();
    return service.subscribe(syncConfig);
  }, []);

  return config;
}

type JdbcFlowConnectionAnalysis = {
  ref: string;
  state: "direct" | "mapped" | "missing" | "invalid";
  message: string;
  resolvedValue?: string;
  resolvedLabel?: string;
  mapping?: FlowLocalMapping;
};

function listEnabledJdbcConnections(): JdbcConnectionDefinition[] {
  return getConfiguredJdbcConnections().filter((connection) => connection.enabled);
}

function getJdbcConnectionLabel(connection: JdbcConnectionDefinition | undefined): string {
  return connection?.title?.trim() || connection?.connectionId || "";
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
