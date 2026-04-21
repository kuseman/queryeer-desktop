# Core File Watcher Model (Draft v1)

This document defines the `core.fileWatcher` platform service — a shared, deduplicated, subscription-based file watcher that any plugin can consume.

Status: architecture draft.

## 1. Goals

- One platform-owned watcher service; multiple plugin consumers (`core.workspace`, future `project.*`, metadata/settings/snippet plugins).
- Cross-platform stability via chokidar in Electron main (not JVM `WatchService`).
- Subscription-based API with automatic deduplication of watchers on overlapping paths.
- Own-write suppression so autosave/backup writes don't trigger false change events.
- Event normalization so consumers receive consistent semantics across Windows, macOS, and Linux.

Non-goals (for now):
- Watching non-local URI schemes (FTP, SFTP, remote FS).
- Content diffing or content-hash tracking — consumers handle that.
- Quota/watch-budget enforcement beyond a log warning at the inotify limit.

## 2. Process placement and dependency

- **Electron main process** owns the service. Disk IO is a platform concern; colocating with other Node-side writers (autosave, backups) allows in-process mute coordination.
- **chokidar** wraps `fs.watch`/FSEvents/`ReadDirectoryChangesW` and handles the cross-platform edge cases (atomic-save delete+create sequences, event coalescing, filename delivery quirks).
- Renderer consumes the service via preload bridge; it never holds a direct watcher.

## 3. Plugin contract

Exposed via `PluginContext.fileWatcher`:

```ts
type FileWatcherEvent = {
  type: "add" | "modify" | "delete" | "rename";
  uri: string;
  timestamp: string;
};

type FileWatcherSubscription = {
  subscriptionId: string;
  unsubscribe: () => Promise<void>;
};

type FileWatcherService = {
  watch: (
    uri: string,
    options: { recursive?: boolean },
    handler: (event: FileWatcherEvent) => void
  ) => Promise<FileWatcherSubscription>;
  mutePath: (uri: string, durationMs: number) => void;
};
```

Contract rules:

- Consumers call `watch` with a local `file://` URI. Non-local schemes return a rejected promise.
- `unsubscribe` is idempotent and safe to call after main process disposes the watcher.
- A single `uri + recursive` pair maps to exactly one chokidar watcher internally, regardless of how many consumers subscribe.
- Multiple consumers on the same path all receive the same event; the service fans out.

## 4. Own-write suppression (`mutePath`)

Autosave and backup writes happen in Electron main. Without suppression, those writes trigger `modify` events that propagate to consumers as "external change detected" — a false alarm.

- `mutePath(uri, durationMs)` silences events for that URI for the window.
- Called by whoever is about to write, just before the write.
- Per-URI window (not global) so muting one file doesn't hide changes to another.
- Default recommended window: 500ms. Writers should tune to their own IO latency profile.
- Mute state is in-process only; survives no restarts.

## 5. Event normalization

chokidar delivers raw events that vary by platform. The service normalizes to four types:

- `add` — file appeared
- `modify` — file content changed
- `delete` — file removed
- `rename` — file moved to a new path (emitted as `delete` + `add` on the old and new paths respectively, since we can't always correlate across paths reliably)

Platform smoothing performed by the service (not by consumers):

- Windows atomic-save (temp + rename → delete + create in rapid succession): collapsed into a single `modify` event if the same URI sees delete+add within 50ms.
- macOS FSEvents coalescing: chokidar already debounces ~10ms; service adds no extra.
- Linux inotify: log a warning once if `max_user_watches` is within 90% of limit.

## 6. Preload / IPC boundary

- Preload exposes three methods: `watchFile(uri, options) → { subscriptionId }`, `unwatchFile(subscriptionId)`, `mutePath(uri, durationMs)`.
- Events flow from main to renderer via a single `ipcMain.emit("file-watcher:event", { subscriptionId, event })` channel.
- Renderer-side `FileWatcherService` holds a `subscriptionId → handler` map and dispatches incoming events.
- `handler` references never cross the IPC boundary (not serializable); the service-side wrapper bridges.

## 7. Incremental rollout

Five small increments, each independently merge-able:

| # | Increment | Scope |
|---|---|---|
| 1 | Service scaffold + IPC | Add `core.fileWatcher` plugin + preload bridge with a no-op implementation. Contract types land; no chokidar yet. |
| 2 | Single-path watch | Wire chokidar in main; one watcher per subscription, no deduplication. Events flow end-to-end. |
| 3 | Dedup + refcount | Share a single chokidar watcher across subscribers with overlapping `uri + recursive`; close watcher when last subscriber unsubscribes. |
| 4 | Mute API | Add `mutePath` with per-URI timers; suppress events during the window. |
| 5 | Event normalization | Collapse delete+add sequences on atomic save; log inotify limit warnings on Linux. |

## 8. Key decisions (locked)

1. **Process**: Electron main with chokidar.
2. **Sharing**: Dedup watchers per unique `uri + recursive`; fan out to subscribers.
3. **Suppression**: `mutePath` with per-URI windows; writer responsibility to call.
4. **Normalization**: Four normalized event types; platform smoothing inside the service.
5. **Scheme scope**: `file://` only for v1.

## 9. Testing strategy

- Unit tests for subscription/dedup/refcount with a mocked watcher factory.
- Integration tests against real chokidar on a tmp directory: write/delete/rename/atomic-save patterns.
- Mute-API tests with fake timers.
- Normalization tests for the Windows atomic-save pattern.
