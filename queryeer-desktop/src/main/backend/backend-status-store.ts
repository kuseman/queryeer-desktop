import type {
  BackendGatewayMode,
  BackendGatewayState,
  BackendGatewayStatus,
  BackendLogEntry,
  Capability,
  RuntimeStatusResult
} from "../../contracts/backend/index.js";

export class BackendStatusStore {
  private status: BackendGatewayStatus = {
    mode: "mock-stdio",
    state: "starting",
    supportedCapabilities: [],
    activeExecutionIds: [],
    recentExecutions: [],
    backendLogs: [],
    tracePayloads: false
  };
  private onChange?: (status: BackendGatewayStatus) => void;

  public setOnChange(callback: (status: BackendGatewayStatus) => void): void {
    this.onChange = callback;
  }

  public initializeMode(mode: BackendGatewayMode): void {
    this.status = {
      ...this.status,
      mode
    };
  }

  public get(): BackendGatewayStatus {
    return this.status;
  }

  public setState(state: BackendGatewayState, error?: string): void {
    this.status = {
      ...this.status,
      state,
      error,
      javaDebugPort: state === "starting" ? undefined : this.status.javaDebugPort
    };
    this.onChange?.(this.status);
  }

  public clearError(): void {
    this.status = {
      ...this.status,
      error: undefined
    };
    this.onChange?.(this.status);
  }

  public setHandshakeDetails(params: {
    protocolVersion: string;
    serverName: string;
    serverVersion: string;
    supportedCapabilities: Capability[];
  }): void {
    this.status = {
      ...this.status,
      protocolVersion: params.protocolVersion,
      serverName: params.serverName,
      serverVersion: params.serverVersion,
      supportedCapabilities: params.supportedCapabilities,
      handshakeAt: new Date().toISOString(),
      error: undefined
    };
    this.onChange?.(this.status);
  }

  public setPingDetails(params: { timestamp: string; rttMs: number; jvmHeapUsedBytes?: number; jvmHeapMaxBytes?: number }): void {
    this.status = {
      ...this.status,
      lastPingAt: params.timestamp,
      lastPingRttMs: params.rttMs,
      jvmMemory: params.jvmHeapUsedBytes !== undefined && params.jvmHeapMaxBytes !== undefined
        ? { heapUsedBytes: params.jvmHeapUsedBytes, heapMaxBytes: params.jvmHeapMaxBytes }
        : this.status.jvmMemory,
      state: "healthy",
      error: undefined
    };
    this.onChange?.(this.status);
  }

  public updateExecutions(params: {
    activeExecutionIds: string[];
    recentExecutions: BackendGatewayStatus["recentExecutions"];
  }): void {
    this.status = {
      ...this.status,
      activeExecutionIds: params.activeExecutionIds,
      recentExecutions: params.recentExecutions
    };
  }

  public updateLogs(logs: BackendLogEntry[]): void {
    this.status = {
      ...this.status,
      backendLogs: logs
    };
  }

  public setRuntimeStatus(runtimeStatus: RuntimeStatusResult): void {
    this.status = {
      ...this.status,
      runtimeStatus
    };
  }

  public setJavaDebugPort(port: number): void {
    this.status = {
      ...this.status,
      javaDebugPort: port
    };
  }

  public setTracePayloads(enabled: boolean): void {
    this.status = {
      ...this.status,
      tracePayloads: enabled
    };
  }
}
