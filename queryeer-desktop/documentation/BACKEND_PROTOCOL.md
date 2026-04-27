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
  "method": "query.execute",
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
  "method": "query.progress",
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
    "query.execute",
    "query.cancel",
    "engine.invoke",
    "query.progress",
    "query.resultChunk"
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
  "providedCapabilities": ["query.execute", "engine.invoke"]
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
    "query.execute",
    "query.cancel",
    "engine.invoke",
    "query.progress",
    "query.resultChunk",
    "query.completed",
    "query.failed"
  ]
}
```

## 5.2 `health.ping`

Purpose: liveness check and latency baseline.

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
  "uptimeMs": 15320
}
```

## 5.3 `query.execute`

Purpose: start query execution asynchronously.

Request params:

```json
{
  "queryExecutionId": "qx-001",
  "engineId": "payloadbuilder",
  "connectionId": "local-dev",
  "fileId": "file-001",
  "text": "select * from foo",
  "parameters": [],
  "engineState": {
    "payloadbuilder": {
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

- Execution updates are sent via notifications (`query.progress`, `query.resultChunk`, `query.completed`, `query.failed`).
- `engineState` is an engine-owned opaque blob. Core protocol forwards it without interpretation.

## 5.4 `query.cancel`

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

Purpose: create/update non-secret connection metadata (no raw password/token fields).

Request params:

```json
{
  "connectionId": "conn-001",
  "engineId": "jdbc",
  "name": "Local Postgres",
  "host": "localhost",
  "port": 5432,
  "database": "appdb",
  "username": "app_user",
  "options": {
    "ssl": false
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
- If the file was already bound, backend rebinds (may invalidate caches).

## 5.6d `query.execute` fileId extension

`query.execute` params accept an optional `fileId`. When present and the backend has a matching open file session, the backend SHOULD reuse the cached parse tree rather than re-parsing `text`. `text` remains accepted for stateless callers.

## 6. Notifications (v1)

## 6.1 `query.progress`

```json
{
  "queryExecutionId": "qx-001",
  "percent": 40,
  "message": "Executing"
}
```

## 6.2 `query.resultChunk`

```json
{
  "queryExecutionId": "qx-001",
  "chunkIndex": 0,
  "schema": {
    "columns": [
      { "name": "id", "type": "integer" },
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

## 6.3 `query.completed`

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

## 6.4 `query.failed`

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
- `query.execute`: request timeout only for acceptance; completion comes via notifications
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

1. Electron sends `query.execute` (`queryExecutionId=qx-001`).
2. Java responds `accepted=true`.
3. Java emits `query.progress` and one or more `query.resultChunk` notifications.
4. Java emits `query.completed`.

### 11.3 Cancel

1. Electron sends `query.cancel` (`queryExecutionId=qx-001`).
2. Java responds `accepted=true`.
3. Java emits `query.failed` with `code=CANCELLED` or emits `query.completed` with partial results, based on engine semantics.

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
- `query.execute` implemented (mocked progressive notifications); `fileId` field accepted but not yet consumed
- `query.cancel` implemented (mocked cancellation notification)
- `backend.runtimeStatus` implemented
- `connection.upsert` request handling scaffolded
- `file.open` / `file.close` / `file.bind` request handlers implemented against `DefaultFileRegistry`; no engine-specific `FileSessionHandler` yet
- `file.change` notification handler implemented

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
