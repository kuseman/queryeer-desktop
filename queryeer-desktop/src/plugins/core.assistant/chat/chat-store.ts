import { defineStateKey, type FileStateRegistry } from "../../../contracts/files/FileStateRegistry";
import type { AssistantChatMessage, AssistantModel } from "../../../contracts/assistant/Assistant";
import type { AssistantChatViewState } from "../assistant-types";

export const ASSISTANT_CHAT_VIEW_STATE_KEY = defineStateKey<AssistantChatViewState>(
  "core.assistant.chat.viewState"
);

export function getAssistantChatState(
  registry: FileStateRegistry,
  fileId: string
): AssistantChatViewState {
  const existing = registry.get(fileId, ASSISTANT_CHAT_VIEW_STATE_KEY);
  if (existing) {
    return existing;
  }
  const created: AssistantChatViewState = {
    modelsByConnectionId: {},
    messages: []
  };
  registry.set(fileId, ASSISTANT_CHAT_VIEW_STATE_KEY, created);
  return created;
}

export function updateAssistantChatState(
  registry: FileStateRegistry,
  fileId: string,
  updater: (state: AssistantChatViewState) => AssistantChatViewState
): AssistantChatViewState {
  const next = updater(getAssistantChatState(registry, fileId));
  registry.set(fileId, ASSISTANT_CHAT_VIEW_STATE_KEY, next);
  return next;
}

export function setAssistantChatSelection(
  registry: FileStateRegistry,
  fileId: string,
  selection: { connectionId?: string; modelId?: string }
): AssistantChatViewState {
  return updateAssistantChatState(registry, fileId, (state) => ({
    ...state,
    selectedConnectionId: selection.connectionId,
    selectedModelId: selection.modelId
  }));
}

export function setAssistantModels(
  registry: FileStateRegistry,
  fileId: string,
  connectionId: string,
  models: AssistantModel[]
): AssistantChatViewState {
  return updateAssistantChatState(registry, fileId, (state) => ({
    ...state,
    modelsByConnectionId: {
      ...state.modelsByConnectionId,
      [connectionId]: models
    }
  }));
}

export function appendAssistantMessages(
  registry: FileStateRegistry,
  fileId: string,
  messages: AssistantChatMessage[]
): AssistantChatViewState {
  return updateAssistantChatState(registry, fileId, (state) => ({
    ...state,
    messages: [...state.messages, ...messages]
  }));
}

export function clearAssistantMessages(
  registry: FileStateRegistry,
  fileId: string
): AssistantChatViewState {
  return updateAssistantChatState(registry, fileId, (state) => ({
    ...state,
    messages: []
  }));
}
