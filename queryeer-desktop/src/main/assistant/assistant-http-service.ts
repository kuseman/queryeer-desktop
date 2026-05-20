import { ipcMain } from "electron";
import type {
  AssistantChatMessage,
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantConnection,
  AssistantListModelsRequest,
  AssistantListModelsResponse,
  AssistantModel
} from "../../contracts/assistant/Assistant.js";

type FetchLike = typeof fetch;

export type AssistantHttpServiceOptions = {
  fetchImpl?: FetchLike;
  resolveSecret: (secretRef: string) => Promise<{ found: boolean; plaintext?: string }>;
  now?: () => Date;
};

type OpenAiModelsResponse = {
  data?: unknown;
  models?: unknown;
};

type ModelRecord = {
    id?: unknown;
    name?: unknown;
    model?: unknown;
    created?: unknown;
    owned_by?: unknown;
    ownedBy?: unknown;
};

type OpenAiChatResponse = {
  model?: unknown;
  choices?: Array<{
    message?: {
      role?: unknown;
      content?: unknown;
    };
  }>;
};

export class AssistantHttpService {
  private readonly fetchImpl: FetchLike;
  private readonly resolveSecret: (secretRef: string) => Promise<{ found: boolean; plaintext?: string }>;
  private readonly now: () => Date;

  public constructor(options: AssistantHttpServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveSecret = options.resolveSecret;
    this.now = options.now ?? (() => new Date());
  }

  public wireIpc(): void {
    ipcMain.handle("assistant:list-models", async (_event, params: AssistantListModelsRequest) => {
      return this.listModels(params);
    });
    ipcMain.handle("assistant:chat-completion", async (_event, params: AssistantChatRequest) => {
      return this.completeChat(params);
    });
  }

  public async listModels(params: AssistantListModelsRequest): Promise<AssistantListModelsResponse> {
    this.assertOpenAiCompatible(params.connection);
    const host = normalizeAssistantHost(params.connection.host);
    const headers = await this.buildHeaders(params.connection);
    const response = await this.fetchJson(`${host}/models`, {
      method: "GET",
      headers
    }) as OpenAiModelsResponse;

    const models = parseModelsResponse(response);
    return {
      models: models
        .sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  public async completeChat(params: AssistantChatRequest): Promise<AssistantChatResponse> {
    this.assertOpenAiCompatible(params.connection);
    if (!params.model.trim()) {
      throw new Error("Assistant model is required");
    }

    const host = normalizeAssistantHost(params.connection.host);
    const headers = await this.buildHeaders(params.connection);
    const response = await this.fetchJson(`${host}/chat/completions`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages.map(toOpenAiMessage),
        stream: false
      })
    }) as OpenAiChatResponse;

    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Assistant provider returned no message content");
    }

    return {
      model: typeof response.model === "string" ? response.model : params.model,
      message: {
        role: "assistant",
        content,
        createdAt: this.now().toISOString()
      }
    };
  }

  private assertOpenAiCompatible(connection: AssistantConnection): void {
    if (connection.apiType !== "openai") {
      throw new Error(`Unsupported assistant API type '${connection.apiType}'`);
    }
  }

  private async buildHeaders(connection: AssistantConnection): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (!connection.apiKeyRef?.secretRef) {
      return headers;
    }

    const resolved = await this.resolveSecret(connection.apiKeyRef.secretRef);
    if (!resolved.found || !resolved.plaintext) {
      throw new Error("Assistant API key could not be resolved. Unlock the security vault or update the connection.");
    }
    headers.Authorization = `Bearer ${resolved.plaintext}`;
    return headers;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    let payload: unknown = undefined;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`Assistant provider returned invalid JSON from ${url}`);
      }
    }

    if (!response.ok) {
      const message = extractProviderError(payload) ?? response.statusText;
      throw new Error(`Assistant provider request failed (${response.status}): ${message}`);
    }
    return payload;
  }
}

export function normalizeAssistantHost(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Assistant provider host is required");
  }
  return trimmed;
}

function toOpenAiMessage(message: AssistantChatMessage): { role: string; content: string } {
  return {
    role: message.role,
    content: message.content
  };
}

function extractProviderError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return undefined;
}

function parseModelsResponse(response: unknown): AssistantModel[] {
  const candidates = Array.isArray(response)
    ? response
    : isRecord(response) && Array.isArray(response.data)
      ? response.data
      : isRecord(response) && Array.isArray(response.models)
        ? response.models
        : [];

  const result: AssistantModel[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }
    const model = candidate as ModelRecord;
    const id = firstString(model.id, model.name, model.model);
    if (!id) {
      continue;
    }
    const ownedBy = firstString(model.owned_by, model.ownedBy);
    result.push({
      id,
      label: id,
      created: typeof model.created === "number" ? model.created : undefined,
      ownedBy
    });
  }
  return result;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
