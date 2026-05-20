import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginContext } from "../../../contracts/plugin/Plugin";
import type { AssistantChatMessage } from "../../../contracts/assistant/Assistant";
import { getCoreSettingsService } from "../../core.settings/service";
import { completeAssistantChat, listAssistantConnections, listAssistantModels } from "../assistant-service";
import {
  appendAssistantMessages,
  getAssistantChatState,
  setAssistantChatSelection,
  setAssistantModels
} from "./chat-store";

type Props = {
  context: PluginContext;
};

export function AssistantChatView({ context }: Props): JSX.Element {
  const [activeFileId, setActiveFileId] = useState(() => context.fileMediator.getActiveFileId());
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => context.fileMediator.onActiveFileChanged((fileId) => {
    setActiveFileId(fileId);
    setError(null);
    setVersion((previous) => previous + 1);
  }), [context.fileMediator]);

  useEffect(() => {
    const service = getCoreSettingsService();
    return service?.subscribe(() => setVersion((previous) => previous + 1)) ?? (() => {});
  }, []);

  const connections = useMemo(() => listAssistantConnections(), [version]);
  const state = activeFileId ? getAssistantChatState(context.fileState, activeFileId) : null;
  const selectedConnection = connections.find((connection) => connection.id === state?.selectedConnectionId) ?? connections[0];
  const models = selectedConnection && state ? state.modelsByConnectionId[selectedConnection.id] ?? [] : [];
  const selectedModelId = state?.selectedModelId && models.some((model) => model.id === state.selectedModelId)
    ? state.selectedModelId
    : models[0]?.id;

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

  const sendMessage = async (): Promise<void> => {
    const content = draft.trim();
    if (!activeFileId || !selectedConnection || !selectedModelId || !content || sending) {
      return;
    }
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
    try {
      const assistantMessage = await completeAssistantChat({
        connection: selectedConnection,
        model: selectedModelId,
        messages: updated.messages
      });
      appendAssistantMessages(context.fileState, activeFileId, [{
        ...assistantMessage,
        id: assistantMessage.id ?? createMessageId()
      }]);
      setVersion((previous) => previous + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
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
      </div>
      <div ref={messageListRef} className="assistant-message-list" aria-live="polite">
        {state?.messages.length ? state.messages.map((message) => (
          <ChatMessage key={message.id ?? `${message.role}-${message.createdAt}-${message.content}`} message={message} />
        )) : <div className="assistant-panel-empty">Ask a question about the active file. Context chips will be added later.</div>}
        {sending && <div className="assistant-spinner">Waiting for assistant...</div>}
      </div>
      {error && <div className="assistant-error">{error}</div>}
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <textarea
          className="assistant-input"
          value={draft}
          placeholder={selectedModelId ? "Message assistant" : "Fetch and select a model first"}
          disabled={!selectedModelId || sending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
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

function ChatMessage({ message }: { message: AssistantChatMessage }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const html = marked.parse(message.content, { async: false }) as string;
    containerRef.current.innerHTML = DOMPurify.sanitize(html);
  }, [message.content]);

  return (
    <article className={`assistant-message assistant-message-${message.role}`}>
      <header>{message.role}</header>
      <div ref={containerRef} className="assistant-markdown" />
    </article>
  );
}

function createMessageId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
