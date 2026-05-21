import type { SecretRefValue } from "../security/Security.js";
import type { FileEntity } from "../files/FileEntity.js";

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

export type AssistantChatRole = "system" | "user" | "assistant" | "tool";

export type AssistantChatTool = {
  id: string;
  title: string;
  description: string;
  inputSchema: unknown;
};

export type AssistantChatToolCall = {
  id: string;
  toolId: string;
  input: unknown;
};

export type AssistantChatMessage = {
  id?: string;
  role: AssistantChatRole;
  content: string;
  createdAt?: string;
  toolCalls?: AssistantChatToolCall[];
  toolCallId?: string;
  toolName?: string;
  providerMetadata?: Record<string, unknown>;
};

export type AssistantContextItem = {
  id: string;
  label: string;
  kind: string;
  value: unknown;
  metadata?: Record<string, unknown>;
};

export type AssistantContextRequest = {
  activeFileId: string | null;
  activeFile?: FileEntity;
  contextValues: Record<string, unknown>;
};

export type AssistantContextContribution = {
  id: string;
  title: string;
  order?: number;
  when?: string;
  collect: (request: AssistantContextRequest) => Promise<AssistantContextItem[]> | AssistantContextItem[];
};

export type AssistantToolInvocation = {
  toolId: string;
  input: unknown;
  activeFileId: string | null;
  contextValues: Record<string, unknown>;
};

export type AssistantToolResult = {
  ok: boolean;
  message?: string;
  data?: unknown;
};

export type AssistantToolApproval = {
  title?: string;
  summary?: string;
  details?: Array<{ label: string; value: string }>;
  before?: string;
  after?: string;
};

export type AssistantToolContribution = {
  id: string;
  title: string;
  description: string;
  inputSchema: unknown;
  order?: number;
  when?: string;
  getApproval?: (request: AssistantToolInvocation) => AssistantToolApproval | Promise<AssistantToolApproval>;
  invoke: (request: AssistantToolInvocation) => Promise<AssistantToolResult> | AssistantToolResult;
};

export type AssistantRegistry = {
  registerContextContribution: (contribution: AssistantContextContribution) => () => void;
  registerToolContribution: (contribution: AssistantToolContribution) => () => void;
  collectContext: (request: AssistantContextRequest) => Promise<AssistantContextItem[]>;
  listTools: (request: AssistantContextRequest) => AssistantToolContribution[];
  invokeTool: (invocation: AssistantToolInvocation) => Promise<AssistantToolResult>;
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
  tools?: AssistantChatTool[];
};

export type AssistantChatResponse = {
  message: AssistantChatMessage;
  model?: string;
};
