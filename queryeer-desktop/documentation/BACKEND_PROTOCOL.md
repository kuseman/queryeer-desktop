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
- Framing: newline-delimited JSON objects (NDJSON)
- One JSON envelope per line

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
    "engine.invoke",
    "queryengine.progress",
    "queryengine.resultChunk"
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
      "pluginId": "query.payloadbuilder",
      "state": "activated",
      "reason": "Activated"
    }
  ],
  "activatedPluginIds": ["query.payloadbuilder"],
  "providedCapabilities": ["queryengine.execute", "engine.invoke"]
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
    "engine.invoke",
    "queryengine.progress",
    "queryengine.resultChunk",
    "queryengine.completed",
    "queryengine.failed"
  ]
}
```

## 5.2 `health.ping`

Purpose: liveness check and latency baseline.

When available, backend may include `javaDebugPort` (notably in dev mode with JDWP enabled).

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
  "javaDebugPort": 53721
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
  "parameters": [],
  "engineState": {
    "payloadbuilder": {
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
    "timeoutMs": 120000
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

- Execution updates are sent via notifications (`queryengine.progress`, `queryengine.resultChunk`, `queryengine.completed`, `queryengine.failed`).
- `engineState` is an engine-owned opaque blob. Core protocol forwards it without interpretation.
- Payloadbuilder engine state may include `payloadbuilder.defaultCatalogAlias` to request session default catalog alias.

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

## 5.5 `connection.upsert`

Purpose: create/update engine-owned connection payload. Transport treats `connection` as opaque.

Request params:

```json
{
  "connectionId": "conn-001",
  "engineId": "jdbc",
  "name": "Local Postgres",
  "connection": {
    "dialectId": "postgres",
    "url": "jdbc:postgresql://localhost:5432/appdb",
    "username": "app_user",
    "password": {
      "secretRef": "sec_abc123"
    }
  }
}
```

Success result:

```json
{
  "connectionId": "conn-001",
  "version": 2
}
```

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

## 5.6c `file.bind`

Purpose: attach or rebind a file to an engine/connection after initial open.

Request params:

```json
{
  "fileId": "file-001",
  "engineId": "payloadbuilder",
  "connectionId": "conn-001"
}
```

Success result:

```json
{
  "fileId": "file-001",
  "engineId": "payloadbuilder",
  "backendVersion": 1
}
```

Rules:

- If the file was previously unbound, backend creates the engine session on bind.
- If the file was already bound and engine/connection changed, backend closes old engine-scoped file resources and opens a new session for the updated binding.
- JDBC file-scoped SQL sessions are released on rebind, on `file.close`, or by idle timeout reaper.

## 5.6d `queryengine.execute` fileId session binding

`queryengine.execute` params require `fileId`. Backends use `fileId` to bind execution to the open file session and reuse file-scoped state where available.

## 6. Notifications (v1)

## 6.1 `queryengine.progress`

```json
{
  "queryExecutionId": "qx-001",
  "percent": 40,
  "message": "Executing"
}
```

## 6.2 `queryengine.resultChunk`

```json
{
  "queryExecutionId": "qx-001",
  "chunkIndex": 0,
  "schema": {
    "columns": [
      { "name": "id", "type": "int" },
      { "name": "name", "type": "string" }
    ]
  },
  "rows": [
    [1, "alpha"],
    [2, "beta"]
  ],
  "isLastChunk": false
}
```

Rules:

- `schema` SHOULD be present in first chunk and MAY be omitted in subsequent chunks.
- `chunkIndex` MUST be monotonically increasing per `queryExecutionId`.
- `schema.columns[*].type` MUST be one of: `string`, `boolean`, `int`, `long`, `decimal`, `float`, `double`, `datetime`, `datetimeoffset`, `object`, `array`, `table`, `any`, `null`.
- Backends with richer/native type systems MUST map to this canonical set before emitting notifications.

## 6.3 `queryengine.completed`

```json
{
  "queryExecutionId": "qx-001",
  "metrics": {
    "durationMs": 412,
    "rowCount": 2
  },
  "engineStatePatch": {
    "payloadbuilder": {
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

## 5.4a `engine.invoke`

Purpose: execute engine-specific operations that are not query execution (for example completion, schema lookup, metadata fetch, diagnostics, or catalog operations).

Request params:

```json
{
  "engineId": "payloadbuilder",
  "fileId": "file-001",
  "action": "payloadbuilder.echo",
  "payload": {
    "hello": "world"
  }
}
```

Success result:

```json
{
  "result": {
    "fileId": "file-001",
    "payload": {
      "hello": "world"
    }
  }
}
```

Rules:

- `action` is engine-owned and namespaced by convention (for example `payloadbuilder.*`, `jdbc.*`).
- `payload` and `result` are opaque to the core protocol and transported as `unknown` JSON.
- Backends SHOULD return `ENGINE_NOT_FOUND` for unknown `engineId` and `VALIDATION` for unsupported or invalid actions.

Rules:

- `engineStatePatch` is an engine-owned opaque blob. Core protocol forwards it without interpretation.
- Engines SHOULD only return changed values in patches.

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

## 6.4 `queryengine.failed`

```json
{
  "queryExecutionId": "qx-001",
  "error": {
    "code": "ENGINE_NOT_FOUND",
    "message": "Unknown engine 'foo'"
  }
}
```

## 7. Error codes

- `VALIDATION`: malformed/invalid request
- `METHOD_NOT_FOUND`: unknown method
- `UNSUPPORTED_PROTOCOL`: no compatible protocol major
- `ENGINE_NOT_FOUND`: requested engine unavailable
- `QUERY_NOT_FOUND`: cancellation or progress target missing
- `TIMEOUT`: operation exceeded deadline
- `CANCELLED`: operation canceled
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
- Backend resolves structured secret wrappers only (`{ "secretRef": "<ref-id>" }`) before engine/plugin invocation.
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
3. Java emits `queryengine.progress` and one or more `queryengine.resultChunk` notifications.
4. Java emits `queryengine.completed`.

### 11.3 Cancel

1. Electron sends `queryengine.cancel` (`queryExecutionId=qx-001`).
2. Java responds `accepted=true`.
3. Java emits `queryengine.failed` with `code=CANCELLED` or emits `queryengine.completed` with partial results, based on engine semantics.

## 12. Implementation checklist

- Add TypeScript types in `queryeer-desktop/src/contracts/backend/*` from this spec.
- Implement gateway serializer/parser with NDJSON framing.
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
- `connection.upsert` request handling scaffolded
- JDBC provider actions include `jdbc.schema.snapshot` (latest cached snapshot by `connectionId` and optional `scope`) and `jdbc.schema.refresh` (synchronous refresh + cache persist with scope-aware behavior)
- `file.open` / `file.close` / `file.bind` request handlers implemented against `DefaultFileRegistry`; JDBC provider registers `FileSessionHandler` for file-scoped connection lifecycle and rebind cleanup
- `file.change` notification handler implemented

JDBC file-session cleanup configuration:

- `queryeer.jdbc.fileSession.idleTimeoutMs` (default: `1800000`) controls idle lifetime before a file-scoped JDBC session is evicted.
- `queryeer.jdbc.fileSession.reaperIntervalMs` (default: min(idleTimeoutMs, 300000)) controls how often idle sessions are scanned.
- `queryeer.jdbc.schemaCrawl.intervalMs` (default: `300000`) controls periodic schema crawl loop interval when security session is open.

Backend bootstrap configuration (desktop -> backend process env -> backend config service):

- `QUERYEER_APP_DIR` maps to `queryeer.app.dir`.
- `QUERYEER_SETTINGS_DIR` maps to `queryeer.settings.dir`.
- `QUERYEER_SETTINGS_PATH` maps to `queryeer.settings.path`.

JDBC startup preload behavior:

- On plugin activation, backend JDBC reads module settings from `queryeer.settings.path` (if present) or `${queryeer.settings.dir}/core.queryengine.jdbc.json`.
- Backend loads `values["core.queryengine.jdbc.connections"]`, applies the same normalization rules as desktop (required `connectionId`/`url`, default `dialectId="jdbc"`, default `enabled=true`, duplicate IDs dropped), and preloads enabled connections into backend runtime registry.
- JDBC crawl subsystem starts at plugin activation, but crawl execution is gated until backend receives `security.session.open` from desktop main.
- On `security.session.close`, schema crawl loop pauses until a new `security.session.open` arrives.
- `jdbc.schema.refresh` requires an open security session; otherwise backend returns a validation error.
- `jdbc.schema.refresh` supports `scope=top|deep` (`top` default). `scope=deep` requires `target.schema` (`target.database` optional).
- Active connections are background-crawled on `top` scope (databases/schemas) while `deep` scope (tables/columns) is refreshed only on explicit triggers.

Current integration notes:

- Desktop default mode remains `mock-stdio`; `QUERYEER_BACKEND_STDIO=1` enables stdio-process mode.
- External plugin discovery uses `QUERYEER_PLUGINS_PATH` for both backend (runner side) and frontend (desktop side).

See Java transport implementation:

- `queryeer-backend/backend-transport-stdio/src/main/java/com/queryeer/backend/transport/stdio/StdioTransportServer.java`

## 13. Contract synchronization rule

When protocol shapes change, update both contract implementations in the same session:

- TypeScript contracts: `queryeer-desktop/src/contracts/backend/*`
- Java contracts: `queryeer-backend/backend-contract/*`

Then update this protocol document to reflect the final agreed shape.
