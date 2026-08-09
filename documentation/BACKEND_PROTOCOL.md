# Queryeer Electron <-> Java Backend Protocol (Draft v1)

This document defines the first protocol contract between Electron and the Java backend.

Status: active draft used by current desktop/backend contract fixtures.

## 1. Scope and goals

- Define a stable request/response and notification protocol over stdio.
- Support startup handshake, health checks, query execution, cancellation, and streaming progress.
- Keep transport details out of domain services through adapter boundaries.

Out of scope in this version:

- authentication/authorization flows
- binary payload channels
- multi-backend federation

## 2. Transport and framing

- Transport: process stdio (Electron main process <-> Java process)
- Encoding: UTF-8 JSON
- Framing: `Content-Length: <bytes>\r\n\r\n` followed by one UTF-8 JSON envelope body
- One JSON envelope per frame

### 2.1 Envelope requirements

- Every envelope MUST include `protocolVersion`.
- Requests MUST include `id`.
- Responses MUST echo the request `id`.
- Notifications MUST NOT include `id`.
- Unknown top-level fields SHOULD be ignored (forward compatibility).

## 3. Protocol versioning

- Initial version: `1.0.0`
- SemVer rules:
  - patch/minor: additive, backward compatible
  - major: breaking changes
- Handshake MUST negotiate a mutually supported major version.

## 4. Envelope schema

### 4.1 Request

```json
{
  "protocolVersion": "1.0.0",
  "type": "request",
  "id": "req-123",
  "method": "queryengine.execute",
  "params": {
    "queryExecutionId": "qx-001",
    "engineId": "payloadbuilder",
    "text": "select 1"
  }
}
```

### 4.2 Success response

```json
{
  "protocolVersion": "1.0.0",
  "type": "response",
  "id": "req-123",
  "result": {
    "accepted": true
  }
}
```

### 4.3 Error response

```json
{
  "protocolVersion": "1.0.0",
  "type": "response",
  "id": "req-123",
  "error": {
    "code": "VALIDATION",
    "message": "engineId is required",
    "details": {
      "field": "engineId"
    }
  }
}
```

### 4.4 Notification

```json
{
  "protocolVersion": "1.0.0",
  "type": "notification",
  "method": "queryengine.progress",
  "params": {
    "queryExecutionId": "qx-001",
    "percent": 25,
    "message": "Parsing"
  }
}
```

## 5. Methods (v1)

## 5.1 `backend.handshake`

Purpose: protocol negotiation and capability declaration.

Request params:

```json
{
  "client": {
    "name": "queryeer-electron",
    "version": "0.1.0"
  },
  "supportedProtocolMajors": [1],
  "requestedCapabilities": [
    "queryengine.execute",
    "queryengine.cancel",
    "queryengine.invoke",
    "queryengine.largeValue.read",
    "queryengine.progress",
    "queryengine.chunkStart",
    "queryengine.chunkRows"
  ]
}
```

## 5.1.1 `backend.runtimeStatus`

Purpose: return backend plugin runtime status snapshot for diagnostics.

Request params:

```json
{
  "includeCapabilities": true
}
```

Success result:

```json
{
  "startedAt": "2026-01-01T00:00:00.000Z",
  "pluginStatuses": [
    {
      "pluginId": "queryengine.payloadbuilder",
      "state": "activated",
      "reason": "Activated"
    }
  ],
  "activatedPluginIds": ["queryengine.payloadbuilder"],
  "providedCapabilities": ["queryengine.execute", "queryengine.invoke"]
}
```

Notes:

- `state` values: `loaded`, `skipped`, `activated`, `failed`, `deactivated`.
- If `includeCapabilities` is false, backend MAY omit `providedCapabilities`.

## 5.1.2 Handshake success result

```json
{
  "server": {
    "name": "queryeer-java-backend",
    "version": "0.1.0"
  },
  "selectedProtocolVersion": "1.0.0",
  "supportedCapabilities": [
    "health.ping",
    "queryengine.execute",
    "queryengine.cancel",
    "queryengine.invoke",
    "queryengine.largeValue.read",
    "queryengine.progress",
    "queryengine.chunkStart",
    "queryengine.chunkRows",
    "queryengine.completed",
    "queryengine.failed"
  ]
}
```

## 5.2 `health.ping`

Purpose: liveness check and latency baseline.

When available, backend may include `javaDebugPort` (notably in dev mode with JDWP enabled).

Backend may also include `jvmHeapUsedBytes` and `jvmHeapMaxBytes` (from `MemoryMXBean.getHeapMemoryUsage()`).

Request params:

```json
{
  "timestamp": "2026-04-19T12:00:00.000Z"
}
```

Success result:

```json
{
  "timestamp": "2026-04-19T12:00:00.000Z",
  "uptimeMs": 15320,
  "javaDebugPort": 53721,
  "jvmHeapUsedBytes": 536870912,
  "jvmHeapMaxBytes": 2147483648
}
```

## 5.3 `queryengine.execute`

Purpose: start query execution asynchronously.

`fileId` is required and identifies the file-scoped backend session used for execution.

Request params:

```json
{
  "queryExecutionId": "qx-001",
  "engineId": "payloadbuilder",
  "fileId": "file-001",
  "text": "select * from foo",
  "engineState": {
    "payloadbuilder": {
      "selectedEnvironmentId": "test",
      "defaultCatalogAlias": "jdbc1",
      "catalogs": {
        "jdbc1": {
          "catalogId": "Jdbc",
          "properties": {
            "database": "appdb"
          }
        }
      }
    }
  },
  "options": {
    "maxRows": 10000,
    "timeoutMs": 120000,
    "intent": "plan.estimated",
    "requestedArtifacts": [
      { "capability": "plan", "kind": "graph" }
    ],
    "dialectOptions": {
      "sqlserverPlanXmlOutput": "suppress"
    }
  }
}
```

Success result:

```json
{
  "accepted": true,
  "queryExecutionId": "qx-001"
}
```

Behavior:

- Execution updates are sent via notifications (`queryengine.progress`, `queryengine.chunkStart`, `queryengine.chunkRows`, `queryengine.completed`, `queryengine.failed`).
- Large cell payloads may be sent as `largeValue` references inside row chunks. Clients fetch full content with `queryengine.largeValue.read` only when needed.
- `engineState` is an engine-owned opaque blob. Core protocol forwards it without interpretation.
- `options.intent` is optional. Omitted or `execute` means normal execution. `plan.estimated` requests a non-executing estimate/explain plan where supported. `plan.actual` requests normal execution plus plan artifacts where supported.
- `options.requestedArtifacts` lets the client request non-row outputs such as `{ "capability": "plan", "kind": "graph" }`.
- `options.dialectOptions` is an optional dialect-owned settings bag. For SQL Server, `sqlserverPlanXmlOutput` may be `suppress` or `include` to control whether raw ShowPlan XML result sets are also streamed as row output alongside graph artifacts.
- Payloadbuilder engine state may include `payloadbuilder.defaultCatalogAlias` to request session default catalog alias.
- Payloadbuilder engine state may include `payloadbuilder.selectedEnvironmentId`. Backend reads environment variables from settings module `core.queryengine.payloadbuilder.environments` (`core.queryengine.payloadbuilder.environments.json`) and injects them into the query session as runtime variables before execution.
- A Payloadbuilder MongoDB catalog instance uses `catalogId: "mongodb"` and carries only `{ "connectionId": "..." }` in its properties. The backend resolves that ID from settings module `core.queryengine.payloadbuilder.mongodb`, setting `core.queryengine.payloadbuilder.mongodb.connections`, and materializes any password secret reference before injecting MongoDB connection properties. Connection strings and credentials are not persisted in file engine state.
- MongoDB tables use two-part `<database>.<collection>` names, for example `select * from mongo#sales.orders`. The catalog is read-only and also exposes `mongo#aggregate('<database>.<collection>', '<pipeline JSON array>')` for raw aggregation pipelines.
- Payloadbuilder maintains a persistent `QuerySession` per file. Sessions persist across queries within the same file, allowing variables and temp tables to be maintained. Environment variables are re-resolved and reset on each query execution to keep them in sync with the current environment selection. The session is cleaned up when the file is closed. If the selected environment changes, the session is recreated to avoid stale variable values. After execution, the backend reflects the current session counter in `queryengine.completed.engineState.payloadbuilder.sessionId` so the UI can display the session identifier in the tab title (e.g., `(1) filename.plbsql`).
- JDBC engine state carries `connectionId`, optional `database`, and optional `sessionId`. When `database` is present, the backend switches the JDBC connection to that catalog (via dialect-specific `setCatalog`/`setSchema`) before executing statements. After execution, the backend reflects the current database back in `queryengine.completed.engineState.database` and the active RDBMS session in `queryengine.completed.engineState.sessionId` so the UI stays synchronized.

## 5.4 `queryengine.cancel`

Purpose: cancel an active query.

Request params:

```json
{
  "queryExecutionId": "qx-001",
  "reason": "user-request"
}
```

Success result:

```json
{
  "accepted": true,
  "queryExecutionId": "qx-001"
}
```

## 5.4b `queryengine.largeValue.read`

Purpose: fetch the full content behind a large cell reference. Normal grid rendering, search, and sort use the preview included in `queryengine.chunkRows`; this request is used for explicit user actions such as opening a value preview.

Request params:

```json
{
  "ref": "550e8400-e29b-41d4-a716-446655440000"
}
```

Success result:

```json
{
  "ref": "550e8400-e29b-41d4-a716-446655440000",
  "logicalType": "json",
  "byteLength": 524288000,
  "contentType": "application/json",
  "content": "{\"large\":true}"
}
```

Rules:

- `ref` values are opaque and scoped to the current backend process.
- Backends SHOULD retain large values until the owning file/session starts a new execution, is closed, or backend cleanup removes the query output.
- Backends MAY store large values on disk in a dedicated cache directory. Because refs are process-local and not durable, the backend SHOULD clear stale spill files from that directory on startup.
- The Java backend defaults to spilling cells above 16 KiB (`queryeer.largeValues.inlineMaxBytes`) and keeping a 16 KiB preview (`queryeer.largeValues.previewMaxChars`).
- Missing refs fail with `LARGE_VALUE_NOT_FOUND`.
- The read result may be large; clients SHOULD call this only after explicit user action.

## 5.2.1 `security.session.open`

Purpose: open backend-side security session context for secret resolution. This is a control-plane request from desktop main to backend.

Request params:

```json
{
  "sessionId": "sec-session-001",
  "vaultPath": "C:/Users/user/AppData/Roaming/Queryeer/security/vault.json",
  "sessionKeyBase64": "<derived-session-key-base64>",
  "vaultUpdatedAt": "2026-04-27T10:00:00.000Z"
}
```

Success result:

```json
{
  "accepted": true
}
```

## 5.2.2 `security.session.close`

Purpose: close backend-side security session and clear in-memory secret/key caches.

Request params:

```json
{
  "sessionId": "sec-session-001",
  "reason": "lock"
}
```

Success result:

```json
{
  "accepted": true
}
```

## 5.2.3 `security.vault.changed`

Purpose: notify backend that vault file metadata changed so resolver cache can invalidate/reload.

Request params:

```json
{
  "vaultPath": "C:/Users/user/AppData/Roaming/Queryeer/security/vault.json",
  "vaultUpdatedAt": "2026-04-27T10:05:00.000Z"
}
```

Success result:

```json
{
  "accepted": true
}
```

Rules:

- Request MUST NOT include secret fields such as `password`, `token`, or `clientSecret`.

## 5.6a `file.open`

Purpose: tell the backend a file has been opened so an engine-bound session + parse cache can be created.

Request params:

```json
{
  "fileId": "file-001",
  "uri": "file:///queries/example.pb",
  "mimeType": "application/x-payloadbuilder",
  "engineBinding": {
    "engineId": "payloadbuilder",
    "connectionId": "conn-001"
  },
  "initialText": "select 1"
}
```

Success result:

```json
{
  "fileId": "file-001",
  "backendVersion": 0
}
```

Rules:

- `engineBinding` is optional. Desktop SHOULD only send `file.open` once an engine binding exists (lazy session rule).
- `initialText` is optional; if absent, backend MUST NOT attempt to parse until a subsequent `file.change` arrives.

## 5.6b `file.close`

Purpose: release backend state for a file (parse tree, engine context, etc.).

Request params:

```json
{ "fileId": "file-001" }
```

Success result:

```json
{ "fileId": "file-001", "accepted": true }
```

> **Note:** `file.bind` has been removed from the protocol. Re-binding is handled automatically by the backend on `queryengine.execute` (auto-upsert). The frontend no longer sends `file.bind` — the backend detects connection changes from `engineState.connectionId` and updates the file session internally.

## 5.6d `queryengine.execute` fileId session binding

`queryengine.execute` params require `fileId`. Backends use `fileId` to bind execution to the open file session and reuse file-scoped state where available.

## 6. Notifications (v1)

## 6.1a `queryengine.chunkStart`

Announces a new result set and its schema before any rows are streamed. Sent once per result set.

```json
{
  "queryExecutionId": "qx-001",
  "resultSetIndex": 0,
  "schema": {
    "columns": [
      { "name": "id", "type": "int" },
      { "name": "name", "type": "string" }
    ],
    "metadata": {
      "connectionTitle": "My Production DB",
      "database": "appdb"
    }
  }
}
```

Rules:

- `resultSetIndex` is zero-based and monotonically increasing per `queryExecutionId`.
- `schema.columns[*].type` MUST be one of: `string`, `boolean`, `int`, `long`, `decimal`, `float`, `double`, `datetime`, `datetimeoffset`, `object`, `array`, `table`, `any`, `null`.
- `schema.metadata` is optional. When present, it contains arbitrary string key/value pairs describing the result set (for example connection title, database name). The frontend displays these above the table grid.
- Backends with richer/native type systems MUST map to this canonical set before emitting notifications.

## 6.1 `queryengine.progress`

```json
{
  "queryExecutionId": "qx-001",
  "percent": 40,
  "message": "Executing"
}
```

## 6.2 `queryengine.chunkRows`

```json
{
  "queryExecutionId": "qx-001",
  "resultSetIndex": 0,
  "rows": [
    [1, "alpha"],
    [
      2,
      {
        "kind": "largeValue",
        "logicalType": "json",
        "byteLength": 524288000,
        "preview": "{\"payload\":...",
        "ref": "550e8400-e29b-41d4-a716-446655440000",
        "contentType": "application/json"
      }
    ]
  ]
}
```

Rules:

- `resultSetIndex` refers to a result set previously announced by `queryengine.chunkStart`.
- Rows are positional arrays aligned to `schema.columns`.
- Normal scalar cells are JSON `null`, string, number, or boolean values.
- Complex object/array/table cells SHOULD be emitted as canonical JSON text when inline.
- Cells larger than the backend inline threshold SHOULD be emitted as `largeValue` refs.
- `largeValue.preview` is the only value used for normal grid render/search/sort.
- Clients fetch full `largeValue` content with `queryengine.largeValue.read` only on explicit user action.

## 6.3 `queryengine.completed`

```json
{
  "queryExecutionId": "qx-001",
  "metrics": {
    "durationMs": 412,
    "rowCount": 2
  },
  "engineState": {
    "payloadbuilder": {
      "sessionId": "1",
      "catalogs": {
        "jdbc1": {
          "properties": {
            "database": "appdb_reporting"
          }
        }
      }
    }
  }
}
```

## 5.4a `queryengine.invoke`

Purpose: execute engine-specific operations that are not query execution (for example completion, schema lookup, metadata fetch, diagnostics, or catalog operations).

Request params:

```json
{
  "engineId": "payloadbuilder",
  "fileId": "file-001",
  "action": "engine.capabilities"
}
```

Success result:

```json
{
  "result": {
    "actions": ["engine.capabilities", "sql.complete", "sql.hover", "sql.symbolAtPosition", "payloadbuilder.es.listIndices", "payloadbuilder.kafka.listTopics"],
    "catalogIds": ["jdbc", "elasticsearch", "kafka", "mongodb", "filesystem", "http"]
  },
  "features": ["rows", "plan"],
  "artifacts": [
    {
      "id": "plan-001",
      "capability": "plan",
      "kind": "graph",
      "title": "Query plan",
      "graph": {
        "id": "query-plan-001",
        "title": "Query plan",
        "layout": {
          "direction": "right-left"
        },
        "vertices": [
          {
            "id": "select",
            "label": "SELECT",
            "kind": "operator",
            "properties": [
              {
                "id": "operator",
                "label": "Operator",
                "properties": [
                  { "id": "physical", "label": "Physical operator", "value": "SELECT", "important": true }
                ]
              }
            ]
          }
        ],
        "edges": []
      }
    }
  ]
}
```

Rules:

- `action` is engine-owned and namespaced by convention (for example `payloadbuilder.*`, `jdbc.*`).
- `payload` and `result` are opaque to the core protocol and transported as `unknown` JSON.
- Backends SHOULD return `ENGINE_NOT_FOUND` for unknown `engineId` and `VALIDATION` for unsupported or invalid actions.

SQL semantic action `sql.complete` request payload:

```json
{
  "fileId": "file-001",
  "version": 42,
  "text": "select * from sales.dbo.ord",
  "cursor": { "line": 1, "column": 27 },
  "connectionId": "conn-001",
  "database": "master",
  "engineState": {
    "payloadbuilder": {
      "defaultCatalogAlias": "jdbc1",
      "catalogs": {
        "jdbc1": { "catalogId": "Jdbc", "properties": { "connectionId": "conn-001" } }
      }
    }
  },
  "trigger": { "kind": "triggerCharacter", "character": "." },
  "limits": { "maxItems": 100 }
}
```

SQL semantic action `sql.complete` result:

```json
{
  "items": [
    {
      "label": "orders",
      "kind": "table",
      "detail": "Payloadbuilder table",
      "documentation": "Optional markdown/plain text documentation",
      "sortText": "orders",
      "filterText": "orders",
      "insertText": "orders",
      "insertTextFormat": "plain",
      "commitCharacters": ["."],
      "replaceRange": { "startLine": 1, "startColumn": 19, "endLine": 1, "endColumn": 27 },
      "source": "jdbc1"
    }
  ],
  "isIncomplete": false,
  "context": {
    "fileId": "file-001",
    "requestedVersion": 42,
    "snapshotVersion": 42,
    "usedFallback": false
  }
}
```

SQL semantic action `sql.hover` request payload:

```json
{
  "fileId": "file-001",
  "text": "select * from sales.dbo.orders",
  "cursor": { "line": 1, "column": 25 },
  "connectionId": "conn-001",
  "database": "master",
  "engineState": {
    "payloadbuilder": {
      "defaultCatalogAlias": "jdbc1",
      "catalogs": {
        "jdbc1": { "catalogId": "Jdbc", "properties": { "connectionId": "conn-001" } }
      }
    }
  }
}
```

SQL semantic action `sql.hover` result, or `null` when no hover is resolved:

```json
{
  "contents": [
    { "value": "### orders\n\nPayloadbuilder table", "isTrusted": false }
  ],
  "context": "TABLE_REFERENCE",
  "token": "orders"
}
```

SQL semantic action `sql.symbolAtPosition` request payload:

```json
{
  "fileId": "file-001",
  "text": "select * from sales.dbo.orders",
  "cursor": { "line": 1, "column": 25 },
  "connectionId": "conn-001",
  "database": "master",
  "engineState": {
    "payloadbuilder": {
      "defaultCatalogAlias": "jdbc1",
      "catalogs": {
        "jdbc1": { "catalogId": "Jdbc", "properties": { "connectionId": "conn-001" } }
      }
    }
  }
}
```

SQL semantic action `sql.symbolAtPosition` result, or `null` when no symbol is resolved:

```json
{
  "kind": "table",
  "name": "dbo.orders",
  "fullName": "sales.dbo.orders",
  "detail": "TABLE",
  "attributes": {
    "database": "sales",
    "schema": "dbo",
    "name": "orders"
  }
}
```

`name` is the legacy display/reference name used by existing Symbol Actions. `fullName` is the most complete resolved object name available. `attributes.name` is the unqualified object name.

Rules:

- `engineState` is an engine-owned opaque blob. Core protocol forwards it without interpretation.
- SQL semantic action `connectionId` and `database` fields are used by JDBC; `engineState` carries the same engine-owned state shape used by `queryengine.execute` and is used by Payloadbuilder catalog developer tools.
- Desktop injects current execution context provider state into semantic action payloads before sending `queryengine.invoke`.
- Payloadbuilder semantic actions only query metadata for catalog providers that explicitly opt in through `PayloadbuilderCatalogSqlEditorServices`. The Payloadbuilder JDBC catalog delegates to the shared JDBC SQL editor services; the generic built-in implementation for other catalogs uses Payloadbuilder catalog system tables/functions and must not query non-opted-in catalogs.
- Engines SHOULD only return changed values in patches.
- `features` declares output capabilities such as `rows` and `plan`. If omitted, clients use `rows` by convention.
- `artifacts` carries non-row output payloads. Graph artifacts MUST follow the `GraphDocument` contract below.

### 6.3.1 Graph artifacts

Backends and dialects MUST convert native graph-like formats into this protocol contract before sending them to the frontend. For example, the SQL Server dialect will later convert ShowPlan XML into this shape. The frontend renderer does not parse engine-native formats.

```json
{
  "id": "plan-001",
  "capability": "plan",
  "kind": "graph",
  "title": "Query plan",
  "graph": {
    "id": "query-plan-001",
    "title": "Query plan",
    "description": "Optional description",
    "layout": {
      "direction": "top-bottom",
      "rankSpacing": 90,
      "nodeSpacing": 70
    },
    "vertices": [
      {
        "id": "node-1",
        "label": "Index Seek",
        "kind": "operator",
        "style": {
          "shape": "rounded",
          "backgroundColor": "#1f2937",
          "borderColor": "#60a5fa",
          "iconUrl": "file:///icons/index.svg"
        },
        "properties": [
          {
            "id": "estimates",
            "label": "Estimates",
            "properties": [
              { "id": "rows", "label": "Estimated rows", "value": 42, "important": true },
              { "id": "cost", "label": "Estimated cost", "value": 0.12, "important": true }
            ]
          }
        ],
        "overlays": [
          { "id": "parallel", "kind": "parallel", "label": "Parallel", "title": "Operator executed in parallel" },
          { "id": "warning", "kind": "warning", "label": "Warnings", "title": "Plan warnings are available" }
        ],
        "actions": [
          { "id": "copy-node", "label": "Copy node" }
        ]
      }
    ],
    "edges": [
      {
        "id": "edge-1",
        "sourceVertexId": "node-1",
        "targetVertexId": "node-2",
        "label": "rows",
        "style": {
          "shape": "smoothstep",
          "color": "#94a3b8",
          "width": 2,
          "markerEnd": "arrow"
        }
      }
    ]
  }
}
```

Rules:

- `artifact.kind` MUST be `graph` for graph artifacts.
- `artifact.capability` identifies which output contributor should render the artifact. Query plans use `plan`.
- `graph.vertices[*].id` and `graph.edges[*].id` MUST be unique within the graph.
- Edge endpoints MUST reference existing vertex ids.
- Property values are scalar: string, number, boolean, or null. Backends SHOULD stringify structured native values in v1.
- Tooltip properties are selected by `important: true`; the full property set is shown in the graph properties panel.
- Vertex overlays are compact badges rendered on top of a vertex. Known `kind` values are `parallel`, `warning`, `info`, and `custom`; unknown values SHOULD be rendered as custom informational badges.

## 6.4a `file.change`

Renderer → backend notification. Carries the latest buffer text so the backend can refresh its parse tree.

```json
{
  "fileId": "file-001",
  "version": 3,
  "text": "select id, name from foo"
}
```

Rules:

- Debouncing lives on the renderer (mediator); backend MUST tolerate out-of-order or rapid bursts.
- `version` MUST be monotonically increasing per `fileId`; backend MAY drop notifications with a stale `version`.

## 6.4b `settings.module.changed`

Renderer → backend notification. Tells the backend that a settings module has been modified so it can invalidate its in-memory cache.

```json
{
  "moduleId": "core.editor.texteditor",
  "version": 7
}
```

Rules:

- `version` is a monotonic change counter incremented by the frontend on every modification.
- Backend MUST remove the cached module entry for `moduleId`; the next `ConfigService.getModule()` call re-reads from disk.
- Backend MUST NOT reject or drop the notification for an unknown `moduleId`.

## 6.4 `queryengine.failed`

```json
{
  "queryExecutionId": "qx-001",
  "error": {
    "code": "VALIDATION",
    "message": "Parse error near 'from'",
    "details": {
      "line": 3,
      "column": 15
    }
  }
}
```

Rules:

- For errors that can be associated with query text positions, backend SHOULD include 1-based `details.line` and `details.column`.
- `details.line`/`details.column` are relative to the executed query text payload.
- Backend MAY include additional engine/dialect-specific details alongside location keys.
- SQL Server dialect implementations MUST resolve `com.microsoft.sqlserver.*` classes lazily when extracting optional error details, because the SQL Server driver JAR may be absent until runtime connection use.

## 7. Error codes

- `VALIDATION`: malformed/invalid request
- `METHOD_NOT_FOUND`: unknown method
- `UNSUPPORTED_PROTOCOL`: no compatible protocol major
- `ENGINE_NOT_FOUND`: requested engine unavailable
- `QUERY_NOT_FOUND`: cancellation or progress target missing
- `LARGE_VALUE_NOT_FOUND`: requested large-value reference is unavailable
- `TIMEOUT`: operation exceeded deadline
- `CANCELLED`: operation canceled
- `SECURITY_SESSION_CLOSED`: operation required an open security session but the vault is locked
- `INTERNAL`: unhandled backend exception

Error payload schema:

```json
{
  "code": "VALIDATION",
  "message": "human readable",
  "details": {}
}
```

## 8. Timeouts and retry guidance

- `backend.handshake`: fail if no response within 10s
- `health.ping`: soft timeout 3s, hard timeout 10s
- `queryengine.execute`: request timeout only for acceptance; completion comes via notifications
- On backend process crash, gateway restarts with capped retries (for example 3 retries with backoff)

## 9. Correlation identifiers

- `id`: request/response correlation identifier
- `queryExecutionId`: long-running query lifecycle identifier
- Gateway SHOULD log both for every envelope it sends/receives.

## 10. Security constraints

- Renderer can only call whitelisted methods exposed by preload API.
- Gateway validates method name and params schema before sending to Java.
- Java validates again at protocol adapter boundary.
- No arbitrary code evaluation or dynamic method invocation.
- Protocol payloads SHOULD avoid carrying raw secrets (passwords, tokens, API keys) where a stable id/handle can be used instead.
- Preferred payload secret marker is `{ "secretRef": "<ref-id>" }` at the value position.
- Backend resolves structured secret wrappers (`{ "secretRef": "<ref-id>" }`) lazily, only when a provider actually needs the plaintext value (for example right before opening a JDBC connection).
- If the security session is closed and a secret must be resolved, the backend returns `SECURITY_SESSION_CLOSED`. The frontend MAY prompt the user to unlock the vault and retry the operation.
- `security.*` control requests MUST never log sensitive values (`sessionKeyBase64`, secret refs, decrypted plaintext).
- `security.session.open` transports a derived session key and MUST NOT transport raw master password.
- Desktop and backend diagnostic logs MUST redact sensitive fields before persistence/display.
- Sensitive field names include (non-exhaustive): `password`, `secret`, `token`, `apiKey`, `clientSecret`, `authorization`, `connectionString`, `credential`.

## 11. Sequence examples

### 11.1 Startup

1. Electron main starts Java process.
2. Electron sends `backend.handshake`.
3. Java responds with selected version and capabilities.
4. Electron marks backend status as healthy and starts ping checks.

### 11.2 Execute and stream

1. Electron sends `queryengine.execute` (`queryExecutionId=qx-001`).
2. Java responds `accepted=true`.
3. Java emits `queryengine.progress`, `queryengine.chunkStart`, and one or more `queryengine.chunkRows` notifications.
4. Java emits `queryengine.completed`.

### 11.3 Cancel

1. Electron sends `queryengine.cancel` (`queryExecutionId=qx-001`).
2. Java responds `accepted=true`.
3. Java emits `queryengine.failed` with `code=CANCELLED` or emits `queryengine.completed` with partial results, based on engine semantics.

## 12. Implementation checklist

- Add TypeScript types in `queryeer-desktop/src/contracts/backend/*` from this spec.
- Implement gateway serializer/parser with `Content-Length` framing.
- Implement Java protocol adapter with the same schema.
- Add contract tests with golden JSON fixtures for each method and notification.
- Add structured logging format that includes `id` and `queryExecutionId`.

## 12.1 Current implementation note

Current Java stdio scaffold implementation status:

- `backend.handshake` implemented
- `health.ping` implemented
- `queryengine.execute` implemented (mocked progressive notifications); `fileId` is required and validated
- `queryengine.cancel` implemented (mocked cancellation notification)
- `backend.runtimeStatus` implemented
- JDBC provider actions include `jdbc.schema.snapshot` (latest cached snapshot by `connectionId` and optional `scope`), `jdbc.schema.refresh` (synchronous refresh + cache persist with scope-aware behavior), `sql.complete` (schema-aware SQL completions from the cached snapshot), `sql.symbolAtPosition` (returns symbol `name`, `fullName`, `detail`, and attributes for table/view names under the cursor), and `sql.hover` (returns pre-formatted markdown for table/column names under the cursor, resolved from H2 DEEP snapshot only)
- Payloadbuilder provider actions include `sql.complete`, `sql.hover`, and `sql.symbolAtPosition`. These actions are backed by opt-in catalog developer tools; built-in `jdbc` delegates to the shared JDBC schema developer-tools service, while `elasticsearch`, `kafka`, `mongodb`, `filesystem`, and `http` opt into the generic system-table implementation.
- JDBC provider action `jdbc.schema.fetch` resolves connection settings by `connectionId` only; fetch payload supports `connectionId`, `scope`, and optional `target` (no inline connection overrides).
- JDBC provider action `jdbc.schema.status` returns crawl status/statistics for all configured connections (or a single connection when `connectionId` is provided). Each status entry includes: `connectionId`, `connectionTitle`, `scope` (`top`|`deep`), `databaseKey` (null for top), `lastSuccessAt`, `lastAttemptAt`, `lastFailureAt`, `nextDueAt`, `consecutiveFailures`, `usageScore`, `enabled`, `objectCount`, `lastError`.
- JDBC provider action `jdbc.connection.test` accepts `{ "connectionId": "..." }` whole body for a connection.
- JDBC provider action `jdbc.connection.sessions` returns file-scoped JDBC session metadata (`fileId`, `connectionId`, optional `sessionId`, optional `lastAccessTimeMs`, `status=alive|dead`) for UI session badges and connection health views.
- `file.open` / `file.close` request handlers implemented against `DefaultFileRegistry`; JDBC provider registers `FileSessionHandler` for file-scoped connection lifecycle and cleanup. `file.bind` has been removed — backend auto-upserts on `queryengine.execute`.
- `file.change` notification handler implemented

JDBC file-session cleanup configuration:

- `queryeer.jdbc.fileSession.idleTimeoutMs` (default: `1800000`) controls idle lifetime before a file-scoped JDBC session is evicted.
- `queryeer.jdbc.fileSession.reaperIntervalMs` (default: min(idleTimeoutMs, 300000)) controls how often idle sessions are scanned.
- Evicted sessions are exposed as transient `status=dead` entries in `jdbc.connection.sessions` and automatically removed after a short TTL.
- `queryeer.jdbc.schemaCrawl.intervalMs` (default: `300000`) controls periodic schema crawl loop interval when security session is open.

Backend bootstrap configuration (desktop -> backend process env -> backend config service):

- `QUERYEER_APP_DIR` maps to `queryeer.app.dir`.
- `QUERYEER_SETTINGS_DIR` maps to `queryeer.settings.dir`.
- `QUERYEER_SETTINGS_PATH` maps to `queryeer.settings.path`.
- Desktop passes `queryeer.plugins.dir` as `${queryeer.app.dir}/plugins` for per-user external plugins.
- Desktop passes `queryeer.plugins.safeMode=true` when launched with `--safe-mode`; backend then skips external plugin activation and still loads builtins.
- Desktop passes `queryeer.plugins.disabledIds=<comma-separated plugin ids>` when the managed plugin lockfile has disabled external plugins; backend filters only external plugins by this list after builtin discovery.

JDBC startup preload behavior:

- On plugin activation, backend JDBC reads module settings from `queryeer.settings.path` (if present) or `${queryeer.settings.dir}/core.queryengine.jdbc.json`.
- Backend loads `values["core.queryengine.jdbc.connections"]`, applies the same normalization rules as desktop (required `connectionId`/`url`, default `dialectId="jdbc"`, default `enabled=true`, duplicate IDs dropped), and preloads enabled connections into backend runtime registry.
- Unknown per-connection settings fields (for example `color`) are ignored by backend contract deserialization.
- JDBC crawl subsystem starts at plugin activation, but crawl execution is gated until backend receives `security.session.open` from desktop main.
- On `security.session.close`, schema crawl loop pauses until a new `security.session.open` arrives.
- `jdbc.schema.refresh` requires an open security session; otherwise backend returns a validation error.
- `jdbc.schema.refresh` supports `scope=top|deep` (`top` default). `scope=deep` requires `target.schema` (`target.database` optional).
- Active connections are background-crawled on `top` scope (databases/schemas) while `deep` scope (tables/columns) is refreshed only on explicit triggers.
- For JDBC schema trees, `column` nodes include normalized attributes from foundation mapping: `type` (lowercase fallback `unknown`), optional `nullable`, optional `ordinal`, and optional type qualifiers `size`, `precision`, `scale` when applicable for the dialect/type.
- JDBC schema tree uses folder-based organization under tables/views: each table resolves to `columns_folder` and `indexes_folder` children. The DEEP crawl expands both folders inline so column and index data is available for completion without live JDBC queries.
- Index nodes (`kind: "index"`) carry attributes: `columns` (comma-separated column list), `unique` (boolean), and `primaryKey` (boolean when the index backs a primary key constraint). SQL Server dialect uses native `sys.indexes`/`sys.index_columns` views; other dialects use `DatabaseMetaData.getIndexInfo()`.

Current integration notes:

- Desktop default mode remains `mock-stdio`; `QUERYEER_BACKEND_STDIO=1` enables stdio-process mode.
- Backend builtin query engines are discovered from real `plugin.json` manifests under `plugins/builtin` in dev mode. Dev manifests point at backend module `target/classes` plus Maven-generated `target/queryeer-plugin-deps.txt` files.
- External plugin discovery uses Queryeer's per-user managed plugins directory (`${queryeer.app.dir}/plugins`) for both backend (runner side) and frontend (desktop side). Builtin plugins are discovered from packaged `plugins/builtin` manifests and are not user-managed plugins. External enablement is persisted in `${queryeer.settings.dir}/plugins-lock.json` and currently applies on restart.

See Java transport implementation:

- `queryeer-backend/backend-transport-stdio/src/main/java/com/queryeer/backend/transport/stdio/StdioTransportServer.java`

## 13. Contract synchronization rule

When protocol shapes change, update both contract implementations in the same session:

- TypeScript contracts: `queryeer-desktop/src/contracts/backend/*`
- Java contracts: `queryeer-backend/backend-contract/*`

Then update this protocol document to reflect the final agreed shape.

## 14. Tree Actions (frontend extension point)

Tree Actions are a rule-based context menu system for the JDBC navigation tree. They are purely a frontend feature — no backend contract changes are needed. Actions compose SQL templates and execute via the existing JDBC engine infrastructure.

### 14.1 Architecture

Tree Actions follow the same pattern as Symbol Actions and Table Actions:

- **Type definition**: `core.queryengine.jdbc/tree-action-types.ts`
- **Registry**: `core.queryengine.jdbc/tree-action-registry.ts` (singleton with change events)
- **Provider**: `core.queryengine.jdbc/tree-action-provider.ts` (registers contributions to `JdbcTreeContextMenuRegistry`)
- **Templates**: `core.queryengine.jdbc/tree-action-template-registry.ts` (dialect plugins contribute pre-built actions)
- **Settings**: `core.queryengine.jdbc/tree-action-settings.tsx` (settings UI editor)
- **Persistence**: `core.queryengine.jdbc.treeActions` setting (JSON array stored in settings)

### 14.2 TreeAction type

```typescript
type TreeActionMode = "execute" | "render";
type TreeActionOutputTarget = "output" | "clipboard" | "newQuery";

type TreeAction = {
  id: string;
  label: string;
  when: string;              // Expression evaluated against merged context
  query: string;             // SQL template with ${...} interpolation
  mode: TreeActionMode;      // execute=run query, render=interpolate only
  outputTarget: TreeActionOutputTarget;
  outputId?: string;         // For execute+output: route to specific output contributor
  order?: number;
};
```

### 14.3 Mode semantics

- `execute` — Interpolate the query template, then execute SQL against the **tree node's connection/database** (not the active file). A temporary untitled file is created to host the execution context.
- `render` — Interpolate the query template only, without executing. Output goes to the target (clipboard, new query file, or output panel).

### 14.4 Output target semantics

- `output` — Results go to an output panel. Default is the selected primary output; `outputId` can route to a specific contributor (e.g., `core.queryengine.output.text`).
- `clipboard` — Rendered text is copied to the system clipboard.
- `newQuery` — Rendered text is opened in a new untitled `.sql` file.

### 14.5 Context chain integration

Tree Actions integrate with the shared `ContextChain` (same system used by editors for `editorFocus`, `languageId`, etc.). When a tree node is clicked, `JdbcNavigationTree` registers a `TREE_NODE`-priority scope containing `node.*` variables. The `TreeActionProvider` evaluates `when` expressions against `getCommandContext()` which includes this scope, so `node.kind`, `node.dialectId`, etc. are available without manual merging.

### 14.6 When expression context variables

The following variables are available in `when` expressions via the context chain:

| Variable | Type | Description |
|----------|------|-------------|
| `node.kind` | string | Kind of tree node (e.g. `procedure`, `table`, `view`, `column`, `database`) |
| `node.name` | string | Name of the tree node (e.g. `sp_help`) |
| `node.fullName` | string | Fully qualified name (e.g. `dbo.sp_help`) |
| `node.nodeType` | string | `container`, `structural`, `folder`, `object`, `property` |
| `node.connectionId` | string | Connection UUID |
| `node.dialectId` | string | SQL dialect of the connection (e.g. `sqlserver`, `postgresql`) |
| `node.attributes.*` | any | Dynamic node attributes (e.g. `node.attributes.schema`) |
| `activeFile.*` | any | All standard active file context variables |
| `backendHealthy` | boolean | Backend health status |

### 14.7 Query template interpolation

Query templates use `${...}` syntax with the same `node.*` context variables:

```
exec sp_helptext '${node.fullName}'
select top 100 * from ${node.fullName}
```

### 14.8 Execution context

When `mode: "execute"`, the query runs against the tree node's connection:

- `engineState.connectionId` is set from `node.connectionId`
- For database nodes, `engineState.database` is set from `node.attributes.catalog` or `node.name`
- The engine resolver routes to `jdbc` based on the file's MIME type (`application/sql`)

### 14.9 Dialect template contributions

Dialect plugins (e.g., `core.queryengine.jdbc.sqlserver`) register pre-built action templates:

```typescript
registerTreeActionTemplate({
  id: "core.queryengine.jdbc.treeAction.sqlserver.spHelptext",
  title: "SQL Server: Procedure Definition to Text",
  action: {
    label: "Definition to Text",
    when: "node.dialectId == 'sqlserver' && node.kind == 'procedure'",
    query: "exec sp_helptext '${node.fullName}'",
    mode: "execute",
    outputTarget: "output",
    outputId: "core.queryengine.output.text"
  }
});
```

### 14.10 Settings location

Tree Actions are configured under: **Query Engine > JDBC > Tree Actions** in the settings UI.
