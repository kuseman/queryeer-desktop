import type {
  AssistantChatMessage,
  AssistantConnection,
  AssistantModel
} from "@queryeer/api/assistant/Assistant";

export const ASSISTANT_CONNECTIONS_SETTING_ID = "core.assistant.connections";
export const ASSISTANT_CONNECTIONS_RENDERER_ID = "core.assistant.connections.renderer";
export const OPENAI_DEFAULT_HOST = "https://api.openai.com/v1";

export type AssistantConnectionDraft = AssistantConnection;

export type AssistantChatViewState = {
  selectedConnectionId?: string;
  selectedModelId?: string;
  modelsByConnectionId: Record<string, AssistantModel[]>;
  messages: AssistantChatMessage[];
};

export function createAssistantConnection(provider: "openai" | "custom" = "openai"): AssistantConnectionDraft {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    provider,
    apiType: "openai",
    name: provider === "openai" ? "OpenAI" : "Custom Assistant",
    host: provider === "openai" ? OPENAI_DEFAULT_HOST : "http://localhost:1234/v1"
  };
}

export function sanitizeAssistantConnections(value: unknown): AssistantConnectionDraft[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: AssistantConnectionDraft[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : createAssistantConnection().id;
    const provider = record.provider === "custom" ? "custom" : "openai";
    const host = typeof record.host === "string" && record.host.trim()
      ? record.host.trim()
      : provider === "openai" ? OPENAI_DEFAULT_HOST : "http://localhost:1234/v1";
    const name = typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : provider === "openai" ? "OpenAI" : "Custom Assistant";
    const apiKeyRef = parseApiKeyRef(record.apiKeyRef);
    result.push({
      id,
      provider,
      apiType: "openai",
      name,
      host,
      ...(apiKeyRef ? { apiKeyRef } : {})
    });
  }
  return result;
}

function parseApiKeyRef(value: unknown): { secretRef: string } | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const secretRef = (value as Record<string, unknown>).secretRef;
  return typeof secretRef === "string" && secretRef.trim() ? { secretRef: secretRef.trim() } : undefined;
}
