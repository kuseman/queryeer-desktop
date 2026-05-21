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

  it("prepends selected Queryeer context items to chat completions", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "answer" } }]
    }), { status: 200 }));
    const service = new AssistantHttpService({
      fetchImpl: fetchMock as unknown as typeof fetch,
      resolveSecret: async () => ({ found: true, plaintext: "key-1" })
    });

    await service.completeChat({
      connection,
      model: "gpt-test",
      messages: [{ role: "user", content: "question" }],
      contextItems: [{
        id: "ctx-1",
        label: "Selection v3",
        kind: "editor.selection",
        value: { fileId: "file-1", version: 3, text: "select 1" }
      }]
    });

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body.messages[0]).toMatchObject({
      role: "system"
    });
    expect(body.messages[0].content).toContain("Selection v3");
    expect(body.messages[1]).toEqual({ role: "user", content: "question" });
  });

  it("sends tool definitions and parses OpenAI-compatible tool calls", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "core.editor.replaceRange",
              arguments: JSON.stringify({ fileId: "file-1", version: 3, text: "select 2" })
            }
          }]
        }
      }]
    }), { status: 200 })) as unknown as typeof fetch;
    const service = new AssistantHttpService({
      fetchImpl,
      resolveSecret: async () => ({ found: true, plaintext: "key-1" })
    });

    const result = await service.completeChat({
      connection,
      model: "gpt-test",
      messages: [{ role: "user", content: "replace text" }],
      tools: [{
        id: "core.editor.replaceRange",
        title: "Replace Text Range",
        description: "Replace text",
        inputSchema: { type: "object" }
      }]
    });

    const calls = (fetchImpl as unknown as { mock: { calls: Array<[unknown, RequestInit]> } }).mock.calls;
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body.tools).toEqual([{
      type: "function",
      function: {
        name: "core_editor_replaceRange",
        description: "Replace text",
        parameters: { type: "object" }
      }
    }]);
    expect(result.message.toolCalls).toEqual([{
      id: "call-1",
      toolId: "core.editor.replaceRange",
      input: { fileId: "file-1", version: 3, text: "select 2" }
    }]);
  });

  it("maps provider-safe tool names back to Queryeer tool ids", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "core_editor_replaceRange",
              arguments: "{}"
            }
          }]
        }
      }]
    }), { status: 200 })) as unknown as typeof fetch;
    const service = new AssistantHttpService({
      fetchImpl,
      resolveSecret: async () => ({ found: true, plaintext: "key-1" })
    });

    const result = await service.completeChat({
      connection,
      model: "gpt-test",
      messages: [{ role: "user", content: "replace text" }],
      tools: [{
        id: "core.editor.replaceRange",
        title: "Replace Text Range",
        description: "Replace text",
        inputSchema: { type: "object" }
      }]
    });

    expect(result.message.toolCalls?.[0]?.toolId).toBe("core.editor.replaceRange");
  });

  it("serializes tool result messages for follow-up completions", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "done" } }]
    }), { status: 200 }));
    const service = new AssistantHttpService({
      fetchImpl: fetchMock as unknown as typeof fetch,
      resolveSecret: async () => ({ found: true, plaintext: "key-1" })
    });

    await service.completeChat({
      connection,
      model: "gpt-test",
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", toolId: "core.editor.replaceRange", input: { text: "x" } }],
          providerMetadata: { reasoning_content: "thinking" }
        },
        {
          role: "tool",
          content: JSON.stringify({ ok: true }),
          toolCallId: "call-1",
          toolName: "core.editor.replaceRange"
        }
      ]
    });

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>;
    const body = JSON.parse(String(calls[0]?.[1]?.body));
    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: null,
        reasoning_content: "thinking",
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: {
            name: "core_editor_replaceRange",
            arguments: JSON.stringify({ text: "x" })
          }
        }]
      },
      {
        role: "tool",
        content: JSON.stringify({ ok: true }),
        tool_call_id: "call-1",
        name: "core.editor.replaceRange"
      }
    ]);
  });

  it("preserves provider reasoning content on assistant tool-call responses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          reasoning_content: "reasoning trace",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: {
              name: "core_editor_replaceRange",
              arguments: "{}"
            }
          }]
        }
      }]
    }), { status: 200 })) as unknown as typeof fetch;
    const service = new AssistantHttpService({
      fetchImpl,
      resolveSecret: async () => ({ found: true, plaintext: "key-1" })
    });

    const result = await service.completeChat({
      connection,
      model: "deepseek-reasoner",
      messages: [{ role: "user", content: "replace text" }],
      tools: [{
        id: "core.editor.replaceRange",
        title: "Replace Text Range",
        description: "Replace text",
        inputSchema: { type: "object" }
      }]
    });

    expect(result.message.providerMetadata).toEqual({
      reasoning_content: "reasoning trace"
    });
  });
});
