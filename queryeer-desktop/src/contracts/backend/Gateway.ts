import type { Capability, RuntimeStatusResult } from "./Types";

export type BackendGatewayMode = "mock-stdio" | "stdio-process";

export type BackendGatewayState = "starting" | "healthy" | "unavailable";

export type BackendGatewayStatus = {
  mode: BackendGatewayMode;
  state: BackendGatewayState;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  supportedCapabilities: Capability[];
  handshakeAt?: string;
  lastPingAt?: string;
  lastPingRttMs?: number;
  activeExecutionIds: string[];
  recentExecutions: QueryExecutionStatus[];
  runtimeStatus?: RuntimeStatusResult;
  backendLogs: BackendLogEntry[];
  error?: string;
};

export type BackendLogLevel = "debug" | "info" | "warn" | "error";

export type BackendLogEntry = {
  timestamp: string;
  level: BackendLogLevel;
  source: "gateway" | "transport" | "backend";
  message: string;
};

export type QueryExecutionState =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type QueryExecutionStatus = {
  queryExecutionId: string;
  engineId?: string;
  state: QueryExecutionState;
  progressPercent?: number;
  progressMessage?: string;
  chunks: number;
  rows: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
};
