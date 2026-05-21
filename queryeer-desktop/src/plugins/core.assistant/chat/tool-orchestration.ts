import type { AssistantChatMessage } from "../../../contracts/assistant/Assistant";

export type AssistantToolOrchestrationResult = {
  messages: AssistantChatMessage[];
  stoppedAfterTooManyRounds: boolean;
};

export type AssistantToolOrchestrationOptions = {
  messages: AssistantChatMessage[];
  requestAssistant: (messages: AssistantChatMessage[]) => Promise<AssistantChatMessage>;
  runTools: (toolCalls: NonNullable<AssistantChatMessage["toolCalls"]>) => Promise<AssistantChatMessage[]>;
  createMessageId: () => string;
  onMessages?: (messages: AssistantChatMessage[]) => void;
  maxToolRounds?: number;
};

export async function runAssistantToolOrchestration(options: AssistantToolOrchestrationOptions): Promise<AssistantToolOrchestrationResult> {
  const maxToolRounds = options.maxToolRounds ?? 5;
  const messages = [...options.messages];
  let assistantMessage = withMessageId(await options.requestAssistant(messages), options.createMessageId);
  messages.push(assistantMessage);
  options.onMessages?.([assistantMessage]);

  let toolRoundCount = 0;
  while (assistantMessage.toolCalls?.length) {
    toolRoundCount += 1;
    if (toolRoundCount > maxToolRounds) {
      const stoppedMessage: AssistantChatMessage = {
        id: options.createMessageId(),
        role: "assistant",
        content: "Stopped tool execution after too many retry rounds.",
        createdAt: new Date().toISOString()
      };
      messages.push(stoppedMessage);
      options.onMessages?.([stoppedMessage]);
      return { messages, stoppedAfterTooManyRounds: true };
    }

    const toolMessages = await options.runTools(assistantMessage.toolCalls);
    messages.push(...toolMessages);
    options.onMessages?.(toolMessages);
    assistantMessage = withMessageId(await options.requestAssistant(messages), options.createMessageId);
    messages.push(assistantMessage);
    options.onMessages?.([assistantMessage]);
  }

  return { messages, stoppedAfterTooManyRounds: false };
}

function withMessageId(message: AssistantChatMessage, createMessageId: () => string): AssistantChatMessage {
  return {
    ...message,
    id: message.id ?? createMessageId()
  };
}
