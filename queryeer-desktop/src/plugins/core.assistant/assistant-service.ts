import type {
  AssistantChatMessage,
  AssistantChatTool,
  AssistantConnection,
  AssistantContextItem,
  AssistantModel
} from "../../contracts/assistant/Assistant";
import { getCoreSettingsService } from "../core.settings/service";
import { getCoreSecurityService } from "../core.security/service";
import {
  ASSISTANT_CONNECTIONS_SETTING_ID,
  sanitizeAssistantConnections
} from "./assistant-types";

export function listAssistantConnections(): AssistantConnection[] {
  return sanitizeAssistantConnections(
    getCoreSettingsService()?.getValue(ASSISTANT_CONNECTIONS_SETTING_ID)
  );
}

export async function listAssistantModels(connection: AssistantConnection): Promise<AssistantModel[]> {
  const response = await withVaultRetry(() => window.appShell.listAssistantModels({ connection }));
  return response.models;
}

export async function completeAssistantChat(params: {
  connection: AssistantConnection;
  model: string;
  messages: AssistantChatMessage[];
  contextItems?: AssistantContextItem[];
  tools?: AssistantChatTool[];
}): Promise<AssistantChatMessage> {
  const response = await withVaultRetry(() => window.appShell.completeAssistantChat(params));
  return response.message;
}

function withVaultRetry<T>(operation: () => Promise<T>): Promise<T> {
  return getCoreSecurityService()?.withVaultRetry(operation) ?? operation();
}
