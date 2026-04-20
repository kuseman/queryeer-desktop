import type {
  BackendGatewayMode,
  BackendGatewayState,
  BackendGatewayStatus,
  BackendLogEntry,
  Capability,
  RuntimeStatusResult
} from "../../contracts/backend";

export class BackendStatusStore {
  private status: BackendGatewayStatus = {
    mode: "mock-stdio",
    state: "starting",
    supportedCapabilities: [],
    activeExecutionIds: [],
    recentExecutions: [],
    backendLogs: []
  };

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
      error
    };
  }

  public clearError(): void {
    this.status = {
      ...this.status,
      error: undefined
    };
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
  }

  public setPingDetails(params: { timestamp: string; rttMs: number }): void {
    this.status = {
      ...this.status,
      lastPingAt: params.timestamp,
      lastPingRttMs: params.rttMs,
      state: "healthy",
      error: undefined
    };
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
}
