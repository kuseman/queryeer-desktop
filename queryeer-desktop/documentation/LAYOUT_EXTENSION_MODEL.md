# Layout Extension Model (Draft v1)

This document defines the fixed-zone, dockable layout model for `core.layout`.

## Goals

- Keep shell structure predictable and stable.
- Allow plugin-driven contributions inside controlled zones.
- Support persistence and future docking/move operations.

## Fixed shell zones

- `menuBar`
- `toolBar`
- `statusBar`
- `primarySidebar`
- `secondarySidebar`
- `mainArea`

Top-level zones are fixed and not plugin-defined.

## Extension contributions

`layout` registry supports:

- `registerMenuItem`
- `registerToolbarAction`
- `registerStatusItem`
- `registerView`
- `registerEditor`
- `registerWelcome`
- `setShellDefaults`

## Contribution boundaries

- Menu/toolbar/status contributions are lightweight shell actions/indicators.
- Views are dockable sidebar contributions (`primarySidebar` or `secondarySidebar`).
- Editors target `mainArea` tab groups.
- Welcome contributions render when no active editor is present.

## Persistence model

Layout state is persisted as part of the workspace document (`<userData>/workspace.json`) via `core.workspace`, not as a standalone file. The active subset of `PersistedLayoutSnapshot` (in `src/contracts/workspace/WorkspaceSnapshot.ts`):

- `visibleZones: LayoutZone[]`
- `sidebarWidths: { primary?: number; secondary?: number }`

ShellApp seeds these from `workspaceService.restoredLayout()` on init and pushes updates back via `workspaceService.setLayout()` (debounced through the shared workspace save).

Not persisted yet (planned, but no consumer driving the need):

- ordered views by sidebar zone
- active view per sidebar zone
- active editor id
- editor group ids

The `PersistedLayoutState` type previously sketched in `LayoutExtension.ts` is obsolete — the canonical persisted shape lives next to the workspace snapshot. View ordering and editor groups will be added when user-driven view-move actions land.

## Migration note

Legacy `panels` extension point is now removed from plugin contracts/runtime.
All future plugin UI contributions should use layout APIs only:

- sidebar content -> `registerView`
- main editor content -> `registerEditor`
- initial empty-state content -> `registerWelcome`
