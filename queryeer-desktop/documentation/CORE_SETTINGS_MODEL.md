# Core Settings Model

Status: draft implementation baseline (v1)

## Purpose

`core.settings` centralizes settings registration, runtime resolution, persistence, and the settings dialog surface.

## Boundaries

- `core.settings` is backend-agnostic.
- `core.settings` owns load/save and settings lifecycle.
- Feature modules own runtime behavior when settings change.
- If a setting must be sent to Java backend, that is a module implementation detail via subscriptions.

## Scope

- v1 scope model: single `workspace` scope.
- Save mode: auto-apply in memory, debounced persistence.
- Secrets in v1: placeholder-only (`isSecret` => read-only message).

## Contribution contract

Modules contribute settings through `context.settings.registerSettings(...)` with:

- `moduleId`
- `settings[]` with
  - `id` (`${moduleId}.` prefix required)
  - `title`, `description`, `sectionPath`, `tags`
  - `type`, `defaultValue`, optional constraints/options
  - optional `advanced.rendererId` and `advanced.validatorId`

Advanced settings are supported through optional renderer/validator registration while still requiring declarative metadata for indexing/search/navigation.

## Persistence model (hybrid)

- `settings/index.json`: version + module index metadata.
- `settings/<moduleId>.json`: module values document.

This keeps failures and migrations isolated per module while retaining centralized ownership.

## UI foundation

Settings open as a modal dialog with:

- search box
- section tree
- selected setting details panel

Baseline editor controls are provided for boolean/string/number/enum/json types.

## Fault tolerance

- Missing files => defaults.
- Corrupt settings JSON => quarantine to `*.broken-<timestamp>` and fallback to defaults.
- Atomic writes use temp-file + rename.

## Deferred

- secure secret store integration
- multi-scope resolution (user/workspace layering)
