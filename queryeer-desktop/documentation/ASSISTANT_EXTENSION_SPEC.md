# Assistant Extension Spec

This document captures the intended next architecture step for Queryeer assistant features.

## Current Foundation

`core.assistant` owns the assistant foundation:

- Assistant provider settings.
- OpenAI-compatible provider transport through Electron main process.
- Active-file-only chat UI in the secondary sidebar.
- Per-file in-memory chat state through `FileStateRegistry`.
- Initial request shape with optional `contextItems` for future context support.

The current chat implementation intentionally avoids hard dependencies on editor, JDBC, query plan, or other feature modules.

## Goal

Open assistant chat and future assistant surfaces to contextual contributions from other Queryeer modules without coupling `core.assistant` to those modules.

Examples:

- `core.editor` contributes full text, selected text, cursor/range context, and edit tools.
- `core.queryengine.jdbc` contributes schema lookup tools.
- `core.queryengine.queryplan` contributes active query-plan context and tools for selecting or marking plan nodes.

## Design Direction

Add an assistant extension registry to the plugin context, following existing Queryeer registry patterns.

Conceptual contract:

```ts
type AssistantContextContribution = {
  id: string;
  title: string;
  order?: number;
  when?: string;
  collect: (context: AssistantContextRequest) => Promise<AssistantContextItem[]>;
};

type AssistantToolContribution = {
  id: string;
  title: string;
  description: string;
  inputSchema: unknown;
  when?: string;
  invoke: (request: AssistantToolInvocation) => Promise<AssistantToolResult>;
};
```

`core.assistant` should own the registry, contribution ordering, applicability filtering, and UI presentation. Feature modules should only register contributions.

## Context Contributions

Context contributions describe data that can be attached to an assistant request.

Examples:

- Active editor selected text.
- Active editor full document text.
- Current query execution output summary.
- Active JDBC connection/schema metadata.
- Query plan summary for the active file.

The chat UI should surface collected context as chips before sending. Chips should be removable so users stay in control of what context is sent.

Contribution applicability should use the same general idea as existing `when` expressions, evaluated against active-file and workbench context.

## Tool Contributions

Tools represent actions the assistant can request and Queryeer can execute.

Examples:

- Replace selected editor text.
- Insert text at cursor.
- Fetch table or procedure schema.
- Mark or select query-plan nodes.
- Run a read-only metadata query through an existing query engine service.

Tool execution should remain Queryeer-owned. Provider adapters may translate model-specific tool calls into Queryeer tool invocations, but they should not own business logic or directly call feature modules.

## Provider Adapter Boundary

Provider adapters should remain transport/protocol adapters.

They may handle:

- Request/response payload shape.
- Model listing.
- Chat completion.
- Future streaming.
- Future provider-specific tool-call serialization.

They should not handle:

- Discovering editor/JDBC/query-plan context.
- Executing Queryeer tools directly.
- Applying edits without assistant registry mediation.

## Recommended Evolution

1. Add `AssistantExtension` / `AssistantRegistry` contracts.
2. Add registry implementation in plugin runtime and expose it through `PluginContext`.
3. Move `contextItems` collection into `core.assistant` chat send flow.
4. Add context chips UI in assistant chat.
5. Add editor context contribution first, because selected text/full document are the simplest high-value cases.
6. Add Queryeer-owned tool invocation flow with explicit UX/permission policy.
7. Add provider-specific tool-call translation for OpenAI-compatible APIs.
8. Add JDBC and query-plan contributions after the base tool lifecycle is tested.

## Constraints

- Chat context remains active-file scoped unless explicitly expanded.
- Chat history remains in view state per file and is not persisted to disk.
- Secret values must not be placed into context items.
- Tool execution must be explicit, auditable, and cancellable where practical.
- Provider adapters must not bypass Queryeer registries or user-facing permission controls.
