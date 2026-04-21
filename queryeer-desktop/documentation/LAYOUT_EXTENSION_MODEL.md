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

## Persistence model (planned)

Persisted layout state shape (`PersistedLayoutState`):

- visible zones
- sidebar widths
- ordered views by sidebar zone
- active view per sidebar zone
- active editor id
- editor group ids

## Migration note

Legacy `panels` extension point is now removed from plugin contracts/runtime.
All future plugin UI contributions should use layout APIs only:

- sidebar content -> `registerView`
- main editor content -> `registerEditor`
- initial empty-state content -> `registerWelcome`
