import type { BackendError } from "./ErrorCode.js";
import type {
  BackendNotificationMethod,
  BackendRequestMethod
} from "./Methods.js";

export type Capability =
  | "backend.runtimeStatus"
  | "security.session.open"
  | "security.session.close"
  | "security.vault.changed"
  | "health.ping"
  | "queryengine.execute"
  | "queryengine.cancel"
  | "engine.invoke"
  | "connection.upsert"
  | "queryengine.progress"
  | "queryengine.chunkStart"
  | "queryengine.chunkRows"
  | "queryengine.completed"
  | "queryengine.failed"
  | "file.open"
  | "file.close"
  | "file.bind"
  | "file.change";

export type ClientIdentity = {
  name: string;
  version: string;
};

export type ServerIdentity = {
  name: string;
  version: string;
};

export type HandshakeParams = {
  client: ClientIdentity;
  supportedProtocolMajors: number[];
  requestedCapabilities: Capability[];
};

export type HandshakeResult = {
  server: ServerIdentity;
  selectedProtocolVersion: string;
  supportedCapabilities: Capability[];
};

export type PingParams = {
  timestamp: string;
};

export type PingResult = {
  timestamp: string;
  uptimeMs: number;
};

export type SecuritySessionOpenParams = {
  sessionId: string;
  vaultPath: string;
  sessionKeyBase64: string;
  vaultUpdatedAt?: string;
};

export type SecuritySessionOpenResult = {
  accepted: boolean;
};

export type SecuritySessionCloseParams = {
  sessionId?: string;
  reason: "lock" | "rotate" | "shutdown" | "error";
};

export type SecuritySessionCloseResult = {
  accepted: boolean;
};

export type SecurityVaultChangedParams = {
  vaultPath: string;
  vaultUpdatedAt?: string;
};

export type SecurityVaultChangedResult = {
  accepted: boolean;
};

export type RuntimePluginState =
  | "loaded"
  | "skipped"
  | "activated"
  | "failed"
  | "deactivated";

export type RuntimePluginStatus = {
  pluginId: string;
  state: RuntimePluginState;
  reason?: string;
};

export type RuntimeStatusParams = {
  includeCapabilities?: boolean;
};

export type RuntimeStatusResult = {
  startedAt: string;
  pluginStatuses: RuntimePluginStatus[];
  activatedPluginIds: string[];
  providedCapabilities?: string[];
};

export type QueryExecuteParams = {
  queryExecutionId: string;
  engineId: string;
  connectionId?: string;
  fileId?: string;
  text: string;
  parameters?: unknown[];
  engineState?: unknown;
  options?: {
    maxRows?: number;
    timeoutMs?: number;
  };
};

export type QueryExecuteResult = {
  accepted: boolean;
  queryExecutionId: string;
};

export type QueryCancelParams = {
  queryExecutionId: string;
  reason?: string;
};

export type QueryCancelResult = {
  accepted: boolean;
  queryExecutionId: string;
};

export type EngineInvokeParams = {
  engineId: string;
  fileId?: string;
  action: string;
  payload?: unknown;
};

export type EngineInvokeResult = {
  result?: unknown;
};

export type ConnectionUpsertParams = {
  connectionId?: string;
  engineId: string;
  name: string;
  host: string;
  port?: number;
  database?: string;
  username?: string;
  options?: Record<string, unknown>;
};

export type ConnectionUpsertResult = {
  connectionId: string;
  version: number;
};

export type QueryProgressNotification = {
  queryExecutionId: string;
  percent?: number;
  message?: string;
};

export type QueryColumnType =
  | "string"
  | "boolean"
  | "int"
  | "long"
  | "decimal"
  | "float"
  | "double"
  | "datetime"
  | "datetimeoffset"
  | "object"
  | "array"
  | "table"
  | "any"
  | "null";

export type QueryChunkStartNotification = {
  queryExecutionId: string;
  resultSetIndex: number;
  schema: {
    columns: Array<{ name: string; type: QueryColumnType }>;
  };
};

export type QueryChunkRowsNotification = {
  queryExecutionId: string;
  resultSetIndex: number;
  rows: unknown[][];
};

export type QueryCompletedNotification = {
  queryExecutionId: string;
  metrics?: {
    durationMs?: number;
    rowCount?: number;
  };
  /** Which output capabilities this result provides, e.g. ["rows"], ["rows", "plan"]. Absent = ["rows"] by convention. */
  features?: string[];
  engineStatePatch?: unknown;
};

export type QueryFailedNotification = {
  queryExecutionId: string;
  error: BackendError;
};

export type FileEngineBindingParams = {
  engineId: string;
  connectionId?: string;
};

export type FileOpenParams = {
  fileId: string;
  uri: string;
  mimeType: string;
  engineBinding?: FileEngineBindingParams;
  initialText?: string;
};

export type FileOpenResult = {
  fileId: string;
  backendVersion: number;
};

export type FileCloseParams = {
  fileId: string;
};

export type FileCloseResult = {
  fileId: string;
  accepted: boolean;
};

export type FileBindParams = {
  fileId: string;
  engineId: string;
  connectionId?: string;
};

export type FileBindResult = {
  fileId: string;
  engineId: string;
  backendVersion: number;
};

export type FileChangeNotification = {
  fileId: string;
  version: number;
  text: string;
};

export type BackendMethodParamsMap = {
  "backend.handshake": HandshakeParams;
  "backend.runtimeStatus": RuntimeStatusParams;
  "security.session.open": SecuritySessionOpenParams;
  "security.session.close": SecuritySessionCloseParams;
  "security.vault.changed": SecurityVaultChangedParams;
  "health.ping": PingParams;
  "queryengine.execute": QueryExecuteParams;
  "queryengine.cancel": QueryCancelParams;
  "engine.invoke": EngineInvokeParams;
  "connection.upsert": ConnectionUpsertParams;
  "file.open": FileOpenParams;
  "file.close": FileCloseParams;
  "file.bind": FileBindParams;
};

export type BackendMethodResultMap = {
  "backend.handshake": HandshakeResult;
  "backend.runtimeStatus": RuntimeStatusResult;
  "security.session.open": SecuritySessionOpenResult;
  "security.session.close": SecuritySessionCloseResult;
  "security.vault.changed": SecurityVaultChangedResult;
  "health.ping": PingResult;
  "queryengine.execute": QueryExecuteResult;
  "queryengine.cancel": QueryCancelResult;
  "engine.invoke": EngineInvokeResult;
  "connection.upsert": ConnectionUpsertResult;
  "file.open": FileOpenResult;
  "file.close": FileCloseResult;
  "file.bind": FileBindResult;
};

export type BackendNotificationParamsMap = {
  "queryengine.progress": QueryProgressNotification;
  "queryengine.chunkStart": QueryChunkStartNotification;
  "queryengine.chunkRows": QueryChunkRowsNotification;
  "queryengine.completed": QueryCompletedNotification;
  "queryengine.failed": QueryFailedNotification;
  "file.change": FileChangeNotification;
};

export type RequestParamsOf<TMethod extends BackendRequestMethod> =
  BackendMethodParamsMap[TMethod];

export type RequestResultOf<TMethod extends BackendRequestMethod> =
  BackendMethodResultMap[TMethod];

export type NotificationParamsOf<TMethod extends BackendNotificationMethod> =
  BackendNotificationParamsMap[TMethod];
