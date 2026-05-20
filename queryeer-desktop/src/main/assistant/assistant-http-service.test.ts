import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() }
}));

import { AssistantHttpService, normalizeAssistantHost } from "./assistant-http-service.js";
import type { AssistantConnection } from "../../contracts/assistant/Assistant.js";

const connection: AssistantConnection = {
  id: "c1",
  provider: "openai",
  apiType: "openai",
  name: "OpenAI",
  host: "https://api.example/v1/",
  apiKeyRef: { secretRef: "secret-1" }
};

describe("AssistantHttpService", () => {
  it("normalizes provider hosts", () => {
    expect(normalizeAssistantHost(" https://api.example/v1/// ")).toBe("https://api.example/v1");
  });

  it("lists OpenAI-compatible models with bearer auth", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "z-model", created: 1, owned_by: "local" },
        { id: "a-model" }
      ]
    }), { status: 200 })) as unknown as typeof fetch;
    const service = new AssistantHttpService({
      fetchImpl,
      resolveSecret: async () => ({ found: true, plaintext: "key-1" })
    });

    const result = await service.listModels({ connection });

    expect(fetchImpl).toHaveBeenCalledWith("https://api.example/v1/models", {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer key-1"
      }
    });
    expect(result.models.map((model) => model.id)).toEqual(["a-model", "z-model"]);
  });

  it("allows custom providers without API keys", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as unknown as typeof fetch;
    const service = new AssistantHttpService({
      fetchImpl,
      resolveSecret: async () => ({ found: false })
    });

    await service.listModels({
      connection: {
        id: "local",
        provider: "custom",
        apiType: "openai",
        name: "Local",
        host: "http://localhost:1234/v1"
      }
    });

    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:1234/v1/models", {
      method: "GET",
      headers: { Accept: "application/json" }
    });
  });

  it("accepts LM Studio model response variants", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      models: [
        { name: "local-model-b" },
        { model: "local-model-a", ownedBy: "lm-studio" }
      ]
    }), { status: 200 })) as unknown as typeof fetch;
    const service = new AssistantHttpService({
      fetchImpl,
      resolveSecret: async () => ({ found: false })
    });

    const result = await service.listModels({
      connection: {
        id: "local",
        provider: "custom",
        apiType: "openai",
        name: "LM Studio",
        host: "http://localhost:1234/api/v1"
      }
    });

    expect(result.models).toEqual([
      { id: "local-model-a", label: "local-model-a", ownedBy: "lm-studio" },
      { id: "local-model-b", label: "local-model-b", ownedBy: undefined }
    ]);
  });

  it("sends non-streaming OpenAI-compatible chat completions", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: "gpt-test",
      choices: [{ message: { role: "assistant", content: "answer" } }]
    }), { status: 200 })) as unknown as typeof fetch;
    const service = new AssistantHttpService({
      fetchImpl,
      resolveSecret: async () => ({ found: true, plaintext: "key-1" }),
      now: () => new Date("2026-01-02T03:04:05.000Z")
    });

    const result = await service.completeChat({
      connection,
      model: "gpt-test",
      messages: [{ role: "user", content: "question" }]
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://api.example/v1/chat/completions", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer key-1",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-test",
        messages: [{ role: "user", content: "question" }],
        stream: false
      })
    });
    expect(result.message).toEqual({
      role: "assistant",
      content: "answer",
      createdAt: "2026-01-02T03:04:05.000Z"
    });
  });
});
