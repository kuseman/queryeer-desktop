# Core Workspace Model (Draft v1)

This document defines the `core.workspace` plugin — responsible for session state, persistence, external-change handling, and autosave/backup.

Status: architecture draft.

## 1. Goals

- Track which files are open, which one is active, and per-file UI state (cursor/scroll).
- Persist session on change; restore on startup.
- Detect external changes to open files (via `core.fileWatcher`) and surface them to the user with a deterministic UX.
- Autosave edits (including untitled files) so crashes don't lose work.
- Recover from crashes by offering to restore from backups on next startup.

Non-goals (for now):
- Folder-based workspaces (VS Code-style). Single global session only.
- Multi-window workspaces.
- Synced workspaces across devices.

## 2. Persistence

### 2.1 Location and format

- File: `<userData>/workspace.json`
- Atomic write: write to `workspace.json.tmp`, fsync, rename.
- Write throttling: debounced 500ms on state changes; force-flush on app quit.
- Main process owns the file; renderer pushes snapshots via IPC.

### 2.2 Schema

```json
{
  "schemaVersion": 1,
  "savedAt": "2026-04-21T12:00:00.000Z",
  "activeFileId": "f-001",
  "files": [
    {
      "fileId": "f-001",
      "uri": "file:///path/to/query.pb",
      "mimeType": "application/x-payloadbuilder",
      "engineBinding": {
        "engineId": "payloadbuilder",
        "connectionId": "conn-001"
      },
      "backupUri": "app-data:///backups/f-001-abcd.bak",
      "cursor": { "line": 12, "column": 4 },
      "scroll": { "top": 240, "left": 0 }
    }
  ],
  "layout": {
    "visibleZones": ["menuBar", "toolBar", "statusBar", "primarySidebar", "mainArea"],
    "sidebarWidths": { "primary": 280, "secondary": 320 },
    "viewsByZone": { "primarySidebar": ["core.layout.view.primary"], "secondarySidebar": [] },
    "activeViewByZone": { "primarySidebar": "core.layout.view.primary" },
    "editorGroupIds": []
  },
  "recentFiles": [
    { "uri": "file:///path/to/query.pb", "lastOpenedAt": "2026-04-21T11:59:00.000Z" }
  ]
}
```

### 2.3 Versioning and migration

- `schemaVersion` is required. Unknown versions are logged and ignored (fresh session).
- Migrations are one-way: `v1 → v2 → v3`. Each migrator is a pure function.
- On migration failure, the original file is renamed to `workspace.json.broken-<timestamp>` and a fresh session starts.

## 3. FileEntity additions

Extend `FileEntity` (from `FILE_ENTITY_MODEL.md`) with:

```ts
type FileEntity = {
  // ...existing fields
  externallyModified?: boolean;   // disk changed since last open/save/reload
  reloadPending?: boolean;        // non-active file: will prompt on activate
  backupUri?: string;             // if autosave has written a backup
  cursor?: { line: number; column: number };
  scroll?: { top: number; left: number };
};
```

### 3.1 Untitled files

- Start with `dirtyVsDisk: true` the moment any content exists.
- Never have a disk URI; `uri` stays `untitled:<id>`.
- May have a `backupUri` once autosaved.
- Save-as flow converts them to disk URIs (separate concern, not in v1 scope).

## 4. Mediator additions

Extend `FileMediator`:

```ts
type FileMediator = {
  // ...existing
  reloadFile: (fileId: string) => Promise<void>;
  acceptExternalChange: (fileId: string) => Promise<void>;  // alias for reloadFile, semantic clarity
  discardExternalChange: (fileId: string) => Promise<void>; // keep buffer; clear externallyModified; mark dirtyVsDisk
};
```

## 5. External change detection flow

The workspace subscribes to `core.fileWatcher` for every open file with a disk URI. On an event:

1. Workspace asks `core.fileWatcher` whether this was an own-write via the mute API (implicit — muted events don't arrive).
2. For each subscriber (file), set `externallyModified = true`.
3. Branch on whether the file is active:

**Active file, not dirty:**
- Immediately reload (no prompt). Set `reloadPending = false`, clear `externallyModified`.

**Active file, dirty:**
- Show notification with three actions: **Reload** (discard buffer), **Keep Changes** (retain buffer, mark dirty vs disk), **Diff** (open diff view — deferred to later increment).
- `Reload` → `reloadFile`. `Keep Changes` → `discardExternalChange`.

**Non-active file, not dirty:**
- Set `reloadPending = true`. No UI immediately.
- When file becomes active, auto-reload silently (or show brief toast).

**Non-active file, dirty:**
- Set `externallyModified = true`, leave `reloadPending = false`.
- When file becomes active, show the same notification as "active, dirty" branch above.

## 6. Autosave / backup

### 6.1 Storage

- Folder: `<userData>/backups/`
- File naming: `<fileId>.bak` (fileId is stable per-session; rotated files use `<fileId>.<seq>.bak`).
- Retention: keep last 5 per `fileId`; rotate on each write.

### 6.2 Trigger

Dual-trigger, whichever fires first:

- **Debounced-edit**: 3 seconds of idle after last `notifyChanged`.
- **Max-interval**: 30 seconds since last backup, if still dirty.

Only dirty files are backed up. Clean files have no backup (close cleanup purges any stale ones).

### 6.3 Write flow

1. Mediator requests backup from main: `saveBackup(fileId, text)`.
2. Main calls `fileWatcher.mutePath(<backupPath>, 500)` — but this is a no-op for backups since consumers don't watch the backups folder. Included for consistency.
3. Atomic write to backup folder.
4. Update `FileEntity.backupUri` via registry.

### 6.4 Cleanup

- On `closeFile` with `discardDirty: true`: purge backups for that `fileId`.
- On `closeFile` with clean file: purge backups for that `fileId`.
- On successful `saveFile` to disk: purge backups for that `fileId`.
- On app quit: leave backups in place (crash recovery depends on them).

## 7. Recent files

- Cap: 50 entries, LRU.
- Updated on `openFile` through the mediator.
- Persisted inline with workspace state.
- No per-file UI state tracked (that belongs to the currently-open file, if still open).

## 8. Session restore and crash recovery

On app startup:

1. Read `workspace.json`. If missing or corrupt, start fresh.
2. For each `file` entry, check:
   - **Has `backupUri`?** → crash-recovery path.
   - **No backup?** → open from disk (re-run mediator `openFile`).
3. For files with backups:
   - Untitled: always restore from backup. Mark `dirtyVsDisk: true`.
   - Disk-backed with backup newer than disk: prompt user (Restore / Discard / Diff). This prompt can be batched into a single modal listing all affected files.
   - Disk-backed with disk newer than backup: warn once in logs, open from disk, discard backup.
4. After restore decisions, purge backups for "discarded" choices.
5. Apply layout + active file from the restored state.

## 9. Plugin surface

Exposed via `PluginContext.workspace`:

```ts
type WorkspaceService = {
  getRecentFiles: () => Array<{ uri: string; lastOpenedAt: string }>;
  clearRecentFiles: () => void;
  subscribe: (subscriber: (state: WorkspaceSnapshot) => void) => () => void;
};

type WorkspaceSnapshot = {
  activeFileId?: string;
  openFileIds: string[];
  recentFiles: Array<{ uri: string; lastOpenedAt: string }>;
};
```

Plugins don't get direct access to write workspace state — all writes flow through the file mediator or layout registry, which the workspace observes.

## 10. Incremental rollout

Five increments, each independently merge-able:

| # | Increment | Scope |
|---|---|---|
| 1 | Persistence scaffold | Main-process `workspace.json` writer (atomic, debounced). Renderer pushes snapshots on state change. Read on startup; restore open files, active file, layout. No backups, no watcher. |
| 2 | FileEntity flags + mediator methods | Add `externallyModified`, `reloadPending`, `backupUri`, `cursor`, `scroll` to `FileEntity`. Add `reloadFile` / `acceptExternalChange` / `discardExternalChange` to mediator. No watcher integration yet. |
| 3 | FileWatcher integration | Workspace subscribes to `core.fileWatcher` for every open disk-URI file. On events, set flags + trigger notification UX. Depends on `core.fileWatcher` increment 2. |
| 4 | Autosave + backup | Backup storage + retention + dual-trigger autosave. Updates `backupUri`. Cleanup on close/save. |
| 5 | Crash recovery | On startup, detect backups, prompt user for restore/discard, apply choices. |

## 11. Key decisions (locked)

1. **Session granularity**: single global session (not folder-based).
2. **Layout state**: folded into `workspace.json`.
3. **Persistence**: JSON file in `userData`, atomic write, debounced.
4. **Backups**: separate folder (`userData/backups/`), not next to source files.
5. **Autosave trigger**: 3s debounced-edit + 30s max-interval.
6. **Reload UX**: active-dirty → prompt; non-active-not-dirty → auto-reload on activate; other branches covered in §5.

## 12. Dependencies

- `core.files` (FileEntity, FileRegistry, FileMediator) — extended in increment 2.
- `core.fileWatcher` — integrated in increment 3. Workspace depends on fileWatcher increment 2 or later.
- `core.layout` — workspace reads/writes `PersistedLayoutState` from/to the layout registry.

## 13. Testing strategy

- Unit tests for workspace state snapshot/restore round-trip, migration, atomic write.
- Unit tests for mediator reload/accept/discard flows with fake registry.
- Integration tests for autosave trigger (debounce + max-interval) with fake timers.
- Integration tests for crash recovery: plant backup files, start app, assert prompt + resulting state.
- External-change scenarios covered end-to-end: active-dirty, active-clean, non-active-dirty, non-active-clean.
