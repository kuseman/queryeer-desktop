import {
  BACKEND_PROTOCOL_VERSION,
  type BackendEnvelope,
  type BackendNotificationEnvelope,
  type BackendRequestEnvelope,
  type BackendResponseEnvelope,
  type HandshakeResult,
  type QueryCancelResult,
  type QueryExecuteResult,
  type PingResult,
  type RuntimeStatusResult
} from "../../contracts/backend";

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
        "query.progress",
        "query.resultChunk",
        "query.completed",
        "query.failed"
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
      providedCapabilities: ["query.execute", "query.cancel"]
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
          method: "query.resultChunk",
          params: {
            queryExecutionId: params.queryExecutionId,
            chunkIndex: 0,
            schema: {
              columns: [
                { name: "id", type: "integer" },
                { name: "value", type: "string" }
              ]
            },
            rows: [
              [1, "alpha"],
              [2, "beta"]
            ],
            isLastChunk: false
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
          method: "query.resultChunk",
          params: {
            queryExecutionId: params.queryExecutionId,
            chunkIndex: 1,
            rows: [[3, "gamma"]],
            isLastChunk: true
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
}
