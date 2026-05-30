import { describe, expect, it } from "vitest";
import type { AssistantChatMessage } from "@queryeer/api/assistant/Assistant";
import { runAssistantToolOrchestration } from "./tool-orchestration";

describe("runAssistantToolOrchestration", () => {
  it("feeds failed tool results back so the assistant can retry and finish", async () => {
    const userMessage: AssistantChatMessage = { id: "user-1", role: "user", content: "replace it" };
    const assistantResponses: AssistantChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-1", toolId: "core.editor.replaceRange", input: { version: 1 } }]
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-2", toolId: "core.editor.replaceRange", input: { version: 2 } }]
      },
      { role: "assistant", content: "Updated the selection." }
    ];
    const requestedMessageCounts: number[] = [];
    const runToolInputs: unknown[] = [];

    const result = await runAssistantToolOrchestration({
      messages: [userMessage],
      requestAssistant: async (messages) => {
        requestedMessageCounts.push(messages.length);
        const response = assistantResponses.shift();
        if (!response) {
          throw new Error("Unexpected assistant request");
        }
        return response;
      },
      runTools: async (toolCalls) => {
        runToolInputs.push(toolCalls[0]?.input);
        const toolCall = toolCalls[0];
        if (!toolCall) {
          return [];
        }
        return [{
          role: "tool",
          content: JSON.stringify(toolCall.id === "call-1"
            ? { ok: false, message: "The document changed since this edit was prepared. Re-read the editor context and try again." }
            : { ok: true, message: "Applied edit." }),
          toolCallId: toolCall.id,
          toolName: toolCall.toolId
        }];
      },
      createMessageId: (() => {
        let id = 0;
        return () => `generated-${++id}`;
      })()
    });

    expect(result.stoppedAfterTooManyRounds).toBe(false);
    expect(requestedMessageCounts).toEqual([1, 3, 5]);
    expect(runToolInputs).toEqual([{ version: 1 }, { version: 2 }]);
    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
    expect(result.messages.at(-1)?.content).toBe("Updated the selection.");
  });
});
