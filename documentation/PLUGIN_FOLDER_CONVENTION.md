# Plugin Folder Convention

Status: proposed and approved for follow-up migration session

Date: 2026-04-25

## Purpose

Define a consistent plugin folder structure so code ownership is obvious, module boundaries are clean, and CSS stays colocated with the owning feature.

## Scope

Applies to `queryeer-desktop/src/plugins/*`.

## Core convention

Each plugin should follow this baseline:

```text
src/plugins/<plugin-id>/
  module.ts
  plugin.ts[x]
  contracts/
  application/
  ui/
  styles/
```

Notes:

- `module.ts` should remain thin (module export + optional plugin-wide style imports).
- `plugin.ts[x]` should handle manifest + activation wiring only.
- `contracts/` is for plugin-internal types/interfaces only.
- `application/` is for runtime orchestration, services, registries, and state logic.
- `ui/` is for React components and view composition.
- `styles/` is only for plugin-wide shared styles.

## Subfeature convention

If a plugin contains multiple distinct feature areas, create subfeature folders and apply the same ownership pattern locally.

Example for `core.editor`:

```text
src/plugins/core.editor/
  module.ts
  plugin.tsx
  contracts/
  TextEditor/
    plugin.tsx
    ui/
      TextEditorComponent.tsx
    application/
      TextEditorRegistry.ts
      TextEditorModelRepository.ts
    infrastructure/
      MonacoTextEditorApi.ts
    settings/
      editor-settings.ts
    styles/
      text-editor.css
    *.test.ts[x]
  ImageEditor/
    plugin.tsx
    ui/
    application/
    styles/
```

## CSS colocation rule

- Component/subfeature-specific CSS must live in the owning feature folder.
- Plugin-shared CSS can live in plugin-level `styles/`.
- Global `renderer/styles/base.css` should contain only:
  - global tokens/variables
  - resets
  - true app-wide base rules

Do not place feature-specific CSS in `base.css`.

## Test placement

- Default: colocated tests next to the source file (`*.test.ts`, `*.test.tsx`).
- If test volume becomes large, group under local `__tests__/` folder in the same feature boundary.

## Naming

- React components: `PascalCase.tsx`
- Non-component files: descriptive suffixes (`*-service.ts`, `*-registry.ts`, `*-adapter.ts`, `*-settings.ts`)
- CSS files: `kebab-case.css`

## Migration guidance (incremental)

1. Move files without behavior changes.
2. Update imports.
3. Run `npm run typecheck && npm run lint && npm run build`.
4. Keep each move in small reviewable chunks.
5. Prefer one plugin/subfeature per migration PR/session.

## Current known alignment items

- `core.editor`: continue moving TextEditor-specific files under `TextEditor/` subfolders (`settings/`, `styles/`, `application/`, `infrastructure`, `ui`).
- Other plugins should progressively move feature-specific CSS out of `base.css` and into module ownership.
