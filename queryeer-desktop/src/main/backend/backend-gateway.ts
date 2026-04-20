import { ipcMain } from "electron";
import {
  BACKEND_DEFAULT_REQUESTED_CAPABILITIES,
  BACKEND_PROTOCOL_VERSION,
  type BackendEnvelope,
  type BackendGatewayStatus,
  type BackendNotificationEnvelope,
  type BackendRequestEnvelope,
  type BackendResponseEnvelope,
  type HandshakeParams,
  type HandshakeResult,
  type PingParams,
  type PingResult,
  type RuntimeStatusResult,
  type QueryCancelParams,
  type QueryCancelResult,
  type QueryExecuteParams,
  type QueryExecuteResult
} from "../../contracts/backend";
import { BackendExecutionStore } from "./backend-execution-store";
import { BackendLogBuffer } from "./backend-log-buffer";
import { redactErrorMessage, redactLogMessage } from "./backend-log-redaction";
import { BackendPendingRequestMap } from "./backend-request-pending-map";
import { BackendStatusStore } from "./backend-status-store";
import {
  MockBackendTransport,
  StdioProcessBackendTransport,
  type BackendTransport
} from "./backend-transport";

type GatewayLogLevel = "debug" | "info" | "warn" | "error";

export class BackendGateway {
  private readonly transport: BackendTransport;
  private readonly statusStore = new BackendStatusStore();
  private readonly logBuffer = new BackendLogBuffer(250);
  private readonly pending = new BackendPendingRequestMap();
  private readonly executionStore = new BackendExecutionStore();
  private requestCounter = 0;
  private startupPromise: Promise<void> | null = null;
  private pingIntervalHandle: NodeJS.Timeout | null = null;

  public constructor(
    transportFactory?: (
      onEnvelope: (envelope: BackendEnvelope) => void,
      onDiagnostic: (event: {
        level: "debug" | "info" | "warn" | "error";
        source: "transport" | "backend";
        message: string;
      }) => void
    ) => BackendTransport
  ) {
    const onDiagnostic = ({
      level,
      message,
      source
    }: {
      level: "debug" | "info" | "warn" | "error";
      source: "transport" | "backend";
      message: string;
    }): void => {
      this.appendLog(level, source, message);

      if (level !== "error") {
        return;
      }
      this.statusStore.setState("unavailable", message);
    };

    if (transportFactory) {
      this.transport = transportFactory(
        (envelope) => this.onBackendEnvelope(envelope),
        onDiagnostic
      );
    } else {
      const useStdio = process.env.QUERYEER_BACKEND_STDIO === "1";
      this.transport = useStdio
        ? new StdioProcessBackendTransport(
            (envelope) => this.onBackendEnvelope(envelope),
            onDiagnostic
          )
        : new MockBackendTransport((envelope) => this.onBackendEnvelope(envelope));
    }

    this.statusStore.initializeMode(this.transport.mode);
    this.syncExecutionSnapshot();
    this.syncLogSnapshot();
  }

  public wireIpc(): void {
    ipcMain.handle("backend:get-status", async () => this.getStatus());
    ipcMain.handle("backend:execute-query", async (_event, params: QueryExecuteParams) => {
      return this.executeQuery(params);
    });
    ipcMain.handle("backend:cancel-query", async (_event, params: QueryCancelParams) => {
      return this.cancelQuery(params);
    });
  }

  public async start(): Promise<void> {
    this.startupPromise = this.doStart();
    await this.startupPromise;
  }

  public getStatus(): BackendGatewayStatus {
    return this.statusStore.get();
  }

  public async stop(): Promise<void> {
    if (this.pingIntervalHandle) {
      clearInterval(this.pingIntervalHandle);
      this.pingIntervalHandle = null;
    }
    await this.transport.stop();
  }

  public async executeQuery(params: QueryExecuteParams): Promise<QueryExecuteResult> {
    if (this.statusStore.get().state !== "healthy") {
      await this.waitUntilHealthy(12_000);
    }
    if (this.statusStore.get().state !== "healthy") {
      throw new Error(this.statusStore.get().error ?? "Backend is not healthy yet");
    }

    this.executionStore.markAccepted(params.queryExecutionId, params.engineId);
    this.syncExecutionSnapshot();

    const envelope = this.createRequest("query.execute", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} query.execute`);
    const response = await this.sendRequest(envelope);
    if (!response.result) {
      throw new Error("query.execute failed: missing result");
    }
    return response.result as QueryExecuteResult;
  }

  public async cancelQuery(params: QueryCancelParams): Promise<QueryCancelResult> {
    const envelope = this.createRequest("query.cancel", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} query.cancel`);
    const response = await this.sendRequest(envelope);
    if (!response.result) {
      throw new Error("query.cancel failed: missing result");
    }
    return response.result as QueryCancelResult;
  }

  private startPingLoop(): void {
    if (this.pingIntervalHandle) {
      clearInterval(this.pingIntervalHandle);
    }

    this.pingIntervalHandle = setInterval(() => {
      void this.performPing().catch((error) => {
        const message = redactErrorMessage(error);
        this.appendLog("error", "gateway", `Ping loop failed: ${message}`);
        this.statusStore.setState("unavailable", message);
      });
    }, 5000);
  }

  private async doStart(): Promise<void> {
    this.appendLog("info", "gateway", "Backend startup initiated");
    this.statusStore.setState("starting");

    try {
      await this.transport.start();
      this.appendLog("info", "gateway", "Transport started");
      await this.performHandshake();
      await this.performPing();
      await this.performRuntimeStatusSync();
      this.startPingLoop();
      this.appendLog("info", "gateway", "Backend startup completed");
      this.statusStore.setState("healthy");
    } catch (error) {
      const message = redactErrorMessage(error);
      this.appendLog("error", "gateway", `Backend startup failed: ${message}`);
      this.statusStore.setState("unavailable", message);
    }
  }

  private async waitUntilHealthy(timeoutMs: number): Promise<void> {
    if (this.startupPromise) {
      await this.startupPromise;
      if (this.statusStore.get().state === "healthy") {
        return;
      }
    }

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        const status = this.statusStore.get();
        if (status.state === "healthy") {
          clearInterval(timer);
          resolve();
          return;
        }
        if (status.state === "unavailable") {
          clearInterval(timer);
          reject(new Error(status.error ?? "Backend unavailable"));
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          reject(new Error("Timed out while waiting for backend startup"));
        }
      }, 120);
    }).catch((error) => {
      const message = redactErrorMessage(error);
      const status = this.statusStore.get();
      this.statusStore.setState(status.state === "healthy" ? "healthy" : "unavailable", message);
    });
  }

  private async performHandshake(): Promise<void> {
    const params: HandshakeParams = {
      client: {
        name: "queryeer-electron",
        version: "0.1.0"
      },
      supportedProtocolMajors: [1],
      requestedCapabilities: [...BACKEND_DEFAULT_REQUESTED_CAPABILITIES]
    };

    const envelope = this.createRequest("backend.handshake", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} backend.handshake`);
    const response = await this.sendRequest(envelope, 90_000);
    if (!response.result) {
      throw new Error("Handshake failed: missing result");
    }

    const result = response.result as HandshakeResult;
    this.statusStore.setHandshakeDetails({
      protocolVersion: result.selectedProtocolVersion,
      serverName: result.server.name,
      serverVersion: result.server.version,
      supportedCapabilities: result.supportedCapabilities
    });
  }

  private async performPing(): Promise<void> {
    const startedAt = Date.now();
    const params: PingParams = {
      timestamp: new Date().toISOString()
    };

    const envelope = this.createRequest("health.ping", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} health.ping`);
    const response = await this.sendRequest(envelope, 12_000);
    if (!response.result) {
      throw new Error("Ping failed: missing result");
    }

    const result = response.result as PingResult;
    this.statusStore.setPingDetails({
      timestamp: result.timestamp,
      rttMs: Date.now() - startedAt
    });

    if (this.statusStore.get().supportedCapabilities.includes("backend.runtimeStatus")) {
      void this.performRuntimeStatusSync().catch((error) => {
        this.appendLog("warn", "gateway", `Runtime status refresh failed: ${redactErrorMessage(error)}`);
      });
    }
  }

  private async performRuntimeStatusSync(): Promise<void> {
    const envelope = this.createRequest("backend.runtimeStatus", { includeCapabilities: true });
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} backend.runtimeStatus`);
    const response = await this.sendRequest(envelope, 10_000);
    if (!response.result) {
      throw new Error("Runtime status failed: missing result");
    }

    const runtimeStatus = response.result as RuntimeStatusResult;
    this.statusStore.setRuntimeStatus(runtimeStatus);
  }

  private createRequest<
    TMethod extends
      | "backend.handshake"
      | "backend.runtimeStatus"
      | "health.ping"
      | "query.execute"
      | "query.cancel",
    TParams
  >(
    method: TMethod,
    params: TParams
  ): BackendRequestEnvelope<TMethod, TParams> {
    this.requestCounter += 1;
    return {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "request",
      id: `req-${this.requestCounter}`,
      method,
      params
    };
  }

  private sendRequest(
    envelope: BackendRequestEnvelope,
    timeoutMs = 10_000
  ): Promise<BackendResponseEnvelope> {
    return new Promise<BackendResponseEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.cancel(envelope.id);
        this.appendLog(
          "error",
          "gateway",
          `Request timeout ${envelope.id} ${envelope.method}; pending=${this.pending.size()}`
        );
        reject(new Error(`Request timeout: ${envelope.method}`));
      }, timeoutMs);

      this.pending.register(envelope.id, timeout, {
        onResolve: (response) => {
          if (response.error) {
            this.appendLog(
              "error",
              "gateway",
              `Request failed ${envelope.id} ${envelope.method}: ${response.error.code}`
            );
            reject(new Error(`${response.error.code}: ${response.error.message}`));
            return;
          }
          this.appendLog("debug", "gateway", `Response ok ${envelope.id} ${envelope.method}`);
          resolve(response);
        },
        onReject: (reason) => {
          reject(reason);
        }
      });

      try {
        this.transport.sendEnvelope(envelope);
      } catch (error) {
        this.pending.cancel(envelope.id);
        const message = redactErrorMessage(error);
        this.appendLog("error", "gateway", `Send failed ${envelope.id} ${envelope.method}: ${message}`);
        this.statusStore.setState("unavailable", message);
        reject(new Error(message));
      }
    });
  }

  private onBackendEnvelope(envelope: BackendEnvelope): void {
    if (envelope.type === "response") {
      this.appendLog("debug", "gateway", `Received response ${envelope.id}`);
      const resolved = this.pending.resolve(envelope.id, envelope);
      if (!resolved) {
        this.appendLog("warn", "gateway", `No pending request for response ${envelope.id}`);
      }
      return;
    }

    if (envelope.type === "notification") {
      this.appendLog("debug", "gateway", `Received notification ${envelope.method}`);
      this.handleNotification(envelope);
    }
  }

  private handleNotification(envelope: BackendNotificationEnvelope): void {
    if (envelope.method === "query.progress") {
      const params = envelope.params as {
        queryExecutionId: string;
        percent?: number;
        message?: string;
      };
      this.executionStore.onProgress(params);
      this.syncExecutionSnapshot();
      this.statusStore.setState("healthy", params.queryExecutionId === "health-probe" ? undefined : params.message);
      return;
    }

    if (envelope.method === "query.resultChunk") {
      const params = envelope.params as {
        queryExecutionId: string;
        rows?: unknown[][];
      };
      this.executionStore.onResultChunk(params);
      this.syncExecutionSnapshot();
      return;
    }

    if (envelope.method === "query.completed") {
      const params = envelope.params as {
        queryExecutionId: string;
      };
      this.executionStore.onCompleted(params);
      this.syncExecutionSnapshot();
      return;
    }

    if (envelope.method === "query.failed") {
      const params = envelope.params as {
        queryExecutionId: string;
        error?: { code?: string; message?: string };
      };
      this.executionStore.onFailed(params);
      this.syncExecutionSnapshot();
    }
  }

  private syncExecutionSnapshot(): void {
    this.statusStore.updateExecutions({
      activeExecutionIds: this.executionStore.getActiveExecutionIds(),
      recentExecutions: this.executionStore.getRecentExecutions(12)
    });
  }

  private appendLog(
    level: GatewayLogLevel,
    source: "gateway" | "transport" | "backend",
    message: string
  ): void {
    this.logBuffer.append({ level, source, message: redactLogMessage(message) });
    this.syncLogSnapshot();
  }

  private syncLogSnapshot(): void {
    this.statusStore.updateLogs(this.logBuffer.toArray());
  }
}
