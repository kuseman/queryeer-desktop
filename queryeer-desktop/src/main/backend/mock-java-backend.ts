import {
  BACKEND_PROTOCOL_VERSION,
  type BackendEnvelope,
  type BackendNotificationEnvelope,
  type BackendRequestEnvelope,
  type BackendResponseEnvelope,
  type FileBindResult,
  type FileCloseResult,
  type FileOpenResult,
  type HandshakeResult,
  type QueryCancelResult,
  type QueryExecuteResult,
  type PingResult,
  type RuntimeStatusResult
} from "../../contracts/backend/index.js";

type EnvelopeSink = (envelope: BackendEnvelope) => void;

export class MockJavaBackend {
  private readonly sink: EnvelopeSink;
  private readonly startedAt = Date.now();
  private readonly timers = new Map<string, NodeJS.Timeout[]>();
  private readonly cancelledExecutionIds = new Set<string>();

  public constructor(sink: EnvelopeSink) {
    this.sink = sink;
  }

  public onEnvelope(envelope: BackendEnvelope): void {
    if (envelope.type !== "request") {
      return;
    }

    if (envelope.method === "backend.handshake") {
      this.respondHandshake(envelope as BackendRequestEnvelope<"backend.handshake">);
      return;
    }

    if (envelope.method === "backend.runtimeStatus") {
      this.respondRuntimeStatus(envelope as BackendRequestEnvelope<"backend.runtimeStatus">);
      return;
    }

    if (envelope.method === "health.ping") {
      this.respondPing(envelope as BackendRequestEnvelope<"health.ping">);
      return;
    }

    if (envelope.method === "query.execute") {
      this.respondExecute(envelope as BackendRequestEnvelope<"query.execute">);
      return;
    }

    if (envelope.method === "query.cancel") {
      this.respondCancel(envelope as BackendRequestEnvelope<"query.cancel">);
      return;
    }

    if (envelope.method === "engine.invoke") {
      this.respondEngineInvoke(envelope as BackendRequestEnvelope<"engine.invoke">);
      return;
    }

    if (envelope.method === "file.open") {
      this.respondFileOpen(envelope as BackendRequestEnvelope<"file.open">);
      return;
    }

    if (envelope.method === "file.close") {
      this.respondFileClose(envelope as BackendRequestEnvelope<"file.close">);
      return;
    }

    if (envelope.method === "file.bind") {
      this.respondFileBind(envelope as BackendRequestEnvelope<"file.bind">);
      return;
    }

    this.sink({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: envelope.id,
      error: {
        code: "METHOD_NOT_FOUND",
        message: `Unsupported method '${envelope.method}' in mock backend`
      }
    });
  }

  private respondHandshake(request: BackendRequestEnvelope<"backend.handshake">): void {
    const result: HandshakeResult = {
      server: {
        name: "queryeer-java-backend-mock",
        version: "0.1.0"
      },
      selectedProtocolVersion: BACKEND_PROTOCOL_VERSION,
      supportedCapabilities: [
        "backend.runtimeStatus",
        "health.ping",
        "query.execute",
        "query.cancel",
        "engine.invoke",
        "query.progress",
        "query.chunkStart",
        "query.chunkRows",
        "query.completed",
        "query.failed",
        "file.open",
        "file.close",
        "file.bind",
        "file.change"
      ]
    };

    const response: BackendResponseEnvelope<HandshakeResult> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    };

    this.sink(response);
  }

  private respondRuntimeStatus(request: BackendRequestEnvelope<"backend.runtimeStatus">): void {
    const result: RuntimeStatusResult = {
      startedAt: new Date(this.startedAt).toISOString(),
      pluginStatuses: [
        {
          pluginId: "query.payloadbuilder",
          state: "activated",
          reason: "Activated"
        },
        {
          pluginId: "query.jdbc",
          state: "activated",
          reason: "Activated"
        }
      ],
      activatedPluginIds: ["query.payloadbuilder", "query.jdbc"],
      providedCapabilities: ["query.execute", "query.cancel", "engine.invoke"]
    };

    const response: BackendResponseEnvelope<RuntimeStatusResult> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    };

    this.sink(response);
  }

  private respondPing(request: BackendRequestEnvelope<"health.ping">): void {
    const params = request.params as { timestamp?: string };
    const result: PingResult = {
      timestamp: params.timestamp ?? new Date().toISOString(),
      uptimeMs: Date.now() - this.startedAt
    };

    const response: BackendResponseEnvelope<PingResult> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    };

    this.sink(response);

    const heartbeat: BackendNotificationEnvelope<"query.progress", { queryExecutionId: string; percent: number; message: string }> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "notification",
      method: "query.progress",
      params: {
        queryExecutionId: "health-probe",
        percent: 100,
        message: "backend heartbeat"
      }
    };
    this.sink(heartbeat);
  }

  private respondExecute(request: BackendRequestEnvelope<"query.execute">): void {
    const params = request.params as {
      queryExecutionId: string;
      engineId?: string;
    };

    const result: QueryExecuteResult = {
      accepted: true,
      queryExecutionId: params.queryExecutionId
    };

    const response: BackendResponseEnvelope<QueryExecuteResult> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    };
    this.sink(response);

    const timers: NodeJS.Timeout[] = [];

    timers.push(
      setTimeout(() => {
        if (this.cancelledExecutionIds.has(params.queryExecutionId)) {
          return;
        }
        this.sink({
          protocolVersion: BACKEND_PROTOCOL_VERSION,
          type: "notification",
          method: "query.progress",
          params: {
            queryExecutionId: params.queryExecutionId,
            percent: 20,
            message: `Starting ${params.engineId ?? "engine"}`
          }
        });
      }, 150)
    );

    timers.push(
      setTimeout(() => {
        if (this.cancelledExecutionIds.has(params.queryExecutionId)) {
          return;
        }
        this.sink({
          protocolVersion: BACKEND_PROTOCOL_VERSION,
          type: "notification",
          method: "query.chunkStart",
          params: {
            queryExecutionId: params.queryExecutionId,
            resultSetIndex: 0,
            schema: {
              columns: [
                { name: "id", type: "int" },
                { name: "value", type: "string" }
              ]
            }
          }
        });
        this.sink({
          protocolVersion: BACKEND_PROTOCOL_VERSION,
          type: "notification",
          method: "query.chunkRows",
          params: {
            queryExecutionId: params.queryExecutionId,
            resultSetIndex: 0,
            rows: [
              [1, "alpha"],
              [2, "beta"]
            ]
          }
        });
      }, 350)
    );

    timers.push(
      setTimeout(() => {
        if (this.cancelledExecutionIds.has(params.queryExecutionId)) {
          return;
        }
        this.sink({
          protocolVersion: BACKEND_PROTOCOL_VERSION,
          type: "notification",
          method: "query.chunkRows",
          params: {
            queryExecutionId: params.queryExecutionId,
            resultSetIndex: 0,
            rows: [[3, "gamma"]]
          }
        });
      }, 550)
    );

    timers.push(
      setTimeout(() => {
        if (this.cancelledExecutionIds.has(params.queryExecutionId)) {
          return;
        }
        this.sink({
          protocolVersion: BACKEND_PROTOCOL_VERSION,
          type: "notification",
          method: "query.completed",
          params: {
            queryExecutionId: params.queryExecutionId,
            metrics: {
              durationMs: 600,
              rowCount: 3
            }
          }
        });
      }, 700)
    );

    this.timers.set(params.queryExecutionId, timers);
  }

  private respondCancel(request: BackendRequestEnvelope<"query.cancel">): void {
    const params = request.params as {
      queryExecutionId: string;
    };

    this.cancelledExecutionIds.add(params.queryExecutionId);
    for (const timer of this.timers.get(params.queryExecutionId) ?? []) {
      clearTimeout(timer);
    }
    this.timers.delete(params.queryExecutionId);

    const result: QueryCancelResult = {
      accepted: true,
      queryExecutionId: params.queryExecutionId
    };

    const response: BackendResponseEnvelope<QueryCancelResult> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    };
    this.sink(response);

    this.sink({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "notification",
      method: "query.failed",
      params: {
        queryExecutionId: params.queryExecutionId,
        error: {
          code: "CANCELLED",
          message: "Execution cancelled by client"
        }
      }
    });
  }

  private respondFileOpen(request: BackendRequestEnvelope<"file.open">): void {
    const params = request.params as { fileId: string };
    const result: FileOpenResult = {
      fileId: params.fileId,
      backendVersion: 0
    };
    this.sink({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    } satisfies BackendResponseEnvelope<FileOpenResult>);
  }

  private respondFileClose(request: BackendRequestEnvelope<"file.close">): void {
    const params = request.params as { fileId: string };
    const result: FileCloseResult = {
      fileId: params.fileId,
      accepted: true
    };
    this.sink({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    } satisfies BackendResponseEnvelope<FileCloseResult>);
  }

  private respondFileBind(request: BackendRequestEnvelope<"file.bind">): void {
    const params = request.params as { fileId: string; engineId: string };
    const result: FileBindResult = {
      fileId: params.fileId,
      engineId: params.engineId,
      backendVersion: 0
    };
    this.sink({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result
    } satisfies BackendResponseEnvelope<FileBindResult>);
  }

  private respondEngineInvoke(request: BackendRequestEnvelope<"engine.invoke">): void {
    const params = request.params as {
      engineId: string;
      fileId?: string;
      action: string;
      payload?: unknown;
    };

    this.sink({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: request.id,
      result: {
        result: {
          ok: true,
          engineId: params.engineId,
          fileId: params.fileId,
          action: params.action,
          payload: params.payload ?? null
        }
      }
    });
  }
}
