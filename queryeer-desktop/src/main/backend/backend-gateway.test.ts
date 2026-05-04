import { describe, expect, it, vi, type Mock } from "vitest";
import {
  BACKEND_PROTOCOL_VERSION,
  type BackendError,
  type BackendEnvelope,
  type BackendNotificationEnvelope,
  type BackendRequestEnvelope,
  type BackendResponseEnvelope,
  type HandshakeResult,
  type PingResult,
  type QueryCompletedNotification,
  type RuntimeStatusResult,
  type QueryCancelParams,
  type QueryCancelResult,
  type QueryExecuteParams,
  type QueryExecuteResult
} from "../../contracts/backend/index.js";
import { BackendGateway } from "./backend-gateway.js";

type EnvelopeHandler = (envelope: BackendEnvelope) => void;

type TestTransport = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sendEnvelope: Mock<(envelope: BackendEnvelope) => void>;
  mode: "mock-stdio";
  emitEnvelope: (envelope: BackendEnvelope) => void;
  emitDied: () => void;
  emitDiagnostic: (event: { level: "debug" | "info" | "warn" | "error"; source: "transport" | "backend" | "backend-console"; message: string }) => void;
};

type TransportBehavior = {
  dropHandshake?: boolean;
  dropExecute?: boolean;
  failExecuteSend?: boolean;
  failPingAfterStart?: boolean;
};

const createGatewayWithTestTransport = (behavior: TransportBehavior = {}) => {
  let onEnvelope: EnvelopeHandler | null = null;
  let onDied: (() => void) | null = null;
  let onDiagnostic: ((event: { level: "debug" | "info" | "warn" | "error"; source: "transport" | "backend" | "backend-console"; message: string }) => void) | null = null;
  let pingCount = 0;

  const transport: TestTransport = {
    mode: "mock-stdio",
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    sendEnvelope: vi.fn((envelope: BackendEnvelope) => {
      if (envelope.type !== "request") {
        return;
      }

      if (envelope.method === "backend.handshake") {
        if (behavior.dropHandshake) {
          return;
        }
        respond(envelope.id, {
          server: {
            name: "queryeer-java-backend",
            version: "0.1.0"
          },
          selectedProtocolVersion: BACKEND_PROTOCOL_VERSION,
          supportedCapabilities: [
            "backend.runtimeStatus",
            "security.session.open",
            "security.session.close",
            "security.vault.changed",
            "health.ping",
            "queryengine.execute",
            "queryengine.cancel",
            "queryengine.invoke",
            "queryengine.progress",
            "queryengine.chunkStart",
            "queryengine.chunkRows",
            "queryengine.completed",
            "queryengine.failed"
          ]
        } satisfies HandshakeResult);
        return;
      }

      if (envelope.method === "health.ping") {
        pingCount += 1;
        if (behavior.failPingAfterStart && pingCount > 1) {
          respondError(envelope.id, {
            code: "TIMEOUT",
            message: "Simulated ping timeout"
          });
          return;
        }
        respond(envelope.id, {
          timestamp: "2026-01-01T00:00:00.000Z",
          uptimeMs: 1234
        } satisfies PingResult);
        return;
      }

      if (envelope.method === "backend.runtimeStatus") {
        respond(envelope.id, {
          startedAt: "2026-01-01T00:00:00.000Z",
          pluginStatuses: [
            {
              pluginId: "query.payloadbuilder",
              state: "activated",
              reason: "Activated"
            }
          ],
          activatedPluginIds: ["query.payloadbuilder"],
          providedCapabilities: ["queryengine.execute", "queryengine.invoke"]
        } satisfies RuntimeStatusResult);
        return;
      }

      if (envelope.method === "queryengine.invoke") {
        const params = envelope.params as {
          engineId: string;
          fileId?: string;
          action: string;
          payload?: unknown;
        };
        respond(envelope.id, {
          result: {
            engineId: params.engineId,
            fileId: params.fileId,
            action: params.action,
            payload: params.payload ?? null
          }
        });
        return;
      }

      if (envelope.method === "queryengine.execute") {
        if (behavior.failExecuteSend) {
          throw new Error("Simulated execute send failure");
        }
        if (behavior.dropExecute) {
          return;
        }
        const params = envelope.params as QueryExecuteParams;
        respond(envelope.id, {
          accepted: true,
          queryExecutionId: params.queryExecutionId
        } satisfies QueryExecuteResult);
        return;
      }

      if (envelope.method === "queryengine.cancel") {
        const params = envelope.params as QueryCancelParams;
        respond(envelope.id, {
          accepted: true,
          queryExecutionId: params.queryExecutionId
        } satisfies QueryCancelResult);
      }
    }),
    emitEnvelope: (envelope: BackendEnvelope) => {
      onEnvelope?.(envelope);
    },
    emitDied: () => {
      onDied?.();
    },
    emitDiagnostic: (event) => {
      onDiagnostic?.(event);
    }
  };

  const respond = (id: string, result: unknown): void => {
    const response: BackendResponseEnvelope = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id,
      result
    };
    onEnvelope?.(response);
  };

  const respondError = (
    id: string,
    error: Omit<BackendError, "details"> & { details?: Record<string, unknown> }
  ): void => {
    const response: BackendResponseEnvelope = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id,
      error
    };
    onEnvelope?.(response);
  };

  const gateway = new BackendGateway({
    mode: "mock-stdio",
    create: (callbacks) => {
      onEnvelope = callbacks.onEnvelope;
      onDied = callbacks.onDied;
      onDiagnostic = callbacks.onDiagnostic;
      return transport;
    }
  });

  return {
    gateway,
    transport
  };
};

describe("BackendGateway", () => {
  it("starts healthy with handshake and ping", async () => {
    const { gateway } = createGatewayWithTestTransport();

    await gateway.start();

    const status = gateway.getStatus();
    expect(status.state).toBe("healthy");
    expect(status.serverName).toBe("queryeer-java-backend");
    expect(status.supportedCapabilities).toContain("queryengine.execute");

    await gateway.stop();
  });

  it("invokes transport died hook when backend transport dies", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    const onDiedHook = vi.fn();
    gateway.setOnTransportDiedHook(onDiedHook);

    await gateway.start();
    transport.emitDied();

    expect(onDiedHook).toHaveBeenCalledTimes(1);
    await gateway.stop();
  });

  it("captures java debug port in dev-maven mode from backend diagnostics", async () => {
    let onEnvelope: EnvelopeHandler | null = null;
    let onDied: (() => void) | null = null;
    let onDiagnostic:
      | ((event: {
          level: "debug" | "info" | "warn" | "error";
          source: "transport" | "backend" | "backend-console";
          message: string;
        }) => void)
      | null = null;

    const transport: TestTransport = {
      mode: "mock-stdio",
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      sendEnvelope: vi.fn((envelope: BackendEnvelope) => {
        if (envelope.type !== "request") {
          return;
        }
        if (envelope.method === "backend.handshake") {
          const response: BackendResponseEnvelope = {
            protocolVersion: BACKEND_PROTOCOL_VERSION,
            type: "response",
            id: envelope.id,
            result: {
              server: { name: "queryeer-java-backend", version: "0.1.0" },
              selectedProtocolVersion: BACKEND_PROTOCOL_VERSION,
              supportedCapabilities: ["health.ping", "backend.runtimeStatus"]
            } satisfies HandshakeResult
          };
          onEnvelope?.(response);
          return;
        }
        if (envelope.method === "health.ping") {
          const response: BackendResponseEnvelope = {
            protocolVersion: BACKEND_PROTOCOL_VERSION,
            type: "response",
            id: envelope.id,
            result: { timestamp: "2026-01-01T00:00:00.000Z", uptimeMs: 1 } satisfies PingResult
          };
          onEnvelope?.(response);
          return;
        }
        if (envelope.method === "backend.runtimeStatus") {
          const response: BackendResponseEnvelope = {
            protocolVersion: BACKEND_PROTOCOL_VERSION,
            type: "response",
            id: envelope.id,
            result: {
              startedAt: "2026-01-01T00:00:00.000Z",
              pluginStatuses: [],
              activatedPluginIds: [],
              providedCapabilities: []
            } satisfies RuntimeStatusResult
          };
          onEnvelope?.(response);
        }
      }),
      emitEnvelope: (envelope: BackendEnvelope) => {
        onEnvelope?.(envelope);
      },
      emitDied: () => {
        onDied?.();
      },
      emitDiagnostic: (event) => {
        onDiagnostic?.(event);
      }
    };

    const gateway = new BackendGateway({
      mode: "dev-maven",
      create: (callbacks) => {
        onEnvelope = callbacks.onEnvelope;
        onDied = callbacks.onDied;
        onDiagnostic = callbacks.onDiagnostic;
        return transport;
      }
    });

    await gateway.start();

    transport.emitDiagnostic({
      level: "info",
      source: "backend-console",
      message: "Listening for transport dt_socket at address: 53721"
    });

    expect(gateway.getStatus().javaDebugPort).toBe(53721);
    await gateway.stop();
  });

  it("recovers to healthy after transport death and watchdog restart", async () => {
    vi.useFakeTimers();
    const { gateway, transport } = createGatewayWithTestTransport();

    await gateway.start();
    expect(gateway.getStatus().state).toBe("healthy");

    transport.emitDied();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1100);
    await Promise.resolve();

    expect(transport.start).toHaveBeenCalledTimes(2);
    expect(gateway.getStatus().state).toBe("healthy");

    vi.useRealTimers();
    await gateway.stop();
  });

  it("execute query sends request and tracks accepted execution", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    const result = await gateway.executeQuery({
      queryExecutionId: "exec-1",
      engineId: "payloadbuilder",
      fileId: "file-1",
      text: "select 1"
    });

    expect(result.accepted).toBe(true);
    expect(result.queryExecutionId).toBe("exec-1");

    const status = gateway.getStatus();
    expect(status.activeExecutionIds).toContain("exec-1");
    expect(status.recentExecutions[0]?.queryExecutionId).toBe("exec-1");

    const executeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "queryengine.execute"
      );

    expect(executeRequest).toBeDefined();
    await gateway.stop();
  });

  it("execute query forwards engineState payload over wire", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    await gateway.executeQuery({
      queryExecutionId: "exec-engine-state",
      engineId: "payloadbuilder",
      fileId: "file-1",
      text: "select 1",
      engineState: {
        payloadbuilder: {
          catalogs: {
            es1: {
              catalogId: "elasticsearch",
              properties: {
                connectionId: "cluster1",
                index: "logs-2026"
              }
            }
          }
        }
      }
    });

    const executeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "queryengine.execute"
      );

    expect(executeRequest).toBeDefined();
    expect((executeRequest?.params as QueryExecuteParams).engineState).toEqual({
      payloadbuilder: {
        catalogs: {
          es1: {
            catalogId: "elasticsearch",
            properties: {
              connectionId: "cluster1",
              index: "logs-2026"
            }
          }
        }
      }
    });

    await gateway.stop();
  });

  it("forwards structured secret refs on queryengine.execute", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    await gateway.executeQuery({
      queryExecutionId: "exec-secret-ref",
      engineId: "payloadbuilder",
      fileId: "file-1",
      text: "select 1",
      engineState: {
        payloadbuilder: {
          catalogs: {
            es1: {
              catalogId: "elasticsearch",
              properties: {
                authUsername: "elastic",
                authPassword: {
                  secretRef: "secret-ref-1"
                }
              }
            }
          }
        }
      }
    });

    const executeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "queryengine.execute"
      );

    expect(executeRequest).toBeDefined();
    expect((executeRequest?.params as QueryExecuteParams).engineState).toEqual({
      payloadbuilder: {
        catalogs: {
          es1: {
            catalogId: "elasticsearch",
            properties: {
              authUsername: "elastic",
              authPassword: { secretRef: "secret-ref-1" }
            }
          }
        }
      }
    });

    await gateway.stop();
  });

  it("execute query forwards JDBC engineState over wire", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    await gateway.executeQuery({
      queryExecutionId: "exec-jdbc-state",
      engineId: "jdbc",
      fileId: "file-1",
      text: "SELECT * FROM users",
      engineState: { connectionId: "prod-db" }
    });

    const executeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "queryengine.execute"
      );

    expect(executeRequest).toBeDefined();
    expect((executeRequest?.params as QueryExecuteParams).engineState).toEqual({
      connectionId: "prod-db"
    });

    await gateway.stop();
  });

  it("completed notification forwards engineState to renderer", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    const events: { method: string; params: unknown }[] = [];
    gateway.setRendererSink((method, params) => events.push({ method, params }));

    await gateway.start();

    const notification: BackendNotificationEnvelope<"queryengine.completed"> = {
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "notification",
      method: "queryengine.completed",
      params: {
        queryExecutionId: "exec-pb-1",
        metrics: { durationMs: 120, rowCount: 2 },
        engineState: {
          payloadbuilder: {
            catalogs: {
              es1: {
                catalogId: "elasticsearch",
                properties: { index: "my-idx-updated" }
              }
            }
          }
        }
      } satisfies QueryCompletedNotification
    };

    transport.emitEnvelope(notification);

    const completed = events.find((e) => e.method === "queryengine.completed");
    expect(completed).toBeDefined();

    const params = completed!.params as QueryCompletedNotification;
    expect(params.engineState).toBeDefined();
    expect(params.engineState).toEqual({
      payloadbuilder: {
        catalogs: {
          es1: {
            catalogId: "elasticsearch",
            properties: { index: "my-idx-updated" }
          }
        }
      }
    });

    await gateway.stop();
  });

  it("invokes engine action and returns result envelope", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    const result = await gateway.invokeEngine({
      engineId: "payloadbuilder",
      fileId: "file-1",
      action: "payloadbuilder.echo",
      payload: { ping: true }
    });

    expect(result).toEqual({
      result: {
        engineId: "payloadbuilder",
        fileId: "file-1",
        action: "payloadbuilder.echo",
        payload: { ping: true }
      }
    });

    const invokeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "queryengine.invoke"
      );

    expect(invokeRequest).toBeDefined();
    await gateway.stop();
  });

  it("forwards structured secret refs on queryengine.invoke", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    await gateway.invokeEngine({
      engineId: "payloadbuilder",
      action: "payloadbuilder.es.listIndices",
      payload: {
        properties: {
          authPassword: {
            secretRef: "secret-ref-2"
          }
        }
      }
    });

    const invokeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "queryengine.invoke"
      );

    expect(invokeRequest).toBeDefined();
    expect(invokeRequest?.params).toEqual({
      engineId: "payloadbuilder",
      action: "payloadbuilder.es.listIndices",
      payload: {
        properties: {
          authPassword: { secretRef: "secret-ref-2" }
        }
      }
    });

    await gateway.stop();
  });

  it("forwards nested structured secret refs on queryengine.invoke", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    await gateway.invokeEngine({
      engineId: "payloadbuilder",
      action: "payloadbuilder.custom",
      payload: {
        properties: {
          apiKey: {
            secretRef: "secret-ref-api-key"
          }
        }
      }
    });

    const invokeRequest = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendRequestEnvelope =>
          envelope.type === "request" && envelope.method === "queryengine.invoke"
      );

    expect(invokeRequest).toBeDefined();
    expect(invokeRequest?.params).toEqual({
      engineId: "payloadbuilder",
      action: "payloadbuilder.custom",
      payload: {
        properties: {
          apiKey: { secretRef: "secret-ref-api-key" }
        }
      }
    });

    await gateway.stop();
  });

  it("marks unavailable when handshake times out", async () => {
    vi.useFakeTimers();
    const { gateway } = createGatewayWithTestTransport({ dropHandshake: true });

    const startPromise = gateway.start();
    await vi.advanceTimersByTimeAsync(90_001);
    await startPromise;

    const status = gateway.getStatus();
    expect(status.state).toBe("unavailable");
    expect(status.error).toContain("Request timeout: backend.handshake");

    await gateway.stop();
    vi.useRealTimers();
  });

  it("rejects execute query when send fails and sets unavailable", async () => {
    const { gateway } = createGatewayWithTestTransport({ failExecuteSend: true });
    await gateway.start();

    await expect(
      gateway.executeQuery({
        queryExecutionId: "exec-2",
        engineId: "payloadbuilder",
        fileId: "file-1",
        text: "select 1"
      })
    ).rejects.toThrow("Simulated execute send failure");

    const status = gateway.getStatus();
    expect(status.state).toBe("unavailable");

    await gateway.stop();
  });

  it("rejects execute query when request times out", async () => {
    vi.useFakeTimers();
    const { gateway } = createGatewayWithTestTransport({ dropExecute: true });
    await gateway.start();

    const executePromise = gateway.executeQuery({
      queryExecutionId: "exec-3",
      engineId: "payloadbuilder",
      fileId: "file-1",
      text: "select 1"
    });

    const assertion = expect(executePromise).rejects.toThrow("Request timeout: queryengine.execute");

    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;

    await gateway.stop();
    vi.useRealTimers();
  });

  it("logs warning for unknown response ids", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    transport.emitEnvelope({
      protocolVersion: BACKEND_PROTOCOL_VERSION,
      type: "response",
      id: "req-unknown",
      result: { ok: true }
    });

    const warning = gateway
      .getStatus()
      .backendLogs.find((entry) => entry.level === "warn" && entry.message.includes("req-unknown"));

    expect(warning).toBeDefined();
    await gateway.stop();
  });

  it("marks unavailable when ping loop fails", async () => {
    vi.useFakeTimers();
    const { gateway } = createGatewayWithTestTransport({ failPingAfterStart: true });
    await gateway.start();

    await vi.advanceTimersByTimeAsync(5_100);

    const status = gateway.getStatus();
    expect(status.state).toBe("unavailable");
    expect(status.error).toContain("TIMEOUT");

    await gateway.stop();
    vi.useRealTimers();
  });

  it("sends settings.module.changed notification", async () => {
    const { gateway, transport } = createGatewayWithTestTransport();
    await gateway.start();

    gateway.notifySettingsModuleChanged({ moduleId: "core.editor", version: 5 });

    const notification = transport.sendEnvelope.mock.calls
      .map((call: [BackendEnvelope]) => call[0])
      .find(
        (envelope): envelope is BackendNotificationEnvelope =>
          envelope.type === "notification" && envelope.method === "settings.module.changed"
      );

    expect(notification).toBeDefined();
    expect((notification?.params as { moduleId: string; version: number }).moduleId).toBe("core.editor");
    expect((notification?.params as { moduleId: string; version: number }).version).toBe(5);

    await gateway.stop();
  });
});
