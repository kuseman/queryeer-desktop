# Queryeer Core Boundary

## Purpose

Define what stays internal to Queryeer Desktop core vs what must be delivered as external plugins.

Primary direction: querying capabilities are external. Core is a secure host + workspace shell.

## Core responsibilities (internal)

- Runtime host lifecycle: discover, validate, activate, deactivate plugins.
- Dependency/capability governance and diagnostics.
- Shell composition: layout, tabs/panels, command bus, keybindings.
- Workspace/session state and settings persistence.
- Backend process orchestration and typed transport boundary.
- Security/trust boundary: plugin loading policy, secret boundary, diagnostics redaction.
- Extension contracts/APIs used by external plugins.

## Core plugin set (recommended baseline)

- `core.runtime`
  - plugin lifecycle and runtime diagnostics surface.
- `core.commands`
  - command registry, command palette integration, keybinding mapping.
- `core.layout`
  - shell layout and docking/panel composition.
- `core.workspace`
  - workspace/session state and recent/open context.
- `core.settings`
  - settings schema registry, scope resolution (user/workspace), change notifications.
- `core.storage`
  - non-secret state persistence abstraction for plugins.
- `core.secrets`
  - secret storage abstraction boundary.
- `core.backend-gateway`
  - Java backend lifecycle, health monitoring, protocol transport and capability handshake.
- `core.notifications`
  - toasts/progress/background task status/error surfacing.
- `core.filesystem` (optional, keep minimal)
  - shared file provider abstraction for shell/editor/plugin use.

## External plugin categories (must stay out of core)

- Query engine plugins (for example: `query.payloadbuilder`, `query.jdbc`).
- Query/editor UX plugins (query tabs/notebooks/engine-specific editing helpers).
- Connection management plugins and provider-specific auth UX.
- Output/rendering plugins (`output.table`, `output.text`, charting, custom visualizations).
- Metadata exploration plugins, assistant/AI tooling plugins, import/export plugins.

## Hard boundary rules

- Core must not embed query-domain assumptions.
  - No hardcoded engine ids in core startup/runtime.
  - No query result schema assumptions in core renderer shell.
  - No engine-specific connection forms in core.
- Core owns only generic extension points and orchestration.
  - Examples: `execution.provider`, `editor.provider`, `result.renderer`, `connection.provider`.
- Query method contracts at transport level remain stable, but query behavior lives in external plugin implementations.
- Built-in plugins should be limited to shell/platform concerns only.

## Current deviations and migration actions

- Developer probe is now externalized (`plugins/dev-query-probe`) and no longer part of shell core.
  - Action: keep it external-only and avoid reintroducing query actions in core diagnostics UI.
- Capability constants include query methods for protocol validation.
  - Action: keep protocol contracts in core boundary, keep query UX/business logic in external plugins.
- Some built-in manifests may still represent capabilities that should be optional.
  - Action: convert those capabilities into external plugin packages and load through manifest discovery.

## Enforcement checklist for future PRs/sessions

- Any new query or engine behavior belongs in external plugin packages.
- New core changes must map to host/platform responsibilities only.
- If a change introduces engine-specific logic in core, reject or refactor before merge.
- Update this boundary doc and migration plan when capability ownership changes.
