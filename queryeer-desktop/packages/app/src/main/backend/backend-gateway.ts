import { ipcMain } from "electron";
import {
  BACKEND_DEFAULT_REQUESTED_CAPABILITIES,
  BACKEND_PROTOCOL_VERSION,
  type BackendEnvelope,
  type BackendGatewayStatus,
  type BackendNotificationEnvelope,
  type BackendRequestEnvelope,
  type BackendResponseEnvelope,
  type FileChangeNotification,
  type FileCloseParams,
  type FileCloseResult,
  type FileOpenParams,
  type FileOpenResult,
  type EngineInvokeParams,
  type EngineInvokeResult,
  type HandshakeParams,
  type HandshakeResult,
  type PingParams,
  type PingResult,
  type SecuritySessionOpenParams,
  type SecuritySessionOpenResult,
  type SecuritySessionCloseParams,
  type SecuritySessionCloseResult,
  type SecurityVaultChangedParams,
  type SecurityVaultChangedResult,
  type SettingsModuleChangedNotification,
  type RuntimeStatusResult,
  type QueryCancelParams,
  type QueryCancelResult,
  type QueryExecuteParams,
  type QueryExecuteResult,
  type AboutPluginChangelogsResult
} from "@queryeer/api/backend/index.js";
import { BackendExecutionStore } from "./backend-execution-store.js";
import { BackendLogBuffer } from "./backend-log-buffer.js";
import { redactErrorMessage, redactLogMessage } from "./backend-log-redaction.js";
import { BackendPendingRequestMap } from "./backend-request-pending-map.js";
import { BackendStatusStore } from "./backend-status-store.js";
import { WatchdogBackendTransport } from "./backend-transport-watchdog.js";
import type { BackendTransport, BackendTransportFactory } from "./backend-transport.js";

class BackendResponseError extends Error {
  constructor(
    public readonly code: string,
    public readonly originalMessage: string
  ) {
    super(`${code}: ${originalMessage}`);
  }
}

type GatewayLogLevel = "trace" | "debug" | "info" | "warn" | "error";

const REQUIRED_SECURITY_CAPABILITIES = [
  "security.session.open",
  "security.session.close",
  "security.vault.changed"
] as const;

export class BackendGateway {
  private readonly transport: BackendTransport;
  private readonly statusStore = new BackendStatusStore();
  private readonly logBuffer = new BackendLogBuffer(250);
  private readonly pending = new BackendPendingRequestMap();
  private readonly executionStore = new BackendExecutionStore();
  private requestCounter = 0;
  private startupPromise: Promise<void> | null = null;
  private pingIntervalHandle: NodeJS.Timeout | null = null;
  private rendererSink: ((method: string, params: unknown) => void) | null = null;
  private statusChangedSink: ((status: BackendGatewayStatus) => void) | null = null;
  private transportDiedHook: (() => void) | null = null;
  private tracePayloads = false;
  private logFlowEnabled = true;

  public constructor(factory: BackendTransportFactory) {
    this.statusStore.setOnChange((status) => {
      this.statusChangedSink?.(status);
    });

    const onDiagnostic = ({
      level,
      message,
      source
    }: {
      level: "debug" | "info" | "warn" | "error";
      source: "transport" | "backend" | "backend-console";
      message: string;
    }): void => {
      if (
        (source === "backend" || source === "backend-console") &&
        this.transport.mode === "dev-maven"
      ) {
        const debugPort = extractJavaDebugPort(message);
        if (debugPort !== undefined) {
          this.statusStore.setJavaDebugPort(debugPort);
        }
      }

      if (source === "backend-console") {
        return;
      }

      this.appendLog(level, source, message);

      if (level !== "error") {
        return;
      }
      this.statusStore.setState("unavailable", message);
    };

    this.transport = new WatchdogBackendTransport(
      factory,
      {
        onEnvelope: (envelope) => this.onBackendEnvelope(envelope),
        onDiagnostic
      },
      () => this.doRestartSequence(),
      () => {
        this.transportDiedHook?.();
      }
    );

    this.statusStore.initializeMode(this.transport.mode);
    this.syncExecutionSnapshot();
    this.syncLogSnapshot();
  }

  public setRendererSink(sink: (method: string, params: unknown) => void): void {
    this.rendererSink = sink;
  }

  public setStatusChangedSink(sink: ((status: BackendGatewayStatus) => void) | null): void {
    this.statusChangedSink = sink;
  }

  public setOnTransportDiedHook(hook: (() => void) | null): void {
    this.transportDiedHook = hook;
  }

  public wireIpc(): void {
    ipcMain.handle("backend:get-status", async () => this.getStatus());
    ipcMain.handle("backend:toggle-trace", async (_event, enabled: boolean) => {
      this.setTracePayloads(enabled);
    });
    ipcMain.handle("backend:set-log-flow", async (_event, enabled: boolean) => {
      this.setLogFlowEnabled(enabled);
    });
    ipcMain.handle("backend:clear-logs", async () => {
      this.clearLogs();
    });
    ipcMain.handle("backend:execute-query", async (_event, params: QueryExecuteParams) => {
      return this.executeQuery(params);
    });
    ipcMain.handle("backend:cancel-query", async (_event, params: QueryCancelParams) => {
      return this.cancelQuery(params);
    });
    ipcMain.handle("backend:engine-invoke", async (_event, params: EngineInvokeParams) => {
      return this.invokeEngine(params);
    });
    ipcMain.handle("backend:file-open", async (_event, params: FileOpenParams) => {
      return this.openFile(params);
    });
    ipcMain.handle("backend:file-close", async (_event, params: FileCloseParams) => {
      return this.closeFile(params);
    });
    ipcMain.handle("backend:file-change", async (_event, params: FileChangeNotification) => {
      return this.notifyFileChange(params);
    });
    ipcMain.handle("backend:settings-module-changed", async (_event, params: SettingsModuleChangedNotification) => {
      return this.notifySettingsModuleChanged(params);
    });
    ipcMain.handle("backend:fetch-plugin-changelogs", async () => {
      return this.fetchPluginChangelogs();
    });
  }

  public async start(): Promise<void> {
    this.startupPromise = this.doStart();
    await this.startupPromise;
  }

  public getStatus(): BackendGatewayStatus {
    return this.statusStore.get();
  }

  public setTracePayloads(enabled: boolean): void {
    this.tracePayloads = enabled;
    this.statusStore.setTracePayloads(enabled);
    this.syncLogSnapshot();
  }

  public setLogFlowEnabled(enabled: boolean): void {
    this.logFlowEnabled = enabled;
    if (!enabled) {
      this.logBuffer.clear();
      this.syncLogSnapshot();
    }
  }

  public clearLogs(): void {
    this.logBuffer.clear();
    this.syncLogSnapshot();
  }

  public async stop(): Promise<void> {
    if (this.pingIntervalHandle) {
      clearInterval(this.pingIntervalHandle);
      this.pingIntervalHandle = null;
    }
    await this.transport.stop();
  }

  public async executeQuery(params: QueryExecuteParams): Promise<QueryExecuteResult> {
    const resolvedParams = this.resolveSecretReferences(params) as QueryExecuteParams;

    this.executionStore.markAccepted(resolvedParams.queryExecutionId, resolvedParams.engineId);
    this.syncExecutionSnapshot();

    await this.waitUntilHealthy(30_000);
    if (this.statusStore.get().state !== "healthy") {
      throw new Error(this.statusStore.get().error ?? "Backend is not healthy yet");
    }

    const envelope = this.createRequest("queryengine.execute", resolvedParams);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} queryengine.execute`);
    if (this.tracePayloads) {
      this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
    }
    const response = await this.sendRequest(envelope);
    if (!response.result) {
      throw new Error("queryengine.execute failed: missing result");
    }
    return response.result as QueryExecuteResult;
  }

  public async cancelQuery(params: QueryCancelParams): Promise<QueryCancelResult> {
    const envelope = this.createRequest("queryengine.cancel", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} queryengine.cancel`);
    if (this.tracePayloads) {
      this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
    }
    const response = await this.sendRequest(envelope);
    if (!response.result) {
      throw new Error("queryengine.cancel failed: missing result");
    }
    return response.result as QueryCancelResult;
  }

  public async invokeEngine(params: EngineInvokeParams): Promise<EngineInvokeResult> {
    const resolvedParams = this.resolveSecretReferences(params) as EngineInvokeParams;
    const envelope = this.createRequest("queryengine.invoke", resolvedParams);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} queryengine.invoke`);
    await this.waitUntilHealthy(30_000);
    if (this.statusStore.get().state !== "healthy") {
      return { error: { code: "BACKEND_NOT_READY", message: this.statusStore.get().error ?? "Backend is not healthy yet" } };
    }
    if (this.tracePayloads) {
      this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
    }
    try {
      const response = await this.sendRequest(envelope);
      return (response.result ?? {}) as EngineInvokeResult;
    } catch (e) {
      if (e instanceof BackendResponseError) {
        return { error: { code: e.code, message: e.originalMessage } };
      }
      const message = e instanceof Error ? e.message : String(e);
      return { error: { code: "INVOKE_ERROR", message } };
    }
  }

  public async notifySecuritySessionOpen(params: SecuritySessionOpenParams): Promise<SecuritySessionOpenResult> {
    const envelope = this.createRequest("security.session.open", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} security.session.open`);
    const response = await this.sendRequest(envelope);
    return (response.result ?? { accepted: false }) as SecuritySessionOpenResult;
  }

  public async notifySecuritySessionClose(
    params: SecuritySessionCloseParams
  ): Promise<SecuritySessionCloseResult> {
    const envelope = this.createRequest("security.session.close", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} security.session.close`);
    const response = await this.sendRequest(envelope);
    return (response.result ?? { accepted: false }) as SecuritySessionCloseResult;
  }

  public async notifySecurityVaultChanged(
    params: SecurityVaultChangedParams
  ): Promise<SecurityVaultChangedResult> {
    const envelope = this.createRequest("security.vault.changed", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} security.vault.changed`);
    const response = await this.sendRequest(envelope);
    return (response.result ?? { accepted: false }) as SecurityVaultChangedResult;
  }

  private resolveSecretReferences(value: unknown): unknown {
    return value;
  }


  public async openFile(params: FileOpenParams): Promise<FileOpenResult> {
    const envelope = this.createRequest("file.open", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} file.open`);
    if (this.tracePayloads) {
      this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
    }
    const response = await this.sendRequest(envelope, 30_000);
    if (!response.result) {
      throw new Error("file.open failed: missing result");
    }
    return response.result as FileOpenResult;
  }

  public async closeFile(params: FileCloseParams): Promise<FileCloseResult> {
    const envelope = this.createRequest("file.close", params);
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} file.close`);
    if (this.tracePayloads) {
      this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
    }
    const response = await this.sendRequest(envelope);
    if (!response.result) {
      throw new Error("file.close failed: missing result");
    }
    return response.result as FileCloseResult;
  }

  public notifyFileChange(params: FileChangeNotification): void {
    const envelope: BackendNotificationEnvelope<"file.change", FileChangeNotification> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "notification",
      method: "file.change",
      params
    };
    this.appendLog("debug", "gateway", `Sending notification file.change (${params.fileId}@${params.version})`);
    if (this.tracePayloads) {
      this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
    }
    try {
      this.transport.sendEnvelope(envelope);
    } catch (error) {
      const message = redactErrorMessage(error);
      this.appendLog("error", "gateway", `Send file.change failed: ${message}`);
    }
  }

  public notifySettingsModuleChanged(params: SettingsModuleChangedNotification): void {
    const envelope: BackendNotificationEnvelope<"settings.module.changed", SettingsModuleChangedNotification> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "notification",
      method: "settings.module.changed",
      params
    };
    this.appendLog("debug", "gateway", `Sending notification settings.module.changed (${params.moduleId}@${params.version})`);
    if (this.tracePayloads) {
      this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
    }
    try {
      this.transport.sendEnvelope(envelope);
    } catch (error) {
      const message = redactErrorMessage(error);
      this.appendLog("error", "gateway", `Send settings.module.changed failed: ${message}`);
    }
  }

  public async fetchPluginChangelogs(): Promise<AboutPluginChangelogsResult> {
    await this.waitUntilHealthy(5_000);
    if (this.statusStore.get().state !== "healthy") {
      return { plugins: [] };
    }
    const envelope = this.createRequest("about.pluginChangelogs", {});
    this.appendLog("debug", "gateway", `Sending request ${envelope.id} about.pluginChangelogs`);
    try {
      const response = await this.sendRequest(envelope, 10_000);
      if (!response.result) {
        return { plugins: [] };
      }
      return response.result as AboutPluginChangelogsResult;
    } catch (e) {
      this.appendLog("warn", "gateway", `Failed to fetch plugin changelogs: ${redactErrorMessage(e)}`);
      return { plugins: [] };
    }
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

  private async doRestartSequence(): Promise<void> {
    const inner = async (): Promise<void> => {
      this.appendLog("info", "gateway", "Backend restart sequence initiated");
      this.statusStore.setState("starting");

      if (this.pingIntervalHandle) {
        clearInterval(this.pingIntervalHandle);
        this.pingIntervalHandle = null;
      }
      this.pending.rejectAll(new Error("Backend restarted"));

      try {
        await this.performHandshake();
        await this.performPing();
        await this.performRuntimeStatusSync();
        this.startPingLoop();
        this.statusStore.setState("healthy");
        this.appendLog("info", "gateway", "Backend restart sequence completed");
      } catch (error) {
        const message = redactErrorMessage(error);
        this.appendLog("error", "gateway", `Backend restart sequence failed: ${message}`);
        this.statusStore.setState("unavailable", message);
      }
    };

    this.startupPromise = inner();
    await this.startupPromise;
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
    this.ensureRequiredSecurityCapabilities(result.supportedCapabilities);
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
      rttMs: Date.now() - startedAt,
      jvmHeapUsedBytes: result.jvmHeapUsedBytes,
      jvmHeapMaxBytes: result.jvmHeapMaxBytes
    });
    if (typeof result.javaDebugPort === "number" && result.javaDebugPort > 0) {
      this.statusStore.setJavaDebugPort(result.javaDebugPort);
    }

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
      | "security.session.open"
      | "security.session.close"
      | "security.vault.changed"
      | "health.ping"
      | "queryengine.execute"
      | "queryengine.cancel"
      | "queryengine.invoke"
      | "file.open"
      | "file.close"
      | "about.pluginChangelogs",
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

  private async sendRequest(
    envelope: BackendRequestEnvelope,
    timeoutMs = 10_000
  ): Promise<BackendResponseEnvelope> {
    if (
      envelope.method !== "backend.handshake" &&
      envelope.method !== "health.ping" &&
      envelope.method !== "backend.runtimeStatus" &&
      this.statusStore.get().state !== "healthy"
    ) {
      throw new Error(this.statusStore.get().error ?? "Backend is not healthy yet");
    }

    return new Promise<BackendResponseEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.cancel(envelope.id);
        this.appendLog(
          "warn",
          "gateway",
          `Request timeout ${envelope.id} ${envelope.method}; pending=${this.pending.size()}`
        );
        reject(new Error(`Request timeout: ${envelope.method}`));
      }, timeoutMs);

      this.pending.register(envelope.id, timeout, {
        onResolve: (response) => {
          if (response.error) {
            const errorDetail = response.error.message
              ? `${response.error.code}: ${redactLogMessage(response.error.message)}`
              : response.error.code;
            const details = response.error.details
              ? redactLogMessage(JSON.stringify(response.error.details))
              : null;
            this.appendLog(
              "error",
              "gateway",
              `Request failed ${envelope.id} ${envelope.method}: ${errorDetail}${details ? ` details=${details}` : ""}`
            );
            reject(new BackendResponseError(response.error.code, response.error.message));
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
      if (this.tracePayloads) {
        this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
      }
      const resolved = this.pending.resolve(envelope.id, envelope);
      if (!resolved) {
        this.appendLog("warn", "gateway", `No pending request for response ${envelope.id}`);
      }
      return;
    }

    if (envelope.type === "notification") {
      const qid = envelope.queryId ? ` [${envelope.queryId}]` : "";
      this.appendLog("debug", "gateway", `Received notification ${envelope.method}${qid}`);
      if (this.tracePayloads) {
        this.appendLog("trace", "gateway", `  payload: ${JSON.stringify(envelope)}`);
      }
      this.handleNotification(envelope);
    }
  }

  private handleNotification(envelope: BackendNotificationEnvelope): void {
    if (envelope.method === "queryengine.progress") {
      const params = envelope.params as {
        queryExecutionId: string;
        percent?: number;
        message?: string;
      };
      this.executionStore.onProgress(params);
      this.syncExecutionSnapshot();
      this.statusStore.setState("healthy", params.queryExecutionId === "health-probe" ? undefined : params.message);
      this.rendererSink?.(envelope.method, envelope.params);
      return;
    }

    if (envelope.method === "queryengine.chunkStart") {
      this.rendererSink?.(envelope.method, envelope.params);
      return;
    }

    if (envelope.method === "queryengine.chunkRows") {
      const params = envelope.params as {
        queryExecutionId: string;
        rows?: unknown[][];
      };
      this.executionStore.onResultChunk(params);
      this.syncExecutionSnapshot();
      this.rendererSink?.(envelope.method, envelope.params);
      return;
    }

    if (envelope.method === "queryengine.completed") {
      const params = envelope.params as {
        queryExecutionId: string;
      };
      this.executionStore.onCompleted(params);
      this.syncExecutionSnapshot();
      this.rendererSink?.(envelope.method, envelope.params);
      return;
    }

    if (envelope.method === "queryengine.failed") {
      const params = envelope.params as {
        queryExecutionId: string;
        error?: { code?: string; message?: string };
      };
      this.executionStore.onFailed(params);
      this.syncExecutionSnapshot();
      this.rendererSink?.(envelope.method, envelope.params);
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
    if (!this.logFlowEnabled && level === "trace") {
      return;
    }
    this.logBuffer.append({ level, source, message: redactLogMessage(message) });
    this.syncLogSnapshot();
  }

  private syncLogSnapshot(): void {
    this.statusStore.updateLogs(this.logBuffer.toArray());
  }

  private ensureRequiredSecurityCapabilities(supportedCapabilities: readonly string[]): void {
    const missing = REQUIRED_SECURITY_CAPABILITIES.filter(
      (capability) => !supportedCapabilities.includes(capability)
    );
    if (missing.length === 0) {
      return;
    }

    throw new Error(
      `Backend missing required security capabilities: ${missing.join(", ")}`
    );
  }
}

function extractJavaDebugPort(message: string): number | undefined {
  const classicMatch = /listening\s+for\s+transport\s+dt_socket\s+at\s+address:\s*(\d+)/i.exec(message);
  if (classicMatch) {
    return Number.parseInt(classicMatch[1], 10);
  }

  const genericAddressMatch = /\baddress:\s*(?:[^\s:]+:)?(\d+)\s*$/i.exec(message);
  if (genericAddressMatch) {
    return Number.parseInt(genericAddressMatch[1], 10);
  }

  return undefined;
}
