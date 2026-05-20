import type {
  AssistantChatMessage,
  AssistantConnection,
  AssistantModel
} from "../../contracts/assistant/Assistant";
import { getCoreSettingsService } from "../core.settings/service";
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
  const response = await window.appShell.listAssistantModels({ connection });
  return response.models;
}

export async function completeAssistantChat(params: {
  connection: AssistantConnection;
  model: string;
  messages: AssistantChatMessage[];
}): Promise<AssistantChatMessage> {
  const response = await window.appShell.completeAssistantChat(params);
  return response.message;
}
