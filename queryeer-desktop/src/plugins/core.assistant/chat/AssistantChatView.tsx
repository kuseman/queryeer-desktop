import DOMPurify from "dompurify";
import { marked } from "marked";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { PluginContext } from "../../../contracts/plugin/Plugin";
import { isPrimaryModifier } from "../../../shared/platform-utils";
import type { AssistantChatMessage, AssistantChatTool, AssistantContextItem, AssistantToolApproval, AssistantToolContribution, AssistantToolResult } from "../../../contracts/assistant/Assistant";
import { getCoreSettingsService } from "../../core.settings/service";
import { getCommandContext, subscribeCommandContext } from "../../core.commands/command-context-accessor";
import { completeAssistantChat, listAssistantConnections, listAssistantModels } from "../assistant-service";
import {
  appendAssistantMessages,
  clearAssistantMessages,
  getAssistantChatState,
  setAssistantChatSelection,
  setAssistantModels
} from "./chat-store";
import { runAssistantToolOrchestration } from "./tool-orchestration";

type Props = {
  context: PluginContext;
};

type PendingToolApproval = {
  toolCall: NonNullable<AssistantChatMessage["toolCalls"]>[number];
  approval?: AssistantToolApproval;
  resolve: (approved: boolean) => void;
};

type ToolApprovalDecision = "deny" | "once" | "session";

function AssistantChatViewComponent({ context }: Props): JSX.Element {
  const [activeFileId, setActiveFileId] = useState(() => context.fileMediator.getActiveFileId());
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextItems, setContextItems] = useState<AssistantContextItem[]>([]);
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(new Set());
  const [pendingToolApproval, setPendingToolApproval] = useState<PendingToolApproval | null>(null);
  const [, setSessionApprovedToolIds] = useState<Set<string>>(new Set());
  const messageListRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const sessionApprovedToolIdsRef = useRef(new Set<string>());

  useEffect(() => context.fileMediator.onActiveFileChanged((fileId) => {
    setActiveFileId(fileId);
    setError(null);
    setContextItems([]);
    setSelectedContextIds(new Set());
    setVersion((previous) => previous + 1);
  }), [context.fileMediator]);

  useEffect(() => {
    const service = getCoreSettingsService();
    return service?.subscribe(() => setVersion((previous) => previous + 1)) ?? (() => {});
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return subscribeCommandContext(() => {
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          setVersion((previous) => previous + 1);
        }, 500);
      }
    });
  }, []);

  const connections = useMemo(() => listAssistantConnections(), [version]);
  const state = activeFileId ? getAssistantChatState(context.fileState, activeFileId) : null;
  const selectedConnection = connections.find((connection) => connection.id === state?.selectedConnectionId) ?? connections[0];
  const models = selectedConnection && state ? state.modelsByConnectionId[selectedConnection.id] ?? [] : [];
  const selectedModelId = state?.selectedModelId && models.some((model) => model.id === state.selectedModelId)
    ? state.selectedModelId
    : models[0]?.id;
  const assistantContextRequest = useMemo(() => {
    const editor = context.editors.getActiveEditor();
    const fileId = activeFileId ?? editor?.fileId ?? null;
    const activeFile = fileId ? context.files.getFile(fileId) : undefined;
    return {
      activeFileId: fileId,
      activeFile,
      contextValues: getCommandContext()
    };
  }, [activeFileId, context.editors, context.files, version]);
  const tools = useMemo(() => context.assistant.listTools(assistantContextRequest), [assistantContextRequest, context.assistant, version]);
  const selectedContextItems = contextItems.filter((item) => selectedContextIds.has(item.id));

  useEffect(() => {
    const element = messageListRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [state?.messages.length, sending, activeFileId]);

  useEffect(() => {
    if (!activeFileId || !selectedConnection) {
      return;
    }
    const current = getAssistantChatState(context.fileState, activeFileId);
    if (current.selectedConnectionId !== selectedConnection.id || current.selectedModelId !== selectedModelId) {
      setAssistantChatSelection(context.fileState, activeFileId, {
        connectionId: selectedConnection.id,
        modelId: selectedModelId
      });
      setVersion((previous) => previous + 1);
    }
  }, [activeFileId, context.fileState, selectedConnection?.id, selectedModelId]);

  const refreshModels = async (): Promise<void> => {
    if (!activeFileId || !selectedConnection) {
      return;
    }
    setLoadingModels(true);
    setError(null);
    try {
      const nextModels = await listAssistantModels(selectedConnection);
      setAssistantModels(context.fileState, activeFileId, selectedConnection.id, nextModels);
      setAssistantChatSelection(context.fileState, activeFileId, {
        connectionId: selectedConnection.id,
        modelId: nextModels[0]?.id
      });
      setVersion((previous) => previous + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModels(false);
    }
  };

  const requestToolApproval = async (toolCall: NonNullable<AssistantChatMessage["toolCalls"]>[number]): Promise<boolean> => {
    if (sessionApprovedToolIdsRef.current.has(toolCall.toolId)) {
      return true;
    }
    const approval = await tools.find((tool) => tool.id === toolCall.toolId)?.getApproval?.({
      toolId: toolCall.toolId,
      input: toolCall.input,
      activeFileId: assistantContextRequest.activeFileId,
      contextValues: assistantContextRequest.contextValues
    });
    return new Promise((resolve) => {
      setPendingToolApproval({ toolCall, approval, resolve });
    });
  };

  const completeToolApproval = (decision: ToolApprovalDecision): void => {
    const pending = pendingToolApproval;
    if (!pending) {
      return;
    }
    setPendingToolApproval(null);
    if (decision === "session") {
      sessionApprovedToolIdsRef.current.add(pending.toolCall.toolId);
      setSessionApprovedToolIds(new Set(sessionApprovedToolIdsRef.current));
    }
    pending.resolve(decision !== "deny");
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const refreshContext = async (options: { preserveSelection?: boolean } = {}): Promise<void> => {
    setError(null);
    try {
      const items = await context.assistant.collectContext(assistantContextRequest);
      const previousItems = contextItems;
      const previousSelectedIds = selectedContextIds;
      setContextItems(items);
      setSelectedContextIds(options.preserveSelection
        ? preserveSelectedContextIds(items, previousItems, previousSelectedIds)
        : new Set(items.map((item) => item.id)));
      setVersion((previous) => previous + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const clearChat = (): void => {
    if (!activeFileId || sending) {
      return;
    }
    clearAssistantMessages(context.fileState, activeFileId);
    setPendingToolApproval(null);
    setError(null);
    setVersion((previous) => previous + 1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    if (!activeFileId) {
      return;
    }
    void refreshContext();
  }, [activeFileId]);

  const sendMessage = async (): Promise<void> => {
    const content = draft.trim();
    if (!activeFileId || !selectedConnection || !selectedModelId || !content || sendingRef.current) {
      return;
    }
    sendingRef.current = true;
    const userMessage: AssistantChatMessage = {
      id: createMessageId(),
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };
    const updated = appendAssistantMessages(context.fileState, activeFileId, [userMessage]);
    setDraft("");
    setSending(true);
    setError(null);
    setVersion((previous) => previous + 1);
    let providerRequestCount = 0;
    try {
      const chatTools = tools.map(toAssistantChatTool);
      await runAssistantToolOrchestration({
        messages: updated.messages,
        requestAssistant: (messages) => {
          providerRequestCount += 1;
          return completeAssistantChat({
            connection: selectedConnection,
            model: selectedModelId,
            messages,
            contextItems: selectedContextItems,
            tools: chatTools
          });
        },
        runTools: (toolCalls) => runRequestedTools(
          context,
          assistantContextRequest,
          toolCalls,
          requestToolApproval
        ),
        createMessageId,
        onMessages: (messages) => {
          appendAssistantMessages(context.fileState, activeFileId, messages);
          setVersion((previous) => previous + 1);
        }
      });
      setVersion((previous) => previous + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(providerRequestCount > 0 ? `${message} Provider requests for this send: ${providerRequestCount}.` : message);
    } finally {
      sendingRef.current = false;
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  if (!activeFileId) {
    return <div className="assistant-panel-empty">Open or activate a file to start an assistant chat.</div>;
  }

  if (connections.length === 0) {
    return (
      <div className="assistant-panel-empty">
        <p>No assistant providers configured.</p>
        <button type="button" className="assistant-button" onClick={() => getCoreSettingsService()?.openModalForSetting("core.assistant.connections")}>
          Open Assistant Settings
        </button>
      </div>
    );
  }

  return (
    <div className="assistant-chat-view">
      <div className="assistant-chat-toolbar">
        <select
          className="assistant-select"
          value={selectedConnection?.id ?? ""}
          onChange={(event) => {
            setAssistantChatSelection(context.fileState, activeFileId, {
              connectionId: event.target.value,
              modelId: undefined
            });
            setVersion((previous) => previous + 1);
          }}
        >
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>{connection.name}</option>
          ))}
        </select>
        <select
          className="assistant-select"
          value={selectedModelId ?? ""}
          disabled={models.length === 0}
          onChange={(event) => {
            setAssistantChatSelection(context.fileState, activeFileId, {
              connectionId: selectedConnection?.id,
              modelId: event.target.value
            });
            setVersion((previous) => previous + 1);
          }}
        >
          {models.length === 0 ? <option value="">Fetch models first</option> : models.map((model) => (
            <option key={model.id} value={model.id}>{model.label ?? model.id}</option>
          ))}
        </select>
        <button type="button" className="assistant-button" onClick={() => void refreshModels()} disabled={loadingModels || !selectedConnection} title="Fetch models">
          {loadingModels ? "..." : "↻"}
        </button>
        <button type="button" className="assistant-button" onClick={clearChat} disabled={sending || !state?.messages.length} title="Clear chat">
          Clear
        </button>
      </div>
      <div ref={messageListRef} className="assistant-message-list" aria-live="polite">
        {state?.messages.length ? state.messages.map((message, index, messages) => {
          if (isGroupedToolResult(message, messages[index - 1])) {
            return null;
          }
          return (
            <ChatMessage
              key={message.id ?? `${message.role}-${message.createdAt}-${message.content}`}
              message={message}
              toolResults={collectToolResults(message, messages, index)}
            />
          );
        }) : <div className="assistant-panel-empty">Ask a question about the active file. Context chips are collected automatically.</div>}
        {sending && <div className="assistant-spinner">Waiting for assistant...</div>}
      </div>
      <AssistantContextChips
        contextItems={contextItems}
        selectedContextIds={selectedContextIds}
        setSelectedContextIds={setSelectedContextIds}
        tools={tools}
      />
      {error && <div className="assistant-error">{error}</div>}
      {pendingToolApproval && (
        <ToolApprovalCard
          toolCall={pendingToolApproval.toolCall}
          approval={pendingToolApproval.approval}
          approveOnce={() => completeToolApproval("once")}
          approveSession={() => completeToolApproval("session")}
          deny={() => completeToolApproval("deny")}
        />
      )}
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <textarea
          ref={inputRef}
          className="assistant-input"
          value={draft}
          placeholder={selectedModelId ? "Message assistant" : "Fetch and select a model first"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && isPrimaryModifier(event)) {
              event.preventDefault();
              void sendMessage();
            }
          }}
        />
        <button type="submit" className="assistant-button assistant-send" disabled={!draft.trim() || !selectedModelId || sending}>
          Send
        </button>
      </form>
    </div>
  );
}

export const AssistantChatView = memo(AssistantChatViewComponent);

async function runRequestedTools(
  context: PluginContext,
  request: {
    activeFileId: string | null;
    contextValues: Record<string, unknown>;
  },
  toolCalls: NonNullable<AssistantChatMessage["toolCalls"]>,
  requestApproval: (toolCall: NonNullable<AssistantChatMessage["toolCalls"]>[number]) => Promise<boolean>
): Promise<AssistantChatMessage[]> {
  const messages: AssistantChatMessage[] = [];
  for (const toolCall of toolCalls) {
    const approved = await requestApproval(toolCall);
    if (!approved) {
      messages.push(createToolResultMessage(toolCall.id, toolCall.toolId, {
        ok: false,
        message: "User denied tool execution."
      }));
      continue;
    }
    const result = await context.assistant.invokeTool({
      toolId: toolCall.toolId,
      input: toolCall.input,
      activeFileId: request.activeFileId,
      contextValues: request.contextValues
    });
    messages.push(createToolResultMessage(toolCall.id, toolCall.toolId, result));
  }
  return messages;
}

function ToolApprovalCard(props: {
  toolCall: NonNullable<AssistantChatMessage["toolCalls"]>[number];
  approval?: AssistantToolApproval;
  approveOnce: () => void;
  approveSession: () => void;
  deny: () => void;
}): JSX.Element {
  const approval = props.approval;
  return (
    <section className="assistant-tool-approval" aria-label="Approve assistant tool">
      <div className="assistant-tool-approval-title">{approval?.title ?? "Run tool?"}</div>
      {approval?.summary ? <div className="assistant-tool-approval-summary">{approval.summary}</div> : null}
      {approval?.details?.length ? (
        <div className="assistant-tool-approval-details">
          {approval.details.map((detail) => (
            <div key={`${detail.label}:${detail.value}`} className="assistant-tool-approval-detail">
              <span>{detail.label}</span>
              <code>{detail.value}</code>
            </div>
          ))}
        </div>
      ) : null}
      {approval?.before !== undefined || approval?.after !== undefined ? (
        <div className="assistant-tool-approval-diff">
          {approval.before !== undefined ? <pre aria-label="Current text">{approval.before}</pre> : null}
          {approval.after !== undefined ? <pre aria-label="Replacement text">{approval.after}</pre> : null}
        </div>
      ) : null}
      <details className="assistant-tool-call-details">
        <summary>{props.toolCall.toolId}</summary>
        <pre>{formatToolPayload(props.toolCall.input)}</pre>
      </details>
      <div className="assistant-tool-approval-actions">
        <button type="button" className="assistant-button" onClick={props.deny}>Deny</button>
        <button type="button" className="assistant-button" onClick={props.approveOnce}>Allow Once</button>
        <button type="button" className="assistant-button" onClick={props.approveSession}>Allow For Session</button>
      </div>
    </section>
  );
}

function createToolResultMessage(toolCallId: string, toolName: string, result: AssistantToolResult): AssistantChatMessage {
  return {
    id: createMessageId(),
    role: "tool",
    content: JSON.stringify(result),
    toolCallId,
    toolName,
    createdAt: new Date().toISOString()
  };
}

function toAssistantChatTool(tool: AssistantToolContribution): AssistantChatTool {
  return {
    id: tool.id,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema
  };
}

function AssistantContextChips(props: {
  contextItems: AssistantContextItem[];
  selectedContextIds: Set<string>;
  setSelectedContextIds: (ids: Set<string>) => void;
  tools: AssistantToolContribution[];
}): JSX.Element {
  return (
    <section className="assistant-context-panel" aria-label="Assistant context">
      <div className="assistant-context-label">Sent context</div>
      <div className="assistant-context-chip-row">
        {props.contextItems.length === 0 ? <span className="assistant-muted">No context</span> : props.contextItems.map((item) => {
          const selected = props.selectedContextIds.has(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`assistant-context-chip${selected ? " assistant-context-chip-selected" : ""}`}
              title={`${item.kind}${formatTextLength(item)}`}
              onClick={() => {
                const next = new Set(props.selectedContextIds);
                if (next.has(item.id)) {
                  next.delete(item.id);
                } else {
                  next.add(item.id);
                }
                props.setSelectedContextIds(next);
              }}
            >
              {item.label} {selected ? "×" : "+"}
            </button>
          );
        })}
      </div>
      <details className="assistant-tools-disclosure">
        <summary>Available tools ({props.tools.length})</summary>
        {props.tools.length === 0 ? <div className="assistant-muted">No tools available</div> : (
          <div className="assistant-tool-list">
            {props.tools.map((tool) => (
              <div key={tool.id} className="assistant-tool-row" title={tool.description}>
                <span>{tool.title}</span>
                <code>{tool.id}</code>
              </div>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}

function ChatMessage({ message, toolResults = [] }: { message: AssistantChatMessage; toolResults?: AssistantChatMessage[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    if (message.role === "tool" || !message.content) {
      containerRef.current.innerHTML = "";
      return;
    }
    const html = marked.parse(message.content, { async: false }) as string;
    containerRef.current.innerHTML = DOMPurify.sanitize(html);
  }, [message.content, message.role]);

  if (message.role === "tool") {
    return (
      <article className="assistant-message assistant-message-tool">
        <ToolActivity toolResults={[message]} />
      </article>
    );
  }

  return (
    <article className={`assistant-message assistant-message-${message.role}`}>
      <header>{message.role}</header>
      <div ref={containerRef} className="assistant-markdown" />
      {message.toolCalls?.length || toolResults.length ? <ToolActivity toolCalls={message.toolCalls} toolResults={toolResults} /> : null}
    </article>
  );
}

function ToolActivity(props: {
  toolCalls?: AssistantChatMessage["toolCalls"];
  toolResults?: AssistantChatMessage[];
}): JSX.Element {
  const toolCalls = props.toolCalls ?? [];
  const toolResults = props.toolResults ?? [];
  const count = Math.max(toolCalls.length, toolResults.length);
  return (
    <details className="assistant-tool-activity">
      <summary>{count === 1 ? "Tool activity" : `Tool activity (${count})`}</summary>
      <div className="assistant-tool-activity-body">
        {toolCalls.map((toolCall) => {
          const result = toolResults.find((message) => message.toolCallId === toolCall.id);
          return (
            <div key={toolCall.id} className="assistant-tool-activity-item">
              <div className="assistant-tool-activity-name">{toolCall.toolId}</div>
              <div className="assistant-tool-activity-label">arguments</div>
              <pre>{formatToolPayload(toolCall.input)}</pre>
              {result && <>
                <div className="assistant-tool-activity-label">result</div>
                <pre>{formatToolPayload(parseJsonOrText(result.content))}</pre>
              </>}
            </div>
          );
        })}
        {toolResults.filter((result) => !toolCalls.some((toolCall) => toolCall.id === result.toolCallId)).map((result) => (
          <div key={result.id ?? result.toolCallId ?? result.content} className="assistant-tool-activity-item">
            <div className="assistant-tool-activity-name">{result.toolName ?? "Tool result"}</div>
            <pre>{formatToolPayload(parseJsonOrText(result.content))}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function isGroupedToolResult(message: AssistantChatMessage, previous: AssistantChatMessage | undefined): boolean {
  return message.role === "tool" && Boolean(previous?.toolCalls?.some((toolCall) => toolCall.id === message.toolCallId));
}

function collectToolResults(message: AssistantChatMessage, messages: AssistantChatMessage[], index: number): AssistantChatMessage[] {
  if (!message.toolCalls?.length) {
    return [];
  }
  const callIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
  const results: AssistantChatMessage[] = [];
  for (let i = index + 1; i < messages.length; i += 1) {
    const candidate = messages[i];
    if (candidate?.role !== "tool") {
      break;
    }
    if (candidate.toolCallId && callIds.has(candidate.toolCallId)) {
      results.push(candidate);
    }
  }
  return results;
}

function formatToolPayload(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTextLength(item: AssistantContextItem): string {
  const length = item.metadata?.textLength;
  return typeof length === "number" ? `, ${length} chars` : "";
}

function preserveSelectedContextIds(
  nextItems: AssistantContextItem[],
  previousItems: AssistantContextItem[],
  previousSelectedIds: Set<string>
): Set<string> {
  const selectedKinds = new Set(
    previousItems
      .filter((item) => previousSelectedIds.has(item.id))
      .map((item) => item.kind)
  );
  return new Set(nextItems
    .filter((item) => selectedKinds.has(item.kind))
    .map((item) => item.id));
}
