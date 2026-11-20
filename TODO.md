# TODO

## Running a query re-renders the whole shell

Found 2026-11-18 on `feat/plugin-api-0.20`, from a React DevTools profile of running queries against a JDBC connection. Mostly fixed in 0.21 (2026-11-20); what is left is cosmetic.

**Symptom:** with "Highlight updates" on, every part of the UI flashes on each run.

**Fixed in 0.21:** each synchronous when-expression (`evaluateBooleanSync`: command enablement, toolbar, menu, sidebar, tab, keybinding and shortcut filters) was a blocking `ipcRenderer.sendSync` to the main process, which rebuilt every expression function from source in a new VM context. Results are now reused for 1 s per expression and context (`ExpressionRuntimeService`), and the serialized functions are built once per set of functions (`FunctionRegistry`). This also made switching between files of different types much faster.

| Per commit | Before (2026-11-18) | After (2026-11-20) |
|---|---|---|
| Whole commit | about 250 ms | about 10 ms (some about 30 ms) |
| `ToolbarComponent` | 55–90 ms | about 1.7 ms |
| `ShellApp` (own render) | about 78 ms | about 3.9 ms |
| Commits per run, components each | 2–3, about 370 | 2, 384–395 |

**What is left** (2026-11-20 profile, about 15 ms per commit in all):
- The whole tree still re-renders on every run. `ShellApp` and `ExplorerView` are the updaters: both subscribe to file changes (`ShellApp.tsx`, the `filesRegistry.subscribe` effect; `ExplorerView.tsx`, `setOpenFiles`), and `filesAreStructurallyIdentical` (`renderer/shell/file-entity-utils.ts`) compares `metadata` by reference. A run writes file metadata (schedule state, the JDBC session id and state), so every run counts as a change.
- The shell does need some metadata: the active file's metadata feeds the when-expressions of the toolbar, menus and views (`viewContext`) and the running-query context, and plugin tab titles and styles read every file's metadata. So it can't just ignore metadata changes.
- The outline re-renders entirely on every commit: about 270 `OutlineSymbolNode`s, about 2.7 ms per commit, the largest waste left.

**Possible fix:**
1. Memoize `OutlineSymbolNode` (and `OutlineSymbolTree`), so an unchanged outline doesn't re-render.
2. Have `ExplorerView` ignore metadata-only changes if it only uses ids and URIs.
3. Memoize `ShellApp`'s heavy children (sidebar views, editor groups, status bar) with stable props and callbacks, or move per-run state out of `FileEntity.metadata`. A larger refactor of a 1,000-line component without render tests; worth it only if the remaining cost starts to matter.
4. Afterwards, profile again: one run should not re-render the whole tree.
