# Per-File State Registry

## Problem

Plugins and editors need to associate runtime state with open files — query results, grid column widths, active tab selection, etc. Naïve module-level `Map<string, T>` caches accumulate entries forever because nothing signals when a file is closed.

## Solution

`FileStateRegistry` is a typed key/value store scoped to open files. When a file closes, every entry for that file is automatically disposed.

### Key types

```ts
// contracts/files/FileStateRegistry.ts

export type StateKey<T> = { readonly id: string; readonly _type?: T };

export function defineStateKey<T>(id: string): StateKey<T>;

export interface FileStateRegistry {
  get<T>(fileId: string, key: StateKey<T>): T | undefined;
  set<T>(fileId: string, key: StateKey<T>, value: T, dispose?: (value: T) => void): void;
  delete<T>(fileId: string, key: StateKey<T>): void;
  evict(fileId: string): void;
}
```

The phantom `_type` field on `StateKey<T>` carries the value type so `get`/`set` infer `T` without a cast at the call site.

### Lifecycle

`FileRegistry.closeFile` calls `getFileStateRegistry().evict(fileId)` before emitting the removal event. Eviction is synchronous and guaranteed — no subscriber ordering issues, no `subscribe`-and-diff workarounds.

```
file closed
    │
    ▼
FileRegistry.closeFile(fileId)
    │
    ├─► fileStateRegistry.evict(fileId)   ← dispose callbacks run here
    │       for each entry: entry.dispose?.(value)
    │       then Map entry deleted → value eligible for GC
    │
    └─► emit() to FilesRegistry subscribers
```

### Access

The registry singleton is available two ways:

| Context | How to access |
|---|---|
| Plugin `activate` function | `context.fileState` (injected via `PluginContext`) |
| React components / other modules | `import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl"` |

### Defining and using a key

```ts
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";

// Define once at module scope — the generic parameter is the stored type
const MY_STATE_KEY = defineStateKey<MyState>("my.plugin.myState");

// Write
getFileStateRegistry().set(fileId, MY_STATE_KEY, value);

// Write with a dispose callback (for resources that need explicit teardown)
getFileStateRegistry().set(fileId, MY_STATE_KEY, value, (v) => v.stream.close());

// Read — returns MyState | undefined, no cast needed
const state = getFileStateRegistry().get(fileId, MY_STATE_KEY);

// Explicit delete (runs dispose callback if one was registered)
getFileStateRegistry().delete(fileId, MY_STATE_KEY);
```

Overwriting an existing entry with `set` automatically runs the previous dispose callback before storing the new value.

### Dispose callback rules

- Called when the file closes (`evict`)
- Called when an entry is explicitly `delete`d
- Called when `set` overwrites an existing entry
- **Not** called when `get` is used — read-only access has no side effects
- Optional — omit for plain data (JS GC handles memory once the entry is removed)

Use dispose callbacks for resources that need teardown: open streams, event subscriptions, WebSocket connections, timers.

## Registered keys

| Key id | Type | Owner | Dispose |
|---|---|---|---|
| `core.queryengine.outputContext` | `OutputContext` | `QueryEditorComponent` | — |
| `core.queryengine.selectedPrimary` | `string` | `QueryEditorComponent` | — |
| `core.queryengine.output.table.gridState` | `GridState` | `core.queryengine.output.table` | — |
| `core.queryengine.output.table.activeResultSet` | `number` | `core.queryengine.output.table` | — |
