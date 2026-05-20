import type { SecretRefValue } from "../security/Security.js";

export type AssistantProvider = "openai" | "custom";

export type AssistantApiType = "openai";

export type AssistantConnection = {
  id: string;
  provider: AssistantProvider;
  apiType: AssistantApiType;
  name: string;
  host: string;
  apiKeyRef?: SecretRefValue;
};

export type AssistantModel = {
  id: string;
  label?: string;
  created?: number;
  ownedBy?: string;
};

export type AssistantChatRole = "system" | "user" | "assistant";

export type AssistantChatMessage = {
  id?: string;
  role: AssistantChatRole;
  content: string;
  createdAt?: string;
};

export type AssistantContextItem = {
  id: string;
  label: string;
  kind: string;
  value: unknown;
};

export type AssistantListModelsRequest = {
  connection: AssistantConnection;
};

export type AssistantListModelsResponse = {
  models: AssistantModel[];
};

export type AssistantChatRequest = {
  connection: AssistantConnection;
  model: string;
  messages: AssistantChatMessage[];
  contextItems?: AssistantContextItem[];
};

export type AssistantChatResponse = {
  message: AssistantChatMessage;
  model?: string;
};
