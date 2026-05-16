import type { BackendError } from "./ErrorCode.js";
import type {
  BackendNotificationMethod,
  BackendRequestMethod
} from "./Methods.js";
import type { GraphDocument } from "../graph/GraphDocument.js";

export type Capability =
  | "backend.runtimeStatus"
  | "security.session.open"
  | "security.session.close"
  | "security.vault.changed"
  | "health.ping"
  | "queryengine.execute"
  | "queryengine.cancel"
  | "queryengine.invoke"
  | "queryengine.progress"
  | "queryengine.chunkStart"
  | "queryengine.chunkRows"
  | "queryengine.completed"
  | "queryengine.failed"
  | "file.open"
  | "file.close"
  | "file.change"
  | "settings.module.changed"
  | "about.pluginChangelogs";

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
  javaDebugPort?: number;
  jvmHeapUsedBytes?: number;
  jvmHeapMaxBytes?: number;
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
  fileId: string;
  text: string;
  engineState?: unknown;
  options?: QueryExecuteOptions;
};

export type QueryExecutionIntent = "execute" | "plan.estimated" | "plan.actual";

export type QueryRequestedArtifact = {
  capability: "plan" | string;
  kind: "graph" | string;
};

export type QueryExecuteOptions = {
  maxRows?: number;
  timeoutMs?: number;
  intent?: QueryExecutionIntent;
  requestedArtifacts?: QueryRequestedArtifact[];
  dialectOptions?: Record<string, unknown>;
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
  error?: { code: string; message: string };
};

export type JdbcSchemaRefreshPayload = {
  connectionId: string;
  scope?: "top" | "deep";
  target?: {
    database?: string;
    schema?: string;
  };
};

export type JdbcSchemaStatusPayload = {
  connectionId?: string;
};

export type JdbcSchemaCrawlStatus = {
  connectionId: string;
  connectionTitle: string;
  scope: "top" | "deep";
  databaseKey: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastFailureAt: string | null;
  nextDueAt: string | null;
  consecutiveFailures: number;
  usageScore: number;
  enabled: boolean;
  objectCount: number;
  lastError: string | null;
};

export type JdbcEngineState = {
  connectionId?: string;
  database?: string;
  sessionId?: string;
};

export type PayloadbuilderEngineState = {
  payloadbuilder?: {
    defaultCatalogAlias?: string;
    selectedEnvironmentId?: string;
    catalogs?: Record<string, { catalogId: string; properties?: Record<string, unknown> }>;
  };
};

export type JdbcConnectionSessionStatus = "alive" | "dead";

export type JdbcConnectionSessionEntry = {
  fileId: string;
  connectionId: string;
  sessionId?: string;
  lastAccessTimeMs?: number;
  status: JdbcConnectionSessionStatus;
};

export type ConnectionUpsertParams = {
  connectionId?: string;
  engineId: string;
  name: string;
  connection?: unknown;
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
    metadata?: Record<string, string>;
  };
};

export type OutputSeverity = "info" | "error";

export type MessagePayload = {
  severity: OutputSeverity;
  message: string;
  line?: number;
  column?: number;
  details?: Record<string, unknown>;
};

export type QueryChunkRowsNotification = {
  queryExecutionId: string;
  resultSetIndex: number;
  rows: unknown[][];
  messages?: MessagePayload[];
};

export type QueryCompletedNotification = {
  queryExecutionId: string;
  metrics?: {
    durationMs?: number;
    rowCount?: number;
  };
  /** Which output capabilities this result provides, e.g. ["rows"], ["rows", "plan"]. Absent = ["rows"] by convention. */
  features?: string[];
  artifacts?: QueryOutputArtifact[];
  engineState?: unknown;
};

export type QueryOutputArtifact = {
  id: string;
  capability: string;
  kind: "graph";
  title?: string;
  graph: GraphDocument;
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

export type FileChangeNotification = {
  fileId: string;
  version: number;
  text: string;
  uri?: string;
  mimeType?: string;
  engineBinding?: FileEngineBindingParams;
};

export type SymbolAtPositionInvokePayload = {
  fileId?: string;
  text?: string;
  cursor: { line: number; column: number };
  connectionId?: string;
  database?: string;
};

export type SqlCompleteInvokePayload = {
  fileId?: string;
  version?: number;
  text?: string;
  connectionId?: string;
  database?: string;
  cursor: { line: number; column: number };
  trigger?: { kind: "invoke" | "triggerCharacter" | "retrigger"; character?: string };
  limits?: { maxItems?: number };
};

export type SqlCompletionItem = {
  label: string;
  kind: string;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: "plain" | "snippet";
  commitCharacters?: string[];
  replaceRange?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  source?: string;
};

export type SqlCompleteInvokeResult = {
  items: SqlCompletionItem[];
  isIncomplete: boolean;
  context?: {
    fileId?: string;
    requestedVersion?: number;
    snapshotVersion?: number;
    usedFallback?: boolean;
  };
};

export type SqlHoverInvokePayload = {
  fileId?: string;
  text?: string;
  connectionId?: string;
  database?: string;
  cursor: { line: number; column: number };
};

export type SqlHoverMarkdownContent = {
  value: string;
  isTrusted?: boolean;
};

export type SqlHoverInvokeResult = {
  contents: SqlHoverMarkdownContent[];
  context?: string;
  token?: string;
};

export type SettingsModuleChangedNotification = {
  moduleId: string;
  version: number;
};

export type AboutPluginChangelog = {
  pluginId: string;
  pluginName: string;
  version: string;
  changelog: string;
};

export type AboutPluginChangelogsResult = {
  plugins: AboutPluginChangelog[];
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
  "queryengine.invoke": EngineInvokeParams;
  "file.open": FileOpenParams;
  "file.close": FileCloseParams;
  "about.pluginChangelogs": Record<string, never>;
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
  "queryengine.invoke": EngineInvokeResult;
  "file.open": FileOpenResult;
  "file.close": FileCloseResult;
  "about.pluginChangelogs": AboutPluginChangelogsResult;
};

export type BackendNotificationParamsMap = {
  "queryengine.progress": QueryProgressNotification;
  "queryengine.chunkStart": QueryChunkStartNotification;
  "queryengine.chunkRows": QueryChunkRowsNotification;
  "queryengine.completed": QueryCompletedNotification;
  "queryengine.failed": QueryFailedNotification;
  "file.change": FileChangeNotification;
  "settings.module.changed": SettingsModuleChangedNotification;
};

export type RequestParamsOf<TMethod extends BackendRequestMethod> =
  BackendMethodParamsMap[TMethod];

export type RequestResultOf<TMethod extends BackendRequestMethod> =
  BackendMethodResultMap[TMethod];

export type NotificationParamsOf<TMethod extends BackendNotificationMethod> =
  BackendNotificationParamsMap[TMethod];
