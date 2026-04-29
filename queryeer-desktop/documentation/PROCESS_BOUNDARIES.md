# Process Boundaries (Draft v1)

This document defines the responsibilities of each runtime process and the rules for what crosses between them. It is the horizontal counterpart to `CORE_BOUNDARY.md` (which defines the vertical core-vs-plugin boundary).

Status: architecture reference.

## Process roles (summary)

- **Electron main** — platform integration. Owns disk IO, file watching, window/menu/IPC, backend process lifecycle, secret storage boundary, and external (HTTP/etc.) IO when needed for shell concerns.
- **Electron renderer** — UI host. Owns React tree, in-memory file/workspace state, plugin runtime, layout state. No direct disk or network IO; reaches main via the preload bridge.
- **Java backend** — engine + execution host. Owns query execution, parse trees, engine sessions, connection state, secret consumption (never raw secrets on the wire — handle-based). No filesystem access for shell-level files.

## 1. Disk ownership

**Rule**: Electron main is the sole authority for shell-level file IO (open, save, watch, backup, autosave). Java backend operates on strings handed across the protocol.

### What this means in practice

- File reads from disk happen in main, then pass content to renderer (UI) and to Java (parse/execute) as strings.
- File writes (save, autosave, backup) happen in main. The same process that watches a path is the same process that writes it — enables in-process mute coordination via `core.fileWatcher`.
- Java backend has no concept of file paths. It works with `fileId` + content strings only. The protocol carries `initialText` on `file.open` and `text` on `file.change`.
- Untitled files (new buffers without a disk URI) are first-class and stored only in renderer state + Electron main backups; Java sees them as any other `fileId`.

### Why

1. Single disk authority avoids cross-process coordination for watch/write/backup interactions.
2. Backend stays scoped to engine concerns; doesn't grow filesystem-permission surface.
3. Node's `fs`/`chokidar` ecosystem is more mature for this domain than JVM equivalents.
4. Future virtual schemes (`git://`, `s3://`, in-memory) resolve in Electron and hand strings to Java without protocol changes.
5. Wire protocol stays small — no `fs.read`/`fs.write` on the protocol.

### Carve-outs

- **Engine-internal data references** (e.g. a CSV referenced inside a query) — TBD when first engine needs it. Two viable paths: engine reads it itself (narrow exception), or backend requests it back from Electron via a reverse protocol message (not yet defined).
- **Native engine files** (JDBC drivers, plugin JARs) — these are loaded by the JVM at startup outside the protocol; not relevant to this rule.

## 2. Network / external IO ownership

**Rule**: Engines own their domain network IO (database connections, HTTP query targets). Electron main owns shell-level network IO (plugin updates, telemetry, backend launcher).

- Connections to query targets are made from Java (via JDBC drivers, etc.) — Electron is not in the data path.
- Renderer never makes network calls directly. Anything it needs goes through main (e.g. backend status, plugin discovery).

## 3. Secrets

**Rule**: Secret handling is owned by the desktop security boundary and is not currently part of the Java wire protocol.

- Renderer collects credentials in UI and interacts with main-process security APIs.
- `queryengine.execute` / `connection.upsert` protocol payloads do not carry secret fields.
- Logs in any process must redact known sensitive keys (already enforced in main + Java runner).

## 4. State authority

| State | Authority | Notes |
|---|---|---|
| Open files (id, uri, mime, dirty flags, cursor) | Renderer (`core.files` / `core.workspace`) | Persisted by main to `workspace.json` |
| Layout (zones, widths, active views) | Renderer (`core.layout`) | Persisted by main as part of workspace doc |
| File content buffers | Renderer (editor model) | Pushed to backend via `file.change`; pushed to disk by main |
| File watchers | Main (`core.fileWatcher`) | Subscribers in renderer via preload |
| Backups | Main | Stored in `<userData>/backups/` |
| Engine sessions, parse trees | Java (`backend-core` `DefaultFileRegistry`) | Indexed by `fileId` |
| Connection metadata + credentials | Java | Renderer/main never see decrypted secrets after store |
| Query executions | Java owns lifecycle; main mirrors status; renderer reads | `BackendExecutionStore` in main is a cache |
| Plugin manifests | Renderer (frontend), Java (backend) | Discovery in their own process |

## 5. Open questions

- **Engine-initiated file reads.** If an engine needs to read disk at execute time, do we (a) allow Java limited disk access for that engine, or (b) define a reverse-direction `file.read` request from backend to electron? Decide when the first engine demands it.
- **Large/binary content.** Current `file.change` ships full UTF-8 strings. Fine for query files; needs a chunking or "open by reference" mechanism if this ever serves multi-MB or binary files. Document the limit in `BACKEND_PROTOCOL.md` once we have a concrete number.
- **Renderer file IO temptations.** The renderer must not be tempted to use `fetch("file://...")` or similar. Enforced today by `nodeIntegration: false`, `sandbox: true` in the BrowserWindow config — keep it that way.

## Cross-references

- `CORE_BOUNDARY.md` — core vs plugin (vertical boundary).
- `BACKEND_PROTOCOL.md` — wire format between Electron main and Java.
- `JAVA_BACKEND_ARCHITECTURE.md` — Java module layering.
- `FILE_ENTITY_MODEL.md`, `CORE_WORKSPACE_MODEL.md`, `CORE_FILE_WATCHER_MODEL.md` — concrete designs that consume this boundary.
