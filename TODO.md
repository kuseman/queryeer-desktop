# TODO

## Running a query re-renders the whole shell (slow)

Found 2026-11-18 on `feat/plugin-api-0.20`, from a React DevTools profile of running queries against a JDBC connection.

**Symptom:** the UI is sluggish around every query run. With "Highlight updates" on, every part of the UI flashes on each run.

**What the profile shows:**
- Each run gives 2–3 commits that re-render the whole tree (about 370 components), each about 250 ms.
- Every time, `ShellApp` and `ExplorerView` are the updaters. Both subscribe to file changes (`ShellApp.tsx`, the `filesRegistry.subscribe` effect; `ExplorerView.tsx`, `setOpenFiles`).
- `filesAreStructurallyIdentical` (`renderer/shell/file-entity-utils.ts`) compares `metadata` by reference. A run writes file metadata (schedule state, the JDBC session id and state), so every run counts as a change, and `ShellApp` re-renders with all its children, which aren't memoized.
- Most of the time is the components' own render work, not their children: `ShellApp` about 78 ms per render, `ToolbarComponent` about 55 ms. The toolbar also re-renders on its own at about 90 ms.
- The toolbar calls `canExecuteCommand` once per button. Each call runs `CommandBus.canExecute`, which evaluates the command's `enablement` with `evaluateBooleanSync` against a freshly built context (`chain.getEffectiveContext()`, and the expression runtime serializes the registered functions on each call).

**Not known yet:** whether this is a regression. The code above predates the 0.20.0 work: the shell structure is from September, the expression runtime from May. To find out, build `6745800` (the commit before the 0.20.0 plugin-API work) and record the same profile.

**Possible fix:**
1. Let the shell react only to the file fields it renders, not to any `metadata` change: compare the metadata keys the shell uses, or move per-run state out of `FileEntity.metadata`.
2. Memoize `ShellApp`'s heavy children (sidebar views, editor groups, status bar), so a shell-level state change doesn't re-render them.
3. Toolbar: evaluate the context and each `enablement` once per render (or cache by context version), not once per `canExecuteCommand` call. Check the cost of `resolveSerializedBindings()` per evaluation.
4. Afterwards, profile again: one run should not re-render the whole tree.
