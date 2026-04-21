import type { BackendError } from "./ErrorCode";
import type {
  BackendNotificationMethod,
  BackendRequestMethod
} from "./Methods";

export type Capability =
  | "backend.runtimeStatus"
  | "health.ping"
  | "query.execute"
  | "query.cancel"
  | "connection.upsert"
  | "credential.store"
  | "query.progress"
  | "query.resultChunk"
  | "query.completed"
  | "query.failed"
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
  credentialStatus: "missing" | "present";
};

export type CredentialStoreParams = {
  connectionId: string;
  credentialKind: "password";
  password: string;
};

export type CredentialStoreResult = {
  connectionId: string;
  credentialId: string;
  version: number;
};

export type QueryProgressNotification = {
  queryExecutionId: string;
  percent?: number;
  message?: string;
};

export type QueryResultChunkNotification = {
  queryExecutionId: string;
  chunkIndex: number;
  schema?: {
    columns: Array<{ name: string; type: string }>;
  };
  rows: unknown[][];
  isLastChunk: boolean;
};

export type QueryCompletedNotification = {
  queryExecutionId: string;
  metrics?: {
    durationMs?: number;
    rowCount?: number;
  };
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
  "health.ping": PingParams;
  "query.execute": QueryExecuteParams;
  "query.cancel": QueryCancelParams;
  "connection.upsert": ConnectionUpsertParams;
  "credential.store": CredentialStoreParams;
  "file.open": FileOpenParams;
  "file.close": FileCloseParams;
  "file.bind": FileBindParams;
};

export type BackendMethodResultMap = {
  "backend.handshake": HandshakeResult;
  "backend.runtimeStatus": RuntimeStatusResult;
  "health.ping": PingResult;
  "query.execute": QueryExecuteResult;
  "query.cancel": QueryCancelResult;
  "connection.upsert": ConnectionUpsertResult;
  "credential.store": CredentialStoreResult;
  "file.open": FileOpenResult;
  "file.close": FileCloseResult;
  "file.bind": FileBindResult;
};

export type BackendNotificationParamsMap = {
  "query.progress": QueryProgressNotification;
  "query.resultChunk": QueryResultChunkNotification;
  "query.completed": QueryCompletedNotification;
  "query.failed": QueryFailedNotification;
  "file.change": FileChangeNotification;
};

export type RequestParamsOf<TMethod extends BackendRequestMethod> =
  BackendMethodParamsMap[TMethod];

export type RequestResultOf<TMethod extends BackendRequestMethod> =
  BackendMethodResultMap[TMethod];

export type NotificationParamsOf<TMethod extends BackendNotificationMethod> =
  BackendNotificationParamsMap[TMethod];
